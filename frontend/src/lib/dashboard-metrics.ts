import type { DateRange } from "react-day-picker";
import type { HubUser } from "@/lib/hub-store";
import type { HubForm, FormSubmission } from "@/lib/forms-store";

export const PAYROLL_SLUG = "new-payroll-records";
export const BONUS_SLUG = "bonus-submissions";
export const REVIEW_SLUGS = [
  "review-your-recent-experience",
  "how-are-we-doing",
  "evaluez-votre-experience",
  "comment-tu-nous-trouve",
];
export const EFFICIENCY_SLUG = "new-efficiency";

export type FeedbackItem = {
  id: string;
  formName: string;
  clientName: string;
  area: string;
  rating: number;
  comment: string;
  createdAt: string;
  staffNames: string[];
};

export function monthRange(year: number, monthIndex: number): DateRange {
  return {
    from: new Date(year, monthIndex, 1),
    to: new Date(year, monthIndex + 1, 0),
  };
}

export function shiftMonth(
  year: number,
  monthIndex: number,
  delta: number,
): { year: number; month: number } {
  const d = new Date(year, monthIndex + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function findFieldIdsByType(form: HubForm | null, type: string): string[] {
  if (!form) return [];
  return form.fields.filter((f) => f.type === type).map((f) => f.id);
}

export function findFieldIdByLabelContains(form: HubForm | null, needle: string): string | null {
  if (!form) return null;
  const n = needle.toLowerCase();
  return form.fields.find((f) => (f.label ?? "").toLowerCase().includes(n))?.id ?? null;
}

export function findFieldIdByLabelContainsAny(
  form: HubForm | null,
  needles: string[],
): string | null {
  for (const needle of needles) {
    const id = findFieldIdByLabelContains(form, needle);
    if (id) return id;
  }
  return null;
}

export function findFieldId(form: HubForm | null, label: string): string | null {
  if (!form) return null;
  const f = form.fields.find((x) => x.label?.trim().toLowerCase() === label.toLowerCase());
  return f?.id ?? null;
}

export function findFieldIdByType(form: HubForm | null, type: string): string | null {
  if (!form) return null;
  const f = form.fields.find((x) => x.type === type);
  return f?.id ?? null;
}

export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function submissionStaffNames(sub: FormSubmission, form: HubForm): string[] {
  const techId = findFieldIdByType(form, "users");
  if (!techId) return [];
  const v = sub.answers[techId];
  return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
}

export function submissionMatchesUser(
  sub: FormSubmission,
  form: HubForm,
  userName: string,
): boolean {
  return submissionStaffNames(sub, form).includes(userName);
}

export function submissionMatchesAnyUser(
  sub: FormSubmission,
  form: HubForm,
  userNames: Set<string>,
): boolean {
  if (userNames.size === 0) return false;
  return submissionStaffNames(sub, form).some((n) => userNames.has(n));
}

export function inRange(sub: FormSubmission, range: DateRange | undefined): boolean {
  const from = range?.from ? new Date(range.from).getTime() : -Infinity;
  const toDate = range?.to ?? range?.from;
  const to = toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).getTime() : Infinity;
  const t = new Date(sub.createdAt).getTime();
  return t >= from && t <= to;
}

export function dateInRange(iso: string | null | undefined, range: DateRange | undefined): boolean {
  if (!iso) return false;
  const from = range?.from ? new Date(range.from).getTime() : -Infinity;
  const toDate = range?.to ?? range?.from;
  const to = toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).getTime() : Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= from && t <= to;
}

export function avgStarRating(
  user: HubUser | undefined,
  reviewData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): { avg: number; count: number } {
  if (!user) return { avg: 0, count: 0 };
  return avgStarRatingForNames(new Set([user.name]), reviewData, range);
}

export function avgStarRatingForNames(
  userNames: Set<string>,
  reviewData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): { avg: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const { form, subs } of reviewData) {
    const starIds = findFieldIdsByType(form, "star_rating");
    if (!starIds.length) continue;
    for (const sub of subs) {
      if (!inRange(sub, range)) continue;
      if (!submissionMatchesAnyUser(sub, form, userNames)) continue;
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

function feedbackFromSub(
  form: HubForm,
  sub: FormSubmission,
  starIds: string[],
): FeedbackItem {
  const nameId =
    findFieldIdByLabelContainsAny(form, ["your name", "votre nom", "full name", "nom complet"]) ??
    findFieldId(form, "name") ??
    findFieldId(form, "nom");
  const areaId = findFieldIdByLabelContainsAny(form, [
    "area",
    "secteur",
    "région",
    "region",
    "zone",
  ]);
  const commentId =
    findFieldIdByLabelContainsAny(form, [
      "additional thoughts",
      "share",
      "commentaires",
      "remarques",
      "pensées",
      "autres commentaires",
    ]) ??
    form.fields.find((f) => f.type === "multi_line")?.id ??
    null;
  const ratings = starIds.map((id) => num(sub.answers[id])).filter((n) => n > 0);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  return {
    id: sub.id,
    formName: form.name,
    clientName: nameId ? String(sub.answers[nameId] ?? "Anonymous") : "Anonymous",
    area: areaId ? String(sub.answers[areaId] ?? "") : "",
    rating: avg,
    comment: commentId ? String(sub.answers[commentId] ?? "") : "",
    createdAt: sub.createdAt,
    staffNames: submissionStaffNames(sub, form),
  };
}

export function collectFeedback(
  user: HubUser | undefined,
  reviewData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): FeedbackItem[] {
  if (!user) return [];
  return collectFeedbackForNames(new Set([user.name]), reviewData, range);
}

export function collectFeedbackForNames(
  userNames: Set<string>,
  reviewData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): FeedbackItem[] {
  const items: FeedbackItem[] = [];
  for (const { form, subs } of reviewData) {
    const starIds = findFieldIdsByType(form, "star_rating");
    for (const sub of subs) {
      if (!inRange(sub, range)) continue;
      if (!submissionMatchesAnyUser(sub, form, userNames)) continue;
      items.push(feedbackFromSub(form, sub, starIds));
    }
  }
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}

export function computeBonuses(
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

export function computeEarnings(
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

export function computeEfficiencyScore(
  user: HubUser | undefined,
  submissions: FormSubmission[],
  form: HubForm | null,
  range: DateRange | undefined,
): number {
  if (!user || !form) return 100;
  let count = 0;
  for (const sub of submissions) {
    if (!inRange(sub, range)) continue;
    if (!submissionMatchesUser(sub, form, user.name)) continue;
    count += 1;
  }
  return Math.max(0, 100 - count * 5);
}

export function sumForUsers(
  users: HubUser[],
  fn: (u: HubUser) => number,
): number {
  return users.reduce((acc, u) => acc + fn(u), 0);
}

export function avgForUsers(users: HubUser[], fn: (u: HubUser) => number): number {
  if (!users.length) return 0;
  return users.reduce((acc, u) => acc + fn(u), 0) / users.length;
}

export function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatSignedMoney(n: number): string {
  const mag = formatMoney(Math.abs(n));
  if (n > 0) return `+${mag}`;
  if (n < 0) return `−${mag}`;
  return mag;
}

export function formatMomDelta(
  current: number,
  previous: number,
  kind: "money" | "number" | "rating" | "percent",
): { text: string; direction: "up" | "down" | "flat" } {
  const abs = current - previous;
  const direction = abs > 0.0001 ? "up" : abs < -0.0001 ? "down" : "flat";
  let absLabel: string;
  if (kind === "money") absLabel = formatSignedMoney(abs);
  else if (kind === "rating") absLabel = `${abs > 0 ? "+" : abs < 0 ? "" : ""}${abs.toFixed(1)}`;
  else if (kind === "percent") absLabel = `${abs > 0 ? "+" : ""}${Math.round(abs)} pts`;
  else absLabel = `${abs > 0 ? "+" : ""}${Math.round(abs)}`;

  let pct = "";
  if (previous !== 0 && kind !== "rating" && kind !== "percent") {
    const p = (abs / Math.abs(previous)) * 100;
    pct = ` (${p >= 0 ? "+" : ""}${p.toFixed(0)}%)`;
  } else if (previous === 0 && current !== 0 && kind !== "rating" && kind !== "percent") {
    pct = " (new)";
  }
  return { text: `${absLabel} vs last month${pct}`, direction };
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function monthSelectOptions(now = new Date(), count = 24): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString(undefined, { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

export function parseYearMonth(value: string): { year: number; month: number } {
  const [y, m] = value.split("-").map((x) => parseInt(x, 10));
  const year = Number.isFinite(y) ? y : new Date().getFullYear();
  const month = Number.isFinite(m) && m >= 1 && m <= 12 ? m - 1 : new Date().getMonth();
  return { year, month };
}
