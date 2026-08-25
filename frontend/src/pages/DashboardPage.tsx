import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  DollarSign,
  Award,
  Star,
  ThumbsUp,
  ClipboardCheck,
  Crown,
  CalendarIcon,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { useUsers, useSession, type HubUser } from "@/lib/hub-store";
import { isAdminSession } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fetchForms, fetchSubmissions, type HubForm, type FormSubmission } from "@/lib/forms-store";

const PAYROLL_SLUG = "new-payroll-records";
const BONUS_SLUG = "bonus-submissions";
const REVIEW_SLUGS = ["review-your-recent-experience", "how-are-we-doing"];
const EFFICIENCY_SLUG = "new-efficiency";

type FeedbackItem = {
  id: string;
  formName: string;
  clientName: string;
  area: string;
  rating: number;
  comment: string;
  createdAt: string;
};

function findFieldIdsByType(form: HubForm | null, type: string): string[] {
  if (!form) return [];
  return form.fields.filter((f) => f.type === type).map((f) => f.id);
}

function findFieldIdByLabelContains(form: HubForm | null, needle: string): string | null {
  if (!form) return null;
  const n = needle.toLowerCase();
  return form.fields.find((f) => (f.label ?? "").toLowerCase().includes(n))?.id ?? null;
}

function submissionMatchesUser(
  sub: FormSubmission,
  form: HubForm,
  userName: string,
): boolean {
  const techId = findFieldIdByType(form, "users");
  if (!techId) return false;
  const v = sub.answers[techId];
  const names = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  return names.includes(userName);
}

function inRange(sub: FormSubmission, range: DateRange | undefined): boolean {
  const from = range?.from ? new Date(range.from).getTime() : -Infinity;
  const toDate = range?.to ?? range?.from;
  const to = toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).getTime() : Infinity;
  const t = new Date(sub.createdAt).getTime();
  return t >= from && t <= to;
}

function avgStarRating(
  user: HubUser | undefined,
  reviewData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): { avg: number; count: number } {
  if (!user) return { avg: 0, count: 0 };
  let sum = 0;
  let count = 0;
  for (const { form, subs } of reviewData) {
    const starIds = findFieldIdsByType(form, "star_rating");
    if (!starIds.length) continue;
    for (const sub of subs) {
      if (!inRange(sub, range)) continue;
      if (!submissionMatchesUser(sub, form, user.name)) continue;
      for (const sid of starIds) {
        const v = num(sub.answers[sid]);
        if (v > 0) {
          sum += v;
          count += 1;
        }
      }
    }
  }
  return { avg: count ? sum / count : 0, count };
}

function collectFeedback(
  user: HubUser | undefined,
  reviewData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): FeedbackItem[] {
  if (!user) return [];
  const items: FeedbackItem[] = [];
  for (const { form, subs } of reviewData) {
    const starIds = findFieldIdsByType(form, "star_rating");
    const nameId =
      findFieldIdByLabelContains(form, "your name") ??
      findFieldIdByLabelContains(form, "name");
    const areaId = findFieldIdByLabelContains(form, "area");
    const commentId =
      findFieldIdByLabelContains(form, "additional thoughts") ??
      findFieldIdByLabelContains(form, "share") ??
      form.fields.find((f) => f.type === "multi_line")?.id ??
      null;
    for (const sub of subs) {
      if (!inRange(sub, range)) continue;
      if (!submissionMatchesUser(sub, form, user.name)) continue;
      const ratings = starIds.map((id) => num(sub.answers[id])).filter((n) => n > 0);
      const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      items.push({
        id: sub.id,
        formName: form.name,
        clientName: nameId ? String(sub.answers[nameId] ?? "Anonymous") : "Anonymous",
        area: areaId ? String(sub.answers[areaId] ?? "") : "",
        rating: avg,
        comment: commentId ? String(sub.answers[commentId] ?? "") : "",
        createdAt: sub.createdAt,
      });
    }
  }
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}

function computeBonuses(
  user: HubUser | undefined,
  submissions: FormSubmission[],
  form: HubForm | null,
  range: DateRange | undefined,
): number {
  if (!user || !form) return 0;
  const techId = findFieldIdByType(form, "users");
  const amountId = findFieldId(form, "Bonus Amount");
  if (!techId || !amountId) return 0;
  const from = range?.from ? new Date(range.from).getTime() : -Infinity;
  const toDate = range?.to ?? range?.from;
  const to = toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).getTime() : Infinity;
  let total = 0;
  for (const sub of submissions) {
    const t = new Date(sub.createdAt).getTime();
    if (t < from || t > to) continue;
    const techVal = sub.answers[techId];
    const techNames = Array.isArray(techVal) ? techVal.map(String) : techVal ? [String(techVal)] : [];
    if (!techNames.includes(user.name)) continue;
    total += num(sub.answers[amountId]);
  }
  return total;
}

function findFieldId(form: HubForm | null, label: string): string | null {
  if (!form) return null;
  const f = form.fields.find((x) => x.label?.trim().toLowerCase() === label.toLowerCase());
  return f?.id ?? null;
}

function findFieldIdByType(form: HubForm | null, type: string): string | null {
  if (!form) return null;
  const f = form.fields.find((x) => x.type === type);
  return f?.id ?? null;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function computeEarnings(
  user: HubUser | undefined,
  submissions: FormSubmission[],
  form: HubForm | null,
  range: DateRange | undefined,
): number {
  if (!user || !form) return 0;
  const techId = findFieldIdByType(form, "users");
  const ids = {
    reg: findFieldId(form, "Regular Hours"),
    drive: findFieldId(form, "Drive Time Hours"),
    fc: findFieldId(form, "FC Hours"),
    tr: findFieldId(form, "TR Hours"),
    stat: findFieldId(form, "Stat Holiday Pay"),
    vac: findFieldId(form, "Vacation Pay Amount"),
    tips: findFieldId(form, "Total Tips"),
    gas: findFieldId(form, "Gas Reimbursement"),
    other: findFieldId(form, "Other Pay"),
    ded: findFieldId(form, "Deductions"),
  };
  const from = range?.from ? new Date(range.from).getTime() : -Infinity;
  const toDate = range?.to ?? range?.from;
  const to = toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).getTime() : Infinity;

  let total = 0;
  for (const sub of submissions) {
    const t = new Date(sub.createdAt).getTime();
    if (t < from || t > to) continue;
    if (!techId) continue;
    const techVal = sub.answers[techId];
    const techNames = Array.isArray(techVal) ? techVal.map(String) : techVal ? [String(techVal)] : [];
    if (!techNames.includes(user.name)) continue;
    const a = sub.answers;
    total += num(a[ids.reg ?? ""]) * (user.regularRate ?? 0);
    total += num(a[ids.drive ?? ""]) * (user.driveTimeRate ?? 0);
    total += num(a[ids.fc ?? ""]) * (user.fcRate ?? 0);
    total += num(a[ids.tr ?? ""]) * (user.trRate ?? 0);
    total += num(a[ids.stat ?? ""]);
    total += num(a[ids.vac ?? ""]);
    total += num(a[ids.tips ?? ""]);
    total += num(a[ids.gas ?? ""]);
    total += num(a[ids.other ?? ""]);
    total -= num(a[ids.ded ?? ""]);
  }
  return total;
}



function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DashboardPage() {
  const users = useUsers();
  const session = useSession();
  const admin = isAdminSession(session);
  const activeUsers = useMemo(
    () => users.filter((u) => u.status === "active"),
    [users],
  );
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!admin && session?.userId) {
      setSelectedId(session.userId);
    }
  }, [admin, session?.userId]);

  const selected = admin
    ? activeUsers.find((u) => u.id === selectedId) ?? activeUsers[0]
    : activeUsers.find((u) => u.id === session?.userId) ??
      activeUsers.find((u) => u.id === selectedId) ??
      activeUsers[0];
  const selectedName = selected?.name ?? session?.name ?? "";
  const firstName = selectedName.split(/\s+/)[0] ?? "there";

  // Default date range: current month
  const now = new Date();
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  });

  const [payrollForm, setPayrollForm] = useState<HubForm | null>(null);
  const [payrollSubs, setPayrollSubs] = useState<FormSubmission[]>([]);
  const [bonusForm, setBonusForm] = useState<HubForm | null>(null);
  const [bonusSubs, setBonusSubs] = useState<FormSubmission[]>([]);
  const [reviewData, setReviewData] = useState<{ form: HubForm; subs: FormSubmission[] }[]>([]);
  const [efficiencyForm, setEfficiencyForm] = useState<HubForm | null>(null);
  const [efficiencySubs, setEfficiencySubs] = useState<FormSubmission[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const forms = await fetchForms();
      const f = forms.find((x) => x.slug === PAYROLL_SLUG) ?? null;
      const b = forms.find((x) => x.slug === BONUS_SLUG) ?? null;
      const e = forms.find((x) => x.slug === EFFICIENCY_SLUG) ?? null;
      const reviewForms = forms.filter((x) => REVIEW_SLUGS.includes(x.slug));
      if (!active) return;
      setPayrollForm(f);
      setBonusForm(b);
      setEfficiencyForm(e);
      const [subs, bsubs, rsubs, esubs] = await Promise.all([
        f ? fetchSubmissions(f.id) : Promise.resolve([]),
        b ? fetchSubmissions(b.id) : Promise.resolve([]),
        Promise.all(reviewForms.map((rf) => fetchSubmissions(rf.id))),
        e ? fetchSubmissions(e.id) : Promise.resolve([]),
      ]);
      if (!active) return;
      setPayrollSubs(subs);
      setBonusSubs(bsubs);
      setReviewData(reviewForms.map((form, i) => ({ form, subs: rsubs[i] ?? [] })));
      setEfficiencySubs(esubs);
    })();
    return () => {
      active = false;
    };
  }, []);

  const totalEarnings = useMemo(
    () => computeEarnings(selected, payrollSubs, payrollForm, range),
    [selected, payrollSubs, payrollForm, range],
  );
  const totalEarningsLabel = `$${totalEarnings.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const totalBonuses = useMemo(
    () => computeBonuses(selected, bonusSubs, bonusForm, range),
    [selected, bonusSubs, bonusForm, range],
  );
  const totalBonusesLabel = `$${totalBonuses.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const ratingStats = useMemo(
    () => avgStarRating(selected, reviewData, range),
    [selected, reviewData, range],
  );
  const avgRatingLabel = ratingStats.count
    ? `${ratingStats.avg.toFixed(1)}/5.0`
    : "—";
  const ratingSub = ratingStats.count
    ? `Based on ${ratingStats.count} rating${ratingStats.count === 1 ? "" : "s"}`
    : "No ratings yet";

  const feedback = useMemo(
    () => collectFeedback(selected, reviewData, range),
    [selected, reviewData, range],
  );

  const efficiency = useMemo(() => {
    if (!selected || !efficiencyForm) return 100;
    let count = 0;
    for (const sub of efficiencySubs) {
      if (!inRange(sub, range)) continue;
      if (!submissionMatchesUser(sub, efficiencyForm, selected.name)) continue;
      count += 1;
    }
    return Math.max(0, 100 - count * 5);
  }, [selected, efficiencyForm, efficiencySubs, range]);
  const efficiencyLabel = `${efficiency}%`;
  const efficiencyBadge =
    efficiency === 100 ? "Perfect" : efficiency >= 80 ? "Above Avg" : "Needs Work";

  const leaderboard = useMemo(() => {
    return activeUsers
      .map((u) => {
        const earnings = computeEarnings(u, payrollSubs, payrollForm, range);
        const { avg, count } = avgStarRating(u, reviewData, range);
        return { user: u, earnings, rating: avg, ratingCount: count };
      })
      .sort((a, b) => b.earnings - a.earnings);
  }, [activeUsers, payrollSubs, payrollForm, reviewData, range]);


  const rangeLabel = range?.from
    ? range.to && range.to.getTime() !== range.from.getTime()
      ? `${format(range.from, "LLL d, y")} – ${format(range.to, "LLL d, y")}`
      : format(range.from, "LLL d, y")
    : "Pick a date range";

  return (
    <div className="min-h-full bg-gradient-to-br from-emerald-50/40 via-background to-background p-2">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Greeting */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">
              Welcome back, {firstName}!
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Here's your performance overview for this period.
            </p>
          </div>
          {admin ? (
            <div className="rounded-lg border bg-card px-4 py-2 flex items-center gap-2 shadow-sm">
              <span className="text-sm font-medium">Staff:</span>
              <Select value={selected?.id ?? ""} onValueChange={setSelectedId}>
                <SelectTrigger className="h-8 min-w-[200px] border-0 shadow-none focus:ring-0">
                  <SelectValue placeholder="Select staff" />
                </SelectTrigger>
                <SelectContent>
                  {activeUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="rounded-lg border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
              Viewing: <span className="font-medium text-foreground">{selectedName || "you"}</span>
            </div>
          )}
        </div>

        {/* Performance header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">Performance Dashboard</h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-9 justify-start text-left font-normal gap-2",
                  !range?.from && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="h-4 w-4" />
                {rangeLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={2}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Earnings"
            value={totalEarningsLabel}
            sub={`For ${rangeLabel}`}
            icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          />
          <StatCard
            label="Bonuses Earned"
            value={totalBonusesLabel}
            sub={`For ${rangeLabel}`}
            icon={<Award className="h-4 w-4 text-muted-foreground" />}
          />
          <StatCard
            label="Average Rating"
            value={avgRatingLabel}
            sub={ratingSub}
            icon={<Star className="h-4 w-4 text-amber-500" />}
          />
          <StatCard
            label="Shifts Completed"
            value="32"
            sub="+4 from last month"
            icon={<ThumbsUp className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Review shoutout */}
            <div className="rounded-xl border bg-card p-5 shadow-sm relative overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center rounded-full bg-amber-500 text-white px-2.5 py-0.5 text-[10px] font-bold tracking-wide">
                  REVIEW SHOUTOUT
                </span>
                <span className="text-sm font-semibold">New 5-Star Highlight</span>
              </div>
              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold shrink-0">
                  JT
                </div>
                <div className="flex-1">
                  <p className="text-sm italic text-foreground/90">
                    "{firstName} did an amazing job! The house has never looked this clean. She was very
                    thorough and professional.{" "}
                    <span className="text-emerald-600 font-semibold not-italic">
                      Highly recommend!
                    </span>
                    "
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">Jessica T.</p>
                      <p className="text-xs text-muted-foreground">Vaudreuil · 2 days ago</p>
                    </div>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <ThumbsUp className="absolute right-6 top-6 h-16 w-16 text-emerald-100 -z-0" />
            </div>

            {/* Detailed performance metrics */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <ClipboardCheck className="h-4 w-4 text-emerald-600" />
                <h3 className="font-semibold">Detailed Performance Metrics</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                A breakdown of your core performance indicators this month.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricBox label="ATTENDANCE" value="98%" badge="Target: 95%" badgeTone="emerald" />
                <MetricBox label="EFFICIENCY" value={efficiencyLabel} badge={efficiencyBadge} badgeTone="emerald" />
                <MetricBox label="CALL BACKS" value="0" badge="Perfect" badgeTone="emerald" />
                <MetricBox label="DAMAGED/LOST" value="0" badge="Perfect" badgeTone="emerald" />
              </div>
            </div>

            {/* Recent Client Feedback */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold mb-1">Recent Client Feedback</h3>
              <p className="text-xs text-muted-foreground mb-4">
                What clients are saying about your work.
              </p>
              {feedback.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No feedback submitted for {selectedName || "this staff member"} in the selected range.
                </p>
              ) : (
                <div className="space-y-3">
                  {feedback.slice(0, 5).map((fb) => {
                    const rounded = Math.round(fb.rating);
                    return (
                      <div key={fb.id} className="rounded-lg border p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">
                              {fb.clientName || "Anonymous"}
                              {fb.area && (
                                <span className="text-muted-foreground font-normal"> — {fb.area}</span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex gap-0.5">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-3.5 w-3.5 ${
                                      i < rounded
                                        ? "fill-amber-400 text-amber-400"
                                        : "text-muted-foreground/30"
                                    }`}
                                  />
                                ))}
                              </div>
                              {fb.rating > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {fb.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">{fb.formName}</p>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(fb.createdAt), "LLL d, y")}
                          </span>
                        </div>
                        {fb.comment && (
                          <p className="text-sm mt-3 text-foreground/80 whitespace-pre-wrap">
                            {fb.comment}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Google reviews */}
            <div className="rounded-xl border bg-amber-50/60 border-amber-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <h3 className="font-semibold">Google Review Performance</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Track your 5-star reviews on Google.
              </p>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-bold">18</span>
                <span className="text-xs text-muted-foreground">Goal: 20</span>
              </div>
              <ProgressBar value={18} max={20} className="mt-2" />
              <p className="text-xs italic text-amber-700 mt-3">
                "Just 2 more 5-star reviews to unlock your monthly performance bonus!"
              </p>
            </div>

            {/* Leaderboard (admin only — other people's pay should not be visible to staff) */}
            {admin ? (
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Crown className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold">Leaderboard</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Top earners for {rangeLabel}.
              </p>
              <div className="space-y-2">
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No users yet.</p>
                ) : (
                  leaderboard.map((entry, idx) => {
                    const rank = idx + 1;
                    const tone =
                      rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : undefined;
                    return (
                      <LeaderRow
                        key={entry.user.id}
                        rank={rank}
                        initials={initialsOf(entry.user.name)}
                        name={entry.user.id === selected?.id ? `${entry.user.name} (You)` : entry.user.name}
                        rating={entry.rating}
                        ratingCount={entry.ratingCount}
                        earnings={entry.earnings}
                        tone={tone}
                        highlight={entry.user.id === selected?.id}
                      />
                    );
                  })
                )}
              </div>
            </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}


function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold mt-2">{value}</p>
      <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">{sub}</p>
    </div>
  );
}

function MetricBox({
  label,
  value,
  badge,
  badgeTone,
}: {
  label: string;
  value: string;
  badge: string;
  badgeTone: "emerald";
}) {
  const toneClasses = {
    emerald: "bg-emerald-100 text-emerald-700",
  }[badgeTone];
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium mt-2 ${toneClasses}`}>
        {badge}
      </span>
    </div>
  );
}

function LeaderRow({
  rank,
  initials,
  name,
  rating,
  ratingCount,
  earnings,
  tone,
  highlight,
}: {
  rank: number;
  initials: string;
  name: string;
  rating: number;
  ratingCount: number;
  earnings: number;
  tone?: "gold" | "silver" | "bronze";
  highlight?: boolean;
}) {
  const rankTone =
    tone === "gold"
      ? "bg-amber-500 text-white"
      : tone === "silver"
      ? "bg-gray-300 text-gray-800"
      : tone === "bronze"
      ? "bg-amber-700 text-white"
      : "bg-muted text-muted-foreground";
  return (
    <div
      className={`flex items-center gap-3 p-2.5 rounded-lg ${
        highlight ? "bg-emerald-50 border-l-4 border-emerald-500" : ""
      }`}
    >
      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${rankTone}`}>
        {rank}
      </div>
      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${highlight ? "text-emerald-700" : ""}`}>{name}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          {ratingCount > 0 ? `${rating.toFixed(1)} (${ratingCount})` : "No ratings"}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold">
          ${earnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-[10px] text-muted-foreground">earnings</p>
      </div>
    </div>
  );
}


function ProgressBar({
  value,
  max,
  className = "",
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className={`h-2 w-full rounded-full bg-muted overflow-hidden ${className}`}>
      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}
