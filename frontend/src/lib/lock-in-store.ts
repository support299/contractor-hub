import { api } from "./api";

export type LockInBonusRow = {
  id: string;
  technician: string;
  technicianName: string;
  clientName: string;
  status: string;
  amount: number;
  bonusConfirmed: boolean;
  confirmedDate: string | null;
  createdAt: string;
};

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function normalize(raw: Record<string, unknown>): LockInBonusRow {
  return {
    id: str(raw.id),
    technician: str(raw.technician),
    technicianName: str(raw.technician_name ?? raw.technicianName),
    clientName: str(raw.client_name ?? raw.clientName),
    status: str(raw.status),
    amount: num(raw.amount),
    bonusConfirmed: Boolean(raw.bonus_confirmed ?? raw.bonusConfirmed),
    confirmedDate: (raw.confirmed_date ?? raw.confirmedDate)
      ? str(raw.confirmed_date ?? raw.confirmedDate)
      : null,
    createdAt: str(raw.created_at ?? raw.createdAt),
  };
}

export function isConfirmedLockIn(row: LockInBonusRow): boolean {
  return (
    row.bonusConfirmed ||
    row.status === "confirmed" ||
    row.status === "paid"
  );
}

export function lockInEventAt(row: LockInBonusRow): string {
  return row.confirmedDate || row.createdAt;
}

export async function fetchLockInBonuses(): Promise<LockInBonusRow[]> {
  const rows: LockInBonusRow[] = [];
  let page = 1;
  while (page <= 30) {
    const data = await api<unknown>(`/lock-in-bonuses/?page=${page}`);
    const list = Array.isArray(data)
      ? data
      : ((data as { results?: Record<string, unknown>[] }).results ?? []);
    for (const item of list) {
      if (item && typeof item === "object") rows.push(normalize(item as Record<string, unknown>));
    }
    if (Array.isArray(data)) break;
    const next = (data as { next?: string | null }).next;
    if (!next || list.length === 0) break;
    page += 1;
  }
  return rows;
}

export type VisitSummary = {
  total: number;
  byTechnician: Record<string, number>;
};

export async function fetchVisitSummary(params: {
  startAtAfter?: string;
  startAtBefore?: string;
}): Promise<VisitSummary> {
  const q = new URLSearchParams();
  if (params.startAtAfter) q.set("start_at_after", params.startAtAfter);
  if (params.startAtBefore) q.set("start_at_before", params.startAtBefore);
  const qs = q.toString();
  const data = await api<{ total?: number; by_technician?: Record<string, number> }>(
    `/visits/summary/${qs ? `?${qs}` : ""}`,
  );
  const raw = data?.by_technician ?? {};
  const byTechnician: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    byTechnician[k] = Number(v) || 0;
  }
  return { total: Number(data?.total) || 0, byTechnician };
}

export function rangeToVisitQuery(range: { from?: Date; to?: Date } | undefined): {
  startAtAfter?: string;
  startAtBefore?: string;
} {
  if (!range?.from) return {};
  const start = new Date(range.from);
  start.setHours(0, 0, 0, 0);
  const endSrc = range.to ?? range.from;
  const end = new Date(endSrc);
  end.setHours(23, 59, 59, 999);
  return { startAtAfter: start.toISOString(), startAtBefore: end.toISOString() };
}
