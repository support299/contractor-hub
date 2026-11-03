import { api } from "./api";

export type PayRow = {
  id: string;
  type: "pay" | "tip" | "adjustment" | "supplies_deduction" | "restock_deduction";
  date: string;
  week_start: string;
  week_paid: boolean;
  status: "active" | "void";
  contractor_id: string;
  contractor_name: string;
  visit_id?: string | null;
  jobber_visit_id?: string | null;
  client_name?: string;
  job_title?: string;
  visit_status?: string;
  visit_amount?: string;
  discount_share?: string;
  calculated_amount: string;
  amount_paid: string;
  pay_rule: "percent" | "fixed" | "override" | "manual" | null;
  changed_by?: string | null;
  reason?: string;
  note?: string;
  override_id?: string | null;
  deduction_id?: string;
  flags: string[];
};

export type ContractorTotal = {
  contractor_id: string;
  contractor_name: string;
  visits: number;
  pay: string;
  tips: string;
  deductions: string;
  adjustments: string;
  total: string;
};

export type PayWeek = {
  week_start: string;
  week_end: string;
  pay_day: string;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  can_edit: boolean;
  week_over: boolean;
  rules: string;
  summary: { total_paid: string; by_type: Record<string, string>; by_contractor: ContractorTotal[] };
  rows: PayRow[];
  contractors: {
    id: string;
    name: string;
    status: string;
    percent: string | null;
    supplies_deduction: string | null;
  }[];
};

export type ClientRule = {
  id: string;
  client_jobber_id: string;
  client_name: string;
  rule: "percent" | "fixed";
  fixed_amount: string | null;
  note: string;
  changed_by: string | null;
  updated_at: string;
};

export type ClientRules = {
  rules: ClientRule[];
  clients: { client_jobber_id: string; client_name: string; visits: number }[];
};

export type PayLogEntry = {
  at: string;
  by: string | null;
  action: string;
  detail: Record<string, unknown>;
};

export const fetchPayWeek = (week?: string) =>
  api<PayWeek>(`/contractor-pay/${week ? `?week=${week}` : ""}`);

export const markWeekPaid = (weekStart: string) =>
  api(`/contractor-pay/weeks/${weekStart}/paid/`, { method: "POST" });

export const fetchClientRules = () => api<ClientRules>("/contractor-pay/client-rules/");

export const saveClientRule = (body: {
  client_jobber_id: string;
  rule: "percent" | "fixed";
  fixed_amount?: string;
  note?: string;
}) => api("/contractor-pay/client-rules/", { method: "POST", body });

export const deleteClientRule = (id: string) =>
  api(`/contractor-pay/client-rules/${id}/`, { method: "DELETE" });

export const saveOverride = (body: {
  visit_id: string;
  contractor_id: string;
  amount: string;
  reason: string;
}) => api("/contractor-pay/overrides/", { method: "POST", body });

export const deleteOverride = (id: string) =>
  api(`/contractor-pay/overrides/${id}/`, { method: "DELETE" });

export const addRestock = (body: {
  contractor_id: string;
  amount: string;
  date: string;
  note: string;
}) => api("/contractor-pay/restocks/", { method: "POST", body });

export const deleteRestock = (id: string) =>
  api(`/contractor-pay/restocks/${id}/`, { method: "DELETE" });

export const fetchPayLog = () => api<PayLogEntry[]>("/contractor-pay/log/");

export const FLAG_LABELS: Record<string, string> = {
  missing_percent: "No % set",
  amount_needs_review: "Price needs review",
  discount_exceeds_price: "Discount over price",
  estimate: "Not invoiced yet",
  not_completed: "Not completed",
  no_price: "No price",
};

export const RULE_LABELS: Record<string, string> = {
  percent: "%",
  fixed: "Fixed",
  override: "Override",
  manual: "Manual",
};

export const TYPE_LABELS: Record<PayRow["type"], string> = {
  pay: "Pay",
  tip: "Tip",
  adjustment: "Late adjustment",
  supplies_deduction: "Supplies",
  restock_deduction: "Restock",
};
