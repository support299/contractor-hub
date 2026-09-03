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
  CalendarCheck,
  MessageSquare,
  Lock,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { useUsers, useSession } from "@/lib/hub-store";
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
import {
  fetchLockInBonuses,
  fetchVisitSummary,
  isConfirmedLockIn,
  lockInEventAt,
  rangeToVisitQuery,
  type LockInBonusRow,
  type VisitSummary,
} from "@/lib/lock-in-store";
import {
  PAYROLL_SLUG,
  BONUS_SLUG,
  REVIEW_SLUGS,
  EFFICIENCY_SLUG,
  avgStarRating,
  collectFeedback,
  computeBonuses,
  computeEarnings,
  computeEfficiencyScore,
  countFeedbackByAudience,
  countFiveStarReviews,
  dateInRange,
  formatMoney,
  initialsOf,
} from "@/lib/dashboard-metrics";

import { useDocumentTitle } from "@/hooks/use-document-title";

export default function DashboardPage() {
  useDocumentTitle("Dashboard");
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
  const [lockIns, setLockIns] = useState<LockInBonusRow[]>([]);
  const [visitSummary, setVisitSummary] = useState<VisitSummary>({ total: 0, byTechnician: {} });

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
      const [subs, bsubs, rsubs, esubs, bonuses] = await Promise.all([
        f ? fetchSubmissions(f.id) : Promise.resolve([]),
        b ? fetchSubmissions(b.id) : Promise.resolve([]),
        Promise.all(reviewForms.map((rf) => fetchSubmissions(rf.id))),
        e ? fetchSubmissions(e.id) : Promise.resolve([]),
        fetchLockInBonuses().catch(() => [] as LockInBonusRow[]),
      ]);
      if (!active) return;
      setPayrollSubs(subs);
      setBonusSubs(bsubs);
      setReviewData(reviewForms.map((form, i) => ({ form, subs: rsubs[i] ?? [] })));
      setEfficiencySubs(esubs);
      setLockIns(bonuses);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const summary = await fetchVisitSummary(rangeToVisitQuery(range)).catch(
        () => ({ total: 0, byTechnician: {} }) as VisitSummary,
      );
      if (!active) return;
      setVisitSummary(summary);
    })();
    return () => {
      active = false;
    };
  }, [range]);

  const totalEarnings = useMemo(
    () => computeEarnings(selected, payrollSubs, payrollForm, range),
    [selected, payrollSubs, payrollForm, range],
  );
  const totalEarningsLabel = formatMoney(totalEarnings);

  const totalBonuses = useMemo(
    () => computeBonuses(selected, bonusSubs, bonusForm, range),
    [selected, bonusSubs, bonusForm, range],
  );
  const totalBonusesLabel = formatMoney(totalBonuses);

  const visitCount = selected ? (visitSummary.byTechnician[selected.id] ?? 0) : 0;

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
  const fiveStarCount = useMemo(() => countFiveStarReviews(feedback), [feedback]);
  const feedbackAudience = useMemo(() => countFeedbackByAudience(feedback), [feedback]);
  const feedbackSub =
    feedback.length === 0
      ? "New and current clients"
      : `${feedbackAudience.newClients} new · ${feedbackAudience.currentClients} current`;

  const efficiency = useMemo(
    () => computeEfficiencyScore(selected, efficiencySubs, efficiencyForm, range),
    [selected, efficiencyForm, efficiencySubs, range],
  );
  const efficiencyLabel = `${efficiency}%`;
  const efficiencyBadge =
    efficiency === 100 ? "Perfect" : efficiency >= 80 ? "Above Avg" : "Needs Work";

  const periodLockIns = useMemo(() => {
    if (!selected) return [];
    return lockIns.filter((row) => {
      if (!isConfirmedLockIn(row)) return false;
      if (row.technician !== selected.id) return false;
      return dateInRange(lockInEventAt(row), range);
    });
  }, [lockIns, selected, range]);
  const lockInAmount = periodLockIns.reduce((a, r) => a + r.amount, 0);

  const shoutout = useMemo(() => {
    return (
      feedback.find((f) => f.rating >= 5 && f.comment.trim()) ??
      feedback.find((f) => f.rating >= 5) ??
      null
    );
  }, [feedback]);

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
            label="Total Visits"
            value={String(visitCount)}
            sub={`For ${rangeLabel}`}
            icon={<CalendarCheck className="h-4 w-4 text-muted-foreground" />}
          />
          <StatCard
            label="Five-Star Reviews"
            value={String(fiveStarCount)}
            sub={fiveStarCount === 1 ? "Perfect score" : "Perfect scores"}
            icon={<Star className="h-4 w-4 text-amber-500" />}
          />
          <StatCard
            label="Feedback Received"
            value={String(feedback.length)}
            sub={feedbackSub}
            icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
          />
          <StatCard
            label="Average Rating"
            value={avgRatingLabel}
            sub={ratingSub}
            icon={<Star className="h-4 w-4 text-amber-500" />}
          />
          <StatCard
            label="Lock-ins"
            value={String(periodLockIns.length)}
            sub={periodLockIns.length ? formatMoney(lockInAmount) : "Confirmed in this period"}
            icon={<Lock className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {shoutout ? (
            <div className="rounded-xl border bg-card p-5 shadow-sm relative overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center rounded-full bg-amber-500 text-white px-2.5 py-0.5 text-[10px] font-bold tracking-wide">
                  REVIEW SHOUTOUT
                </span>
                <span className="text-sm font-semibold">5-Star Highlight</span>
              </div>
              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold shrink-0">
                  {initialsOf(shoutout.clientName || "A")}
                </div>
                <div className="flex-1 min-w-0">
                  {shoutout.comment ? (
                    <p className="text-sm italic text-foreground/90 whitespace-pre-wrap">
                      "{shoutout.comment}"
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">5-star review, no written comment.</p>
                  )}
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{shoutout.clientName || "Anonymous"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[shoutout.area, format(new Date(shoutout.createdAt), "LLL d, y")]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-4 w-4 ${
                            i < Math.round(shoutout.rating)
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <ThumbsUp className="absolute right-6 top-6 h-16 w-16 text-emerald-100 -z-0" />
            </div>
            ) : null}

            {/* Detailed performance metrics */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <ClipboardCheck className="h-4 w-4 text-emerald-600" />
                <h3 className="font-semibold">Detailed Performance Metrics</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                From Hub form data for this period.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
                <MetricBox label="EFFICIENCY" value={efficiencyLabel} badge={efficiencyBadge} badgeTone="emerald" />
              </div>
            </div>

            {/* Recent Client Feedback */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold mb-1">Recent Client Feedback</h3>
              <p className="text-xs text-muted-foreground mb-4">
                New and current client feedback for your work.
              </p>
              {feedback.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No feedback submitted for {selectedName || "this staff member"} in the selected range.
                </p>
              ) : (
                <div className="space-y-3">
                  {feedback.map((fb) => {
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
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="h-4 w-4 text-emerald-600" />
                <h3 className="font-semibold">Confirmed lock-ins</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Hub lock-in bonuses for this person in the selected range.
              </p>
              {periodLockIns.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No confirmed lock-ins.</p>
              ) : (
                <ul className="space-y-2">
                  {periodLockIns.map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{row.clientName || "Client"}</p>
                        <p className="text-xs text-muted-foreground">
                          {lockInEventAt(row) ? format(new Date(lockInEventAt(row)), "LLL d, y") : ""}
                        </p>
                      </div>
                      <span className="font-semibold whitespace-nowrap">{formatMoney(row.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
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
        <p className="text-sm font-bold">{formatMoney(earnings)}</p>
        <p className="text-[10px] text-muted-foreground">earnings</p>
      </div>
    </div>
  );
}
