import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarCheck,
  Crown,
  Lock,
  MessageSquare,
  Monitor,
  Star,
  Users,
} from "lucide-react";
import { useUsers, getSectors, type HubUser, type Role } from "@/lib/hub-store";
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
  REVIEW_SLUGS,
  avgStarRating,
  avgStarRatingForNames,
  collectFeedbackForNames,
  countFeedbackByAudience,
  countFiveStarReviews,
  dateInRange,
  formatMoney,
  formatMomDelta,
  initialsOf,
  monthRange,
  monthSelectOptions,
  parseYearMonth,
  shiftMonth,
} from "@/lib/dashboard-metrics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Audience = "all" | "employee" | "contractor";

function filterTeam(
  users: HubUser[],
  audience: Audience,
  sector: string,
): HubUser[] {
  return users.filter((u) => {
    if (u.status !== "active") return false;
    if (audience !== "all" && u.role !== audience) return false;
    if (sector !== "all" && !(u.sectors ?? []).includes(sector)) return false;
    return true;
  });
}

export default function ScoreboardPage() {
  const users = useUsers();
  const [searchParams, setSearchParams] = useSearchParams();
  const tv = searchParams.get("tv") === "1";
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [monthValue, setMonthValue] = useState(defaultMonth);
  const [audience, setAudience] = useState<Audience>("all");
  const [sector, setSector] = useState("all");
  const [sectors, setSectors] = useState<string[]>([]);

  const [reviewData, setReviewData] = useState<{ form: HubForm; subs: FormSubmission[] }[]>([]);
  const [lockIns, setLockIns] = useState<LockInBonusRow[]>([]);
  const [visitSummary, setVisitSummary] = useState<VisitSummary>({ total: 0, byTechnician: {} });
  const [prevVisitSummary, setPrevVisitSummary] = useState<VisitSummary>({
    total: 0,
    byTechnician: {},
  });

  useEffect(() => {
    let active = true;
    getSectors()
      .then((s) => {
        if (active) setSectors(s);
      })
      .catch(() => {
        if (active) setSectors([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const forms = await fetchForms();
      const reviewForms = forms.filter((x) => REVIEW_SLUGS.includes(x.slug));
      const [rsubs, bonuses] = await Promise.all([
        Promise.all(reviewForms.map((rf) => fetchSubmissions(rf.id))),
        fetchLockInBonuses().catch(() => [] as LockInBonusRow[]),
      ]);
      if (!active) return;
      setReviewData(reviewForms.map((form, i) => ({ form, subs: rsubs[i] ?? [] })));
      setLockIns(bonuses);
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, []);

  const { year, month } = parseYearMonth(monthValue);
  const range = useMemo(() => monthRange(year, month), [year, month]);
  const prev = shiftMonth(year, month, -1);
  const prevRange = useMemo(() => monthRange(prev.year, prev.month), [prev.year, prev.month]);
  const monthLabel = useMemo(() => {
    const d = new Date(year, month, 1);
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }, [year, month]);
  const monthOptions = useMemo(() => monthSelectOptions(now), []);

  const team = useMemo(
    () => filterTeam(users, audience, sector),
    [users, audience, sector],
  );
  const nameSet = useMemo(() => new Set(team.map((u) => u.name)), [team]);
  const idSet = useMemo(() => new Set(team.map((u) => u.id)), [team]);

  useEffect(() => {
    let active = true;
    (async () => {
      const empty: VisitSummary = { total: 0, byTechnician: {} };
      const [cur, prev] = await Promise.all([
        fetchVisitSummary(rangeToVisitQuery(range)).catch(() => empty),
        fetchVisitSummary(rangeToVisitQuery(prevRange)).catch(() => empty),
      ]);
      if (!active) return;
      setVisitSummary(cur);
      setPrevVisitSummary(prev);
    })();
    return () => {
      active = false;
    };
  }, [range, prevRange]);

  const teamVisits = useMemo(
    () => team.reduce((acc, u) => acc + (visitSummary.byTechnician[u.id] ?? 0), 0),
    [team, visitSummary],
  );
  const prevTeamVisits = useMemo(
    () => team.reduce((acc, u) => acc + (prevVisitSummary.byTechnician[u.id] ?? 0), 0),
    [team, prevVisitSummary],
  );

  const rating = useMemo(
    () => avgStarRatingForNames(nameSet, reviewData, range),
    [nameSet, reviewData, range],
  );
  const prevRating = useMemo(
    () => avgStarRatingForNames(nameSet, reviewData, prevRange),
    [nameSet, reviewData, prevRange],
  );

  const periodLockIns = useMemo(() => {
    return lockIns.filter((row) => {
      if (!isConfirmedLockIn(row)) return false;
      if (!idSet.has(row.technician)) return false;
      return dateInRange(lockInEventAt(row), range);
    });
  }, [lockIns, idSet, range]);
  const prevLockIns = useMemo(() => {
    return lockIns.filter((row) => {
      if (!isConfirmedLockIn(row)) return false;
      if (!idSet.has(row.technician)) return false;
      return dateInRange(lockInEventAt(row), prevRange);
    });
  }, [lockIns, idSet, prevRange]);
  const lockInAmount = periodLockIns.reduce((a, r) => a + r.amount, 0);

  const feedback = useMemo(
    () => collectFeedbackForNames(nameSet, reviewData, range),
    [nameSet, reviewData, range],
  );
  const prevFeedback = useMemo(
    () => collectFeedbackForNames(nameSet, reviewData, prevRange),
    [nameSet, reviewData, prevRange],
  );
  const fiveStarCount = useMemo(() => countFiveStarReviews(feedback), [feedback]);
  const prevFiveStarCount = useMemo(() => countFiveStarReviews(prevFeedback), [prevFeedback]);
  const feedbackAudience = useMemo(() => countFeedbackByAudience(feedback), [feedback]);
  const feedbackSub =
    feedback.length === 0
      ? "New and current clients"
      : `${feedbackAudience.newClients} new · ${feedbackAudience.currentClients} current`;

  const leaderboard = useMemo(() => {
    return team
      .map((u) => {
        const visits = visitSummary.byTechnician[u.id] ?? 0;
        const { avg, count } = avgStarRating(u, reviewData, range);
        const fiveStars = countFiveStarReviews(collectFeedbackForNames(new Set([u.name]), reviewData, range));
        return { user: u, visits, rating: avg, ratingCount: count, fiveStars };
      })
      .sort((a, b) => b.visits - a.visits || b.fiveStars - a.fiveStars);
  }, [team, visitSummary, reviewData, range]);

  const audienceLabel =
    audience === "employee" ? "employees" : audience === "contractor" ? "contractors" : "team";

  const openTvView = () => {
    const next = new URLSearchParams(searchParams);
    next.set("tv", "1");
    setSearchParams(next);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="min-h-full bg-gradient-to-br from-emerald-50/40 via-background to-background p-2">
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Team Scoreboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {team.length} active {audienceLabel}
              {sector !== "all" ? ` · ${sector}` : ""} · {monthLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={monthValue} onValueChange={setMonthValue}>
              <SelectTrigger className="h-11 min-w-[200px] text-base font-semibold">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger className="h-11 min-w-[160px]">
                <SelectValue placeholder="Sector" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sectors</SelectItem>
                {sectors.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!tv ? (
              <Button type="button" variant="outline" className="h-11 gap-2" onClick={openTvView}>
                <Monitor className="h-4 w-4" />
                TV view
              </Button>
            ) : null}
          </div>
        </div>

        <div className="inline-flex rounded-lg border bg-card p-1 shadow-sm">
          {(
            [
              ["all", "All"],
              ["employee", "Employees"],
              ["contractor", "Contractors"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAudience(value)}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-semibold transition",
                audience === value
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <KpiCard
            label="Total Visits"
            value={String(teamVisits)}
            delta={formatMomDelta(teamVisits, prevTeamVisits, "number")}
            icon={<CalendarCheck className="h-4 w-4 text-muted-foreground" />}
          />
          <KpiCard
            label="Five-Star Reviews"
            value={String(fiveStarCount)}
            delta={formatMomDelta(fiveStarCount, prevFiveStarCount, "number")}
            icon={<Star className="h-4 w-4 text-amber-500" />}
          />
          <KpiCard
            label="Feedback Received"
            value={String(feedback.length)}
            delta={formatMomDelta(feedback.length, prevFeedback.length, "number")}
            sub={feedbackSub}
            icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
          />
          <KpiCard
            label="Average Rating"
            value={rating.count ? `${rating.avg.toFixed(1)}/5.0` : "—"}
            delta={
              rating.count || prevRating.count
                ? formatMomDelta(rating.avg, prevRating.avg, "rating")
                : { text: "No ratings yet", direction: "flat" as const }
            }
            sub={
              rating.count
                ? `${rating.count} rating${rating.count === 1 ? "" : "s"}`
                : undefined
            }
            icon={<Star className="h-4 w-4 text-amber-500" />}
          />
          <KpiCard
            label="Lock-ins"
            value={String(periodLockIns.length)}
            delta={formatMomDelta(periodLockIns.length, prevLockIns.length, "number")}
            sub={periodLockIns.length ? formatMoney(lockInAmount) : "Confirmed this month"}
            icon={<Lock className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold mb-1 text-lg">Team Client Feedback</h3>
              <p className="text-xs text-muted-foreground mb-4">
                New and current client reviews for filtered staff in {monthLabel}.
              </p>
              {feedback.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No feedback for this filter and month.
                </p>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {feedback.map((fb) => {
                    const rounded = Math.round(fb.rating);
                    return (
                      <div key={fb.id} className="rounded-lg border p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">
                              {fb.clientName || "Anonymous"}
                              {fb.area && (
                                <span className="text-muted-foreground font-normal">
                                  {" "}
                                  — {fb.area}
                                </span>
                              )}
                            </p>
                            {fb.staffNames.length > 0 && (
                              <p className="text-xs text-emerald-700 mt-0.5 truncate">
                                {fb.staffNames.join(", ")}
                              </p>
                            )}
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

          <div className="space-y-6">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Crown className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold text-lg">Leaderboard</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Most visits for {monthLabel}.
              </p>
              <div className="space-y-2 max-h-[42vh] overflow-y-auto">
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No matching staff.</p>
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
                        name={entry.user.name}
                        role={entry.user.role}
                        rating={entry.rating}
                        ratingCount={entry.ratingCount}
                        visits={entry.visits}
                        fiveStars={entry.fiveStars}
                        tone={tone}
                      />
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="h-4 w-4 text-emerald-600" />
                <h3 className="font-semibold">Confirmed lock-ins</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                From Hub lock-in bonuses for this month and filter.
              </p>
              {periodLockIns.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No confirmed lock-ins.</p>
              ) : (
                <ul className="space-y-2 max-h-[28vh] overflow-y-auto">
                  {periodLockIns.slice(0, 20).map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{row.clientName || "Client"}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {row.technicianName}
                          {lockInEventAt(row)
                            ? ` · ${format(new Date(lockInEventAt(row)), "LLL d")}`
                            : ""}
                        </p>
                      </div>
                      <span className="font-semibold whitespace-nowrap">
                        {formatMoney(row.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">People in view</p>
                <p className="text-xl font-bold">{team.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  sub,
  icon,
}: {
  label: string;
  value: string;
  delta: { text: string; direction: "up" | "down" | "flat" };
  sub?: string;
  icon: React.ReactNode;
}) {
  const deltaClass =
    delta.direction === "up"
      ? "text-emerald-600"
      : delta.direction === "down"
        ? "text-red-600"
        : "text-muted-foreground";
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="text-3xl font-bold mt-2 tabular-nums">{value}</p>
      <p className={`text-xs mt-2 font-medium ${deltaClass}`}>{delta.text}</p>
      {sub ? <p className="text-[11px] text-muted-foreground mt-1">{sub}</p> : null}
    </div>
  );
}

function LeaderRow({
  rank,
  initials,
  name,
  role,
  rating,
  ratingCount,
  visits,
  fiveStars,
  tone,
}: {
  rank: number;
  initials: string;
  name: string;
  role: Role;
  rating: number;
  ratingCount: number;
  visits: number;
  fiveStars: number;
  tone?: "gold" | "silver" | "bronze";
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
    <div className="flex items-center gap-3 p-2.5 rounded-lg">
      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${rankTone}`}>
        {rank}
      </div>
      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{name}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          {ratingCount > 0 ? `${rating.toFixed(1)} (${ratingCount})` : "No ratings"}
          {fiveStars > 0 ? ` · ${fiveStars} five-star` : ""}
          <span className="opacity-60">· {role}</span>
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold">{visits}</p>
        <p className="text-[10px] text-muted-foreground">visits</p>
      </div>
    </div>
  );
}
