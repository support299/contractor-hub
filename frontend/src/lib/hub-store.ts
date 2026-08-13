import { useEffect, useState } from "react";
import { api, getSession, type Session } from "./api";

export type Role = "employee" | "contractor" | "admin";
export type UserStatus = "active" | "inactive";

export const POSITIONS = [
  "Team Leader",
  "Production Manager",
  "Supervisor",
  "Cleaning Specialist",
  "Cleaning Technician",
  "Specialty Cleaner",
  "Marketing Manager",
  "Sub Contractor",
] as const;

export type Position = (typeof POSITIONS)[number];

export interface HubUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: UserStatus;
  sectors: string[];
  workDays?: number;
  picture?: string;
  position?: Position;
  jobberId?: string;
  ghlId?: string;
  regularRate?: number;
  driveTimeRate?: number;
  fcRate?: number;
  trRate?: number;
  suppliesDeduction?: number;
  passwordConfigured?: boolean;
  hireDate?: string | null;
  availableVacationDays?: number;
}

export { getSession };
export type { Session };

const CHANGE_EVENT = "cotg-storage";

function emitChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function normalize(u: Record<string, unknown>): HubUser {
  return {
    id: String(u.id),
    name: String(u.name ?? ""),
    email: String(u.email ?? ""),
    phone: String(u.phone ?? ""),
    role: (u.role as Role) ?? "employee",
    status: (u.status as UserStatus) ?? "active",
    sectors: Array.isArray(u.sectors) ? (u.sectors as string[]) : [],
    workDays: num(u.workDays),
    picture: (u.picture as string) || undefined,
    position: (u.position as Position) || undefined,
    jobberId: (u.jobberId as string) || undefined,
    ghlId: (u.ghlId as string) || undefined,
    regularRate: num(u.regularRate),
    driveTimeRate: num(u.driveTimeRate),
    fcRate: num(u.fcRate),
    trRate: num(u.trRate),
    suppliesDeduction: num(u.suppliesDeduction),
    passwordConfigured: Boolean(u.passwordConfigured),
    hireDate: (u.hireDate as string) || undefined,
    availableVacationDays: num(u.availableVacationDays),
  };
}

export async function fetchUsers(): Promise<HubUser[]> {
  const data = await api<Record<string, unknown>[]>("/users/");
  return (data ?? []).map(normalize);
}

export async function addUser(user: Omit<HubUser, "id">): Promise<HubUser | null> {
  const data = await api<Record<string, unknown>>("/users/", {
    method: "POST",
    body: user,
  });
  emitChange();
  return normalize(data);
}

export async function updateUser(id: string, patch: Partial<Omit<HubUser, "id">>) {
  await api(`/users/${id}/`, { method: "PATCH", body: patch });
  emitChange();
}

export async function deleteUser(id: string) {
  await api(`/users/${id}/`, { method: "DELETE" });
  emitChange();
}

export async function findUser(identifier: string, role: Role): Promise<HubUser | undefined> {
  const users = await fetchUsers();
  const id = identifier.trim();
  const phoneNorm = id.replace(/\s+/g, "");
  return users.find(
    (u) =>
      u.role === role &&
      (u.email.toLowerCase() === id.toLowerCase() ||
        u.phone.replace(/\s+/g, "") === phoneNorm),
  );
}

export function useUsers() {
  const [users, setUsers] = useState<HubUser[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const u = await fetchUsers();
        if (active) setUsers(u);
      } catch (e) {
        console.error("fetchUsers", e);
        if (active) setUsers([]);
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
  return users;
}

export function useSession() {
  const [session, setSessionState] = useState<Session | null>(null);
  useEffect(() => {
    setSessionState(getSession());
    const onChange = () => setSessionState(getSession());
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return session;
}

export async function getSectors(): Promise<string[]> {
  try {
    return await api<string[]>("/users/sectors/");
  } catch {
    const users = await fetchUsers();
    const set = new Set<string>();
    for (const u of users) for (const s of u.sectors ?? []) if (s?.trim()) set.add(s.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }
}
