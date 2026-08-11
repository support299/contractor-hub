import { useEffect, useState } from "react";
import { api, API_BASE } from "./api";

export type FormStatus = "active" | "inactive";

export type FieldType =
  | "single_line"
  | "multi_line"
  | "number"
  | "dropdown"
  | "multi_dropdown"
  | "radio"
  | "star_rating"
  | "date"
  | "date_time"
  | "users"
  | "payrolls"
  | "file_upload"
  | "image"
  | "headline"
  | "subheadline"
  | "paragraph";

export interface ConditionRule {
  fieldId: string;
  equals: string[];
}

export interface FieldCondition {
  combinator: "and" | "or";
  rules: ConditionRule[];
  fieldId?: string;
  equals?: string[];
}

export function normalizeCondition(cond: FieldCondition | null | undefined): FieldCondition | null {
  if (!cond) return null;
  if (Array.isArray(cond.rules) && cond.rules.length > 0) {
    return { combinator: cond.combinator ?? "and", rules: cond.rules };
  }
  if (cond.fieldId) {
    return {
      combinator: "and",
      rules: [{ fieldId: cond.fieldId, equals: cond.equals ?? [] }],
    };
  }
  return null;
}

export function evaluateCondition(
  cond: FieldCondition | null | undefined,
  answers: Record<string, unknown>,
): boolean {
  const norm = normalizeCondition(cond);
  if (!norm) return true;
  const check = (r: ConditionRule) => {
    const v = answers[r.fieldId];
    const s = v === undefined || v === null ? "" : String(v);
    return r.equals.includes(s);
  };
  return norm.combinator === "or" ? norm.rules.some(check) : norm.rules.every(check);
}

export interface TextStyle {
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  italic?: boolean;
  align?: "left" | "center" | "right";
  href?: string;
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  maxStars?: number;
  condition?: FieldCondition | null;
  content?: string;
  style?: TextStyle;
  imageUrl?: string;
  imageWidth?: number;
  imageAlign?: "left" | "center" | "right";
  accept?: string;
  sourceFormId?: string;
  labelFieldId?: string;
  statusFieldId?: string;
}

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

export interface HubForm {
  id: string;
  name: string;
  description: string;
  slug: string;
  status: FormStatus;
  fields: FormField[];
  extraFields: FormField[];
  createdAt: string;
}

function fromApi(r: Record<string, unknown>): HubForm {
  const fields = Array.isArray(r.fields) ? (r.fields as FormField[]) : [];
  const extra = Array.isArray(r.extraFields)
    ? (r.extraFields as FormField[])
    : Array.isArray(r.extra_fields)
      ? (r.extra_fields as FormField[])
      : [];
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    description: String(r.description ?? ""),
    slug: String(r.slug ?? ""),
    status: (r.status as FormStatus) ?? "active",
    fields,
    extraFields: extra,
    createdAt: String(r.createdAt ?? r.created_at ?? ""),
  };
}

const CHANGE_EVENT = "cotg-forms-storage";
function emitChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function fetchForms(): Promise<HubForm[]> {
  const data = await api<Record<string, unknown>[]>("/forms/");
  return (data ?? []).map(fromApi);
}

export async function fetchFormBySlug(slug: string): Promise<HubForm | null> {
  try {
    const data = await api<Record<string, unknown>>(`/forms/by-slug/${slug}/`, {
      auth: false,
    });
    return fromApi(data);
  } catch {
    return null;
  }
}

export async function fetchFormById(id: string): Promise<HubForm | null> {
  try {
    const data = await api<Record<string, unknown>>(`/forms/${id}/`);
    return fromApi(data);
  } catch {
    return null;
  }
}

export interface FormSubmission {
  id: string;
  formId: string;
  answers: Record<string, unknown>;
  createdAt: string;
}

export async function submitFormAnswers(
  formId: string,
  answers: Record<string, unknown>,
): Promise<FormSubmission> {
  return api<FormSubmission>("/submissions/", {
    method: "POST",
    body: { formId, answers },
    auth: false,
  });
}

export async function fetchSubmissions(formId: string): Promise<FormSubmission[]> {
  const data = await api<FormSubmission[]>(`/submissions/?form=${formId}`);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    formId: String(r.formId),
    answers: r.answers && typeof r.answers === "object" ? r.answers : {},
    createdAt: String(r.createdAt),
  }));
}

export interface PayrollOption {
  id: string;
  label: string;
}

export async function fetchOpenPayrolls(
  sourceFormId: string,
  labelFieldId?: string,
  statusFieldId?: string,
): Promise<PayrollOption[]> {
  if (!sourceFormId) return [];
  const q = new URLSearchParams({ sourceFormId });
  if (labelFieldId) q.set("labelFieldId", labelFieldId);
  if (statusFieldId) q.set("statusFieldId", statusFieldId);
  return api<PayrollOption[]>(`/submissions/open-payrolls/?${q}`);
}

export async function updateSubmission(id: string, answers: Record<string, unknown>) {
  await api(`/submissions/${id}/`, { method: "PATCH", body: { answers } });
}

export async function deleteSubmission(id: string) {
  await api(`/submissions/${id}/`, { method: "DELETE" });
}

export async function addForm(
  form: Omit<HubForm, "id" | "createdAt" | "extraFields"> & { extraFields?: FormField[] },
) {
  await api("/forms/", {
    method: "POST",
    body: {
      name: form.name,
      description: form.description,
      slug: form.slug,
      status: form.status,
      fields: form.fields,
      extraFields: form.extraFields ?? [],
    },
  });
  emitChange();
}

export async function updateForm(id: string, patch: Partial<Omit<HubForm, "id" | "createdAt">>) {
  await api(`/forms/${id}/`, { method: "PATCH", body: patch });
  emitChange();
}

export async function deleteForm(id: string) {
  await api(`/forms/${id}/`, { method: "DELETE" });
  emitChange();
}

export function useForms() {
  const [forms, setForms] = useState<HubForm[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const f = await fetchForms();
        if (active) setForms(f);
      } catch (e) {
        console.error("fetchForms", e);
        if (active) setForms([]);
      }
    };
    load();
    const onChange = () => load();
    window.addEventListener(CHANGE_EVENT, onChange);
    const t = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.clearInterval(t);
    };
  }, []);
  return forms;
}

/** Form slug for payroll line items — Technician is single-select in UI. */
export const PAYROLL_RECORDS_SLUG = "new-payroll-records";

export function isPayrollRecordsSlug(slug: string | null | undefined): boolean {
  return slug === PAYROLL_RECORDS_SLUG;
}

/** Normalize users-field answers (string or string[]) to a name list. */
export function normalizeUserNames(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  const s = String(value).trim();
  return s ? [s] : [];
}

export function singleUserName(value: unknown): string {
  return normalizeUserNames(value)[0] ?? "";
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  single_line: "Single line text",
  number: "Number",
  multi_line: "Multi-line text",
  dropdown: "Dropdown",
  multi_dropdown: "Multi-select dropdown",
  radio: "Radio buttons",
  star_rating: "Star rating",
  date: "Date picker",
  date_time: "Date & time picker",
  users: "Users (multi-select)",
  payrolls: "Payrolls (open payroll periods)",
  file_upload: "File upload",
  image: "Image",
  headline: "Headline",
  subheadline: "Subheadline",
  paragraph: "Paragraph",
};

export const STATIC_TYPES: FieldType[] = ["headline", "subheadline", "paragraph", "image"];
export const STATIC_TEXT_TYPES: FieldType[] = ["headline", "subheadline", "paragraph"];

export function isStaticText(type: FieldType): boolean {
  return STATIC_TEXT_TYPES.includes(type);
}
export function isStaticField(type: FieldType): boolean {
  return STATIC_TYPES.includes(type);
}
export function isConditionSource(type: FieldType): boolean {
  return type === "dropdown" || type === "radio" || type === "star_rating";
}

export function newField(type: FieldType): FormField {
  const id = `f_${Math.random().toString(36).slice(2, 10)}`;
  const base: FormField = { id, type, label: "", required: false, condition: null };
  if (type === "dropdown" || type === "radio" || type === "multi_dropdown") {
    base.options = ["Option 1", "Option 2"];
  }
  if (type === "star_rating") base.maxStars = 5;
  if (type === "headline") {
    base.content = "Headline";
    base.style = { fontSize: 28, fontWeight: 700, color: "#0f172a", align: "left" };
  }
  if (type === "subheadline") {
    base.content = "Subheadline";
    base.style = { fontSize: 20, fontWeight: 600, color: "#334155", align: "left" };
  }
  if (type === "paragraph") {
    base.content = "Add a paragraph of text here.";
    base.style = { fontSize: 14, fontWeight: 400, color: "#475569", align: "left" };
  }
  if (type === "image") {
    base.imageUrl = "";
    base.imageWidth = 240;
    base.imageAlign = "center";
  }
  if (type === "file_upload") base.accept = "";
  return base;
}

export async function uploadFormFile(file: File, prefix = "submissions"): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("prefix", prefix);
  fd.append("bucket", "form-uploads");
  const data = await api<{ path: string; name: string; size: number; type: string }>(
    "/uploads/",
    { method: "POST", formData: fd, auth: false },
  );
  return { path: data.path, name: data.name, size: data.size, type: data.type };
}

export async function getFileSignedUrl(path: string): Promise<string | null> {
  try {
    const data = await api<{ url: string }>(
      `/uploads/url/?path=${encodeURIComponent(path)}`,
      { auth: false },
    );
    return data.url;
  } catch {
    const base = API_BASE.replace(/\/api\/?$/, "");
    return `${base}/media/${path}`;
  }
}

export async function deleteUploadedFile(path: string) {
  await api("/uploads/delete/", { method: "POST", body: { path } });
}
