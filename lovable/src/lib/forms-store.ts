import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  // legacy shape — kept optional for back-compat with previously saved forms
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
  fontSize?: number; // px
  color?: string; // hex / css color
  fontWeight?: number; // 100..900
  italic?: boolean;
  align?: "left" | "center" | "right";
  href?: string; // optional hyperlink target
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[]; // for dropdown/radio
  maxStars?: number; // for star_rating
  condition?: FieldCondition | null;
  // For headline/subheadline/paragraph
  content?: string;
  style?: TextStyle;
  // For static image fields
  imageUrl?: string;
  imageWidth?: number; // px
  imageAlign?: "left" | "center" | "right";
  // For file_upload
  accept?: string; // MIME or extension filter
  // For payrolls
  sourceFormId?: string;
  labelFieldId?: string;
  statusFieldId?: string;
}

export interface UploadedFile {
  path: string; // storage object key
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

type Row = {
  id: string;
  name: string;
  description: string | null;
  slug: string | null;
  status: string;
  fields: unknown;
  extra_fields?: unknown;
  created_at: string;
};

function parseFields(raw: unknown): FormField[] {
  if (Array.isArray(raw)) return raw as FormField[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as FormField[];
    } catch {
      return [];
    }
  }
  return [];
}

function fromRow(r: Row): HubForm {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    slug: r.slug ?? "",
    status: (r.status as FormStatus) ?? "active",
    fields: parseFields(r.fields),
    extraFields: parseFields(r.extra_fields),
    createdAt: r.created_at,
  };
}

const CHANGE_EVENT = "cotg-forms-storage";
function emitChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
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
  const { data, error } = await supabase
    .from("hub_forms" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchForms", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(fromRow);
}

export async function fetchFormBySlug(slug: string): Promise<HubForm | null> {
  const { data, error } = await supabase
    .from("hub_forms" as never)
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("fetchFormBySlug", error);
    return null;
  }
  return data ? fromRow(data as Row) : null;
}

export async function submitFormAnswers(formId: string, answers: Record<string, unknown>) {
  const { error } = await supabase
    .from("hub_form_submissions" as never)
    .insert({ form_id: formId, answers } as never);
  if (error) {
    console.error("submitFormAnswers", error);
    throw error;
  }
}

export interface FormSubmission {
  id: string;
  formId: string;
  answers: Record<string, unknown>;
  createdAt: string;
}

export async function fetchFormById(id: string): Promise<HubForm | null> {
  const { data, error } = await supabase
    .from("hub_forms" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("fetchFormById", error);
    return null;
  }
  return data ? fromRow(data as Row) : null;
}

export async function fetchSubmissions(formId: string): Promise<FormSubmission[]> {
  const { data, error } = await supabase
    .from("hub_form_submissions" as never)
    .select("*")
    .eq("form_id", formId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchSubmissions", error);
    return [];
  }
  return ((data ?? []) as Array<{ id: string; form_id: string; answers: unknown; created_at: string }>).map((r) => ({
    id: r.id,
    formId: r.form_id,
    answers: (r.answers && typeof r.answers === "object" ? (r.answers as Record<string, unknown>) : {}),
    createdAt: r.created_at,
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
  const subs = await fetchSubmissions(sourceFormId);
  const filtered = statusFieldId
    ? subs.filter((s) => {
        const v = s.answers[statusFieldId];
        return typeof v === "string" && v.toLowerCase().includes("open");
      })
    : subs;
  return filtered.map((s) => {
    let label = "";
    if (labelFieldId) {
      const v = s.answers[labelFieldId];
      if (v !== undefined && v !== null) label = String(v);
    }
    if (!label) {
      const firstString = Object.values(s.answers).find(
        (v) => typeof v === "string" && v.trim() !== "",
      );
      label = firstString ? String(firstString) : `Submission ${s.id.slice(0, 6)}`;
    }
    return { id: s.id, label };
  });
}

export async function updateSubmission(id: string, answers: Record<string, unknown>) {
  const { error } = await supabase
    .from("hub_form_submissions" as never)
    .update({ answers } as never)
    .eq("id", id);
  if (error) {
    console.error("updateSubmission", error);
    throw error;
  }
}

export async function deleteSubmission(id: string) {
  const { error } = await supabase
    .from("hub_form_submissions" as never)
    .delete()
    .eq("id", id);
  if (error) {
    console.error("deleteSubmission", error);
    throw error;
  }
}

export async function addForm(form: Omit<HubForm, "id" | "createdAt" | "extraFields"> & { extraFields?: FormField[] }) {
  const { error } = await supabase
    .from("hub_forms" as never)
    .insert({
      name: form.name,
      description: form.description,
      slug: form.slug,
      status: form.status,
      fields: form.fields,
      extra_fields: form.extraFields ?? [],
    } as never);
  if (error) {
    console.error("addForm", error);
    throw error;
  }
  emitChange();
}

export async function updateForm(id: string, patch: Partial<Omit<HubForm, "id" | "createdAt">>) {
  const dbPatch: Record<string, unknown> = { ...patch };
  if ("extraFields" in dbPatch) {
    dbPatch.extra_fields = dbPatch.extraFields;
    delete dbPatch.extraFields;
  }
  const { error } = await supabase
    .from("hub_forms" as never)
    .update(dbPatch as never)
    .eq("id", id);
  if (error) {
    console.error("updateForm", error);
    throw error;
  }
  emitChange();
}

export async function deleteForm(id: string) {
  const { error } = await supabase.from("hub_forms" as never).delete().eq("id", id);
  if (error) {
    console.error("deleteForm", error);
    throw error;
  }
  emitChange();
}

export function useForms() {
  const [forms, setForms] = useState<HubForm[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const f = await fetchForms();
      if (active) setForms(f);
    };
    load();
    const onChange = () => load();
    window.addEventListener(CHANGE_EVENT, onChange);

    const channel = supabase
      .channel(`hub_forms-changes-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hub_forms" },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener(CHANGE_EVENT, onChange);
      supabase.removeChannel(channel);
    };
  }, []);
  return forms;
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

export const STATIC_TYPES: FieldType[] = [
  "headline",
  "subheadline",
  "paragraph",
  "image",
];

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
  if (type === "star_rating") {
    base.maxStars = 5;
  }
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
  if (type === "file_upload") {
    base.accept = "";
  }
  return base;
}

// ---- Storage helpers ----

const UPLOAD_BUCKET = "form-uploads";

export async function uploadFormFile(file: File, prefix = "submissions"): Promise<UploadedFile> {
  const rand = Math.random().toString(36).slice(2, 10);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${prefix}/${Date.now()}_${rand}_${safeName}`;
  const { error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) {
    console.error("uploadFormFile", error);
    throw error;
  }
  return { path, name: file.name, size: file.size, type: file.type };
}

export async function getFileSignedUrl(path: string, expiresIn = 60 * 60): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) {
    console.error("getFileSignedUrl", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
