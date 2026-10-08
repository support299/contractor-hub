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
export const NEW_CLIENT_REVIEW_SLUGS = [
  "review-your-recent-experience",
  "evaluez-votre-experience",
];
export const CURRENT_CLIENT_REVIEW_SLUGS = [
  "how-are-we-doing",
  "comment-tu-nous-trouve",
];
export const EFFICIENCY_SLUG = "new-efficiency";
export const ABSENCE_SLUG = "new-absence";

/** Complaint / callback forms (slug first, then name). */
export const COMPLAINT_FORM_SLUGS = ["new-complaint", "complaint-callback", "callback"];
/**
 * One Damaged/Lost form covers damaged, broken, and forgotten items.
 * There is no separate broken/forgotten form.
 */
export const DAMAGED_FORM_SLUGS = [
  "damaged-lost-form",
  "damaged-or-lost-item",
  "lost-item",
  "damaged-item",
  "damaged-items",
];

export type IncidentKind = "complaint" | "damaged";

export type IncidentItem = {
  id: string;
  kind: IncidentKind;
  title: string;
  details: { label: string; value: string }[];
  when: string;
};

export type FeedbackItem = {
  id: string;
  formName: string;
  formSlug: string;
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

/** New-client reviews: only "How would you rate the cleaners?" (and FR equivalents). */
const NEW_CLIENT_CLEANER_RATING_NEEDLES = ["cleaners", "nettoyeur", "préposé", "prepose"];

export function starRatingFieldIdsForScore(form: HubForm | null): string[] {
  if (!form) return [];
  const starFields = form.fields.filter((f) => f.type === "star_rating");
  if (!starFields.length) return [];
  if (!NEW_CLIENT_REVIEW_SLUGS.includes(form.slug ?? "")) {
    return starFields.map((f) => f.id);
  }
  const match = starFields.find((f) => {
    const label = (f.label ?? "").toLowerCase();
    return NEW_CLIENT_CLEANER_RATING_NEEDLES.some((n) => label.includes(n));
  });
  return [match?.id ?? starFields[0].id];
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
    const starIds = starRatingFieldIdsForScore(form);
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
    formSlug: form.slug ?? "",
    clientName: nameId ? String(sub.answers[nameId] ?? "Anonymous") : "Anonymous",
    area: areaId ? String(sub.answers[areaId] ?? "") : "",
    rating: avg,
    comment: commentId ? String(sub.answers[commentId] ?? "") : "",
    createdAt: sub.createdAt,
    staffNames: submissionStaffNames(sub, form),
  };
}

export function countFiveStarReviews(items: FeedbackItem[]): number {
  return items.filter((f) => f.rating >= 5).length;
}

export function countFeedbackByAudience(items: FeedbackItem[]): {
  newClients: number;
  currentClients: number;
} {
  let newClients = 0;
  let currentClients = 0;
  for (const item of items) {
    if (NEW_CLIENT_REVIEW_SLUGS.includes(item.formSlug)) newClients += 1;
    else if (CURRENT_CLIENT_REVIEW_SLUGS.includes(item.formSlug)) currentClients += 1;
  }
  return { newClients, currentClients };
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
    const starIds = starRatingFieldIdsForScore(form);
    for (const sub of subs) {
      if (!inRange(sub, range)) continue;
      if (!submissionMatchesAnyUser(sub, form, userNames)) continue;
      items.push(feedbackFromSub(form, sub, starIds));
    }
  }
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}

export const TIP_SLUGS = ["new-tips", "new-tip", "new_tips"];

export function isTipForm(form: HubForm): boolean {
  const slug = (form.slug ?? "").trim().toLowerCase();
  if (TIP_SLUGS.includes(slug)) return true;
  const name = (form.name ?? "").trim().toLowerCase();
  return /\bnew\s+tips?\b/.test(name) || name === "tip" || name === "tips";
}

const TIP_CONFIRMED_VALUES = new Set(["yes", "y", "true", "1", "confirmed", "confirm", "checked", "on"]);

export type TipSummary = {
  /** Sum of confirmed tips credited to the filtered staff (amount × matching staff). */
  total: number;
  /** Confirmed tip submissions that include at least one filtered staff member. */
  count: number;
};

/**
 * Confirmed tips for the given staff in a range. The form amount is "per technician",
 * so each matching technician on a submission is credited the full amount.
 */
export function summarizeTipsForStaff(
  staffKeys: Set<string>,
  tipData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): TipSummary {
  let total = 0;
  let count = 0;
  if (staffKeys.size === 0) return { total, count };
  for (const { form, subs } of tipData) {
    const amountId =
      form.fields.find((f) => f.type === "number" && /tip/i.test(f.label ?? ""))?.id ??
      form.fields.find((f) => f.type === "number" && /per\s+(technician|cleaner)|amount/i.test(f.label ?? ""))
        ?.id ??
      null;
    const confirmId = findFieldIdByLabelContains(form, "confirm");
    if (!amountId) continue;
    for (const sub of subs) {
      if (!inRange(sub, range)) continue;
      if (confirmId) {
        const raw = sub.answers[confirmId];
        const confirmed =
          typeof raw === "boolean" ? raw : TIP_CONFIRMED_VALUES.has(String(raw ?? "").trim().toLowerCase());
        if (!confirmed) continue;
      }
      const matched = submissionStaffNames(sub, form).filter((n) => staffKeys.has(n)).length;
      if (matched === 0) continue;
      total += num(sub.answers[amountId]) * matched;
      count += 1;
    }
  }
  return { total, count };
}

const INCIDENT_EXCLUDE_SLUGS = new Set([
  ...REVIEW_SLUGS,
  PAYROLL_SLUG,
  BONUS_SLUG,
  EFFICIENCY_SLUG,
  ABSENCE_SLUG,
]);

function formSearchText(form: HubForm): string {
  return `${form.slug ?? ""} ${form.name ?? ""}`.toLowerCase();
}

export function incidentKindsForForm(form: HubForm): IncidentKind[] {
  const slug = (form.slug ?? "").toLowerCase();
  if (INCIDENT_EXCLUDE_SLUGS.has(slug)) return [];
  const text = formSearchText(form);
  const kinds: IncidentKind[] = [];
  if (COMPLAINT_FORM_SLUGS.includes(slug) || /\bcomplaint\b|\bcallback\b/.test(text)) {
    kinds.push("complaint");
  }
  if (
    DAMAGED_FORM_SLUGS.includes(slug) ||
    /\bdamaged\b|\blost\b|\bforgotten\b|\bbroken\b/.test(text)
  ) {
    kinds.push("damaged");
  }
  return kinds;
}

export function isIncidentForm(form: HubForm): boolean {
  return incidentKindsForForm(form).length > 0;
}

function incidentFields(form: HubForm) {
  return [...(form.fields ?? []), ...(form.extraFields ?? [])];
}

function answerText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (value.some((v) => v && typeof v === "object")) return "";
    return value.map((v) => String(v).trim()).filter(Boolean).join(", ");
  }
  if (typeof value === "object") return "";
  return String(value).trim();
}

function classifyIncident(form: HubForm): IncidentKind | null {
  return incidentKindsForForm(form)[0] ?? null;
}

function displayAnswer(field: HubForm["fields"][number], value: string): string {
  const label = (field.label ?? "").toLowerCase();
  if (field.type === "number" && /\b(value|amount)\b/.test(label)) {
    const n = num(value);
    if (n || value === "0") return formatMoney(n);
  }
  return value;
}

function incidentWhen(form: HubForm, sub: FormSubmission): string {
  const dateField =
    incidentFields(form).find((f) => (f.label ?? "").trim().toLowerCase() === "date") ??
    incidentFields(form).find((f) => f.type === "date" || f.type === "date_time");
  const raw = dateField ? answerText(sub.answers[dateField.id]) : "";
  return raw || sub.createdAt;
}

function incidentInRange(form: HubForm, sub: FormSubmission, range: DateRange | undefined): boolean {
  const when = incidentWhen(form, sub);
  if (/^\d{4}-\d{2}-\d{2}/.test(when) && !when.includes("T")) {
    return dayInRange(when, range);
  }
  return dateInRange(when, range);
}

function submissionMentionsUser(sub: FormSubmission, form: HubForm, user: HubUser): boolean {
  if (submissionMatchesUser(sub, form, user.name)) return true;
  const id = user.id;
  if (!id) return false;
  return submissionStaffNames(sub, form).includes(id);
}

const TITLE_NEEDLES = ["client name", "client", "customer", "item"];

export function collectIncidents(
  user: HubUser | undefined,
  incidentData: { form: HubForm; subs: FormSubmission[] }[],
  range: DateRange | undefined,
): IncidentItem[] {
  if (!user) return [];
  const items: IncidentItem[] = [];
  for (const { form, subs } of incidentData) {
    if (!isIncidentForm(form)) continue;
    for (const sub of subs) {
      if (!submissionMentionsUser(sub, form, user)) continue;
      if (!incidentInRange(form, sub, range)) continue;
      const kind = classifyIncident(form);
      if (!kind) continue;
      const details: { label: string; value: string }[] = [];
      for (const field of incidentFields(form)) {
        if (
          field.type === "headline" ||
          field.type === "subheadline" ||
          field.type === "paragraph" ||
          field.type === "image" ||
          field.type === "file_upload"
        ) {
          continue;
        }
        const value = displayAnswer(field, answerText(sub.answers[field.id]));
        if (!value) continue;
        details.push({ label: field.label || "Detail", value });
      }
      const titleField = details.find((d) =>
        TITLE_NEEDLES.some((n) => d.label.toLowerCase().includes(n)),
      );
      items.push({
        id: sub.id,
        kind,
        title: titleField?.value || form.name || "Item",
        details: details.slice(0, 6),
        when: incidentWhen(form, sub),
      });
    }
  }
  items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
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

/** Local noon so a date-only answer stays on that calendar day. */
function localDayTime(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return new Date(iso).getTime();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0).getTime();
}

function dayInRange(iso: string, range: DateRange | undefined): boolean {
  const t = localDayTime(iso);
  if (!Number.isFinite(t)) return false;
  const from = range?.from ? new Date(range.from).setHours(0, 0, 0, 0) : -Infinity;
  const toDate = range?.to ?? range?.from;
  const to = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : Infinity;
  return t >= from && t <= to;
}

/**
 * 100%, minus 5 points per New Absence row (Sick, Late, or Absent)
 * whose Date falls in the selected period.
 */
export function computeAttendanceScore(
  user: HubUser | undefined,
  submissions: FormSubmission[],
  form: HubForm | null,
  range: DateRange | undefined,
): number {
  if (!user || !form) return 100;
  const dateId = findFieldId(form, "Date") ?? findFieldIdByType(form, "date");
  let count = 0;
  for (const sub of submissions) {
    if (!submissionMatchesUser(sub, form, user.name)) continue;
    const rawDate = dateId ? String(sub.answers[dateId] ?? "").trim() : "";
    if (rawDate) {
      if (!dayInRange(rawDate, range)) continue;
    } else if (!inRange(sub, range)) {
      continue;
    }
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
