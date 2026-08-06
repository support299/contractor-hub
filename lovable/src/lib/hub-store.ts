import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
}

export interface Session {
  userId: string;
  role: Role;
  identifier: string;
}

const SESSION_KEY = "cotg.session";
export const DEFAULT_OTP = "201095";

const CHANGE_EVENT = "cotg-storage";

function emitChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

// row shape from supabase
type Row = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  sectors: string[] | null;
  work_days: number | null;
  picture: string | null;
  position: string | null;
  jobber_id: string | null;
  ghl_id: string | null;
  regular_rate: number | null;
  drive_time_rate: number | null;
  fc_rate: number | null;
  tr_rate: number | null;
  supplies_deduction: number | null;
};

function fromRow(r: Row): HubUser {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? "",
    phone: r.phone ?? "",
    role: (r.role as Role) ?? "employee",
    status: (r.status as UserStatus) ?? "active",
    sectors: r.sectors ?? [],
    workDays: r.work_days ?? undefined,
    picture: r.picture ?? undefined,
    position: (r.position as Position | null) ?? undefined,
    jobberId: r.jobber_id ?? undefined,
    ghlId: r.ghl_id ?? undefined,
    regularRate: r.regular_rate ?? undefined,
    driveTimeRate: r.drive_time_rate ?? undefined,
    fcRate: r.fc_rate ?? undefined,
    trRate: r.tr_rate ?? undefined,
    suppliesDeduction: r.supplies_deduction ?? undefined,
  };
}

type RowInsert = Partial<Row> & { name: string };

function toRow(u: Partial<Omit<HubUser, "id">>): Partial<Row> {
  const out: Partial<Row> = {};
  if (u.name !== undefined) out.name = u.name;
  if (u.email !== undefined) out.email = u.email;
  if (u.phone !== undefined) out.phone = u.phone;
  if (u.role !== undefined) out.role = u.role;
  if (u.status !== undefined) out.status = u.status;
  if (u.sectors !== undefined) out.sectors = u.sectors;
  if (u.workDays !== undefined) out.work_days = u.workDays ?? null;
  if (u.picture !== undefined) out.picture = u.picture ?? null;
  if (u.position !== undefined) out.position = u.position ?? null;
  if (u.jobberId !== undefined) out.jobber_id = u.jobberId ?? null;
  if (u.ghlId !== undefined) out.ghl_id = u.ghlId ?? null;
  if (u.regularRate !== undefined) out.regular_rate = u.regularRate ?? null;
  if (u.driveTimeRate !== undefined) out.drive_time_rate = u.driveTimeRate ?? null;
  if (u.fcRate !== undefined) out.fc_rate = u.fcRate ?? null;
  if (u.trRate !== undefined) out.tr_rate = u.trRate ?? null;
  if (u.suppliesDeduction !== undefined) out.supplies_deduction = u.suppliesDeduction ?? null;
  return out;
}

export async function fetchUsers(): Promise<HubUser[]> {
  const { data, error } = await supabase
    .from("hub_users")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("fetchUsers", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(fromRow);
}

export async function addUser(user: Omit<HubUser, "id">): Promise<HubUser | null> {
  const { data, error } = await supabase
    .from("hub_users")
    .insert(toRow(user) as never)
    .select("*")
    .single();
  if (error) {
    console.error("addUser", error);
    throw error;
  }
  emitChange();
  return fromRow(data as Row);
}

export async function updateUser(id: string, patch: Partial<Omit<HubUser, "id">>) {
  const { error } = await supabase.from("hub_users").update(toRow(patch) as never).eq("id", id);
  if (error) {
    console.error("updateUser", error);
    throw error;
  }
  emitChange();
}

export async function deleteUser(id: string) {
  const { error } = await supabase.from("hub_users").delete().eq("id", id);
  if (error) {
    console.error("deleteUser", error);
    throw error;
  }
  const session = getSession();
  if (session && session.userId === id) setSession(null);
  emitChange();
}

export async function findUser(identifier: string, role: Role): Promise<HubUser | undefined> {
  const id = identifier.trim();
  const phoneNorm = id.replace(/\s+/g, "");
  const { data, error } = await supabase
    .from("hub_users")
    .select("*")
    .eq("role", role);
  if (error) {
    console.error("findUser", error);
    return undefined;
  }
  const users = ((data ?? []) as Row[]).map(fromRow);
  return users.find(
    (u) =>
      u.email.toLowerCase() === id.toLowerCase() ||
      u.phone.replace(/\s+/g, "") === phoneNorm,
  );
}

// Session is still local to the device
function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return readSession();
}

export function setSession(session: Session | null) {
  if (typeof window === "undefined") return;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  emitChange();
}

export function useUsers() {
  const [users, setUsers] = useState<HubUser[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const u = await fetchUsers();
      if (active) setUsers(u);
    };
    load();
    const onChange = () => load();
    window.addEventListener(CHANGE_EVENT, onChange);

    // realtime subscription so changes from other devices show up live
    const channel = supabase
      .channel("hub_users-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hub_users" },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener(CHANGE_EVENT, onChange);
      supabase.removeChannel(channel);
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
  const users = await fetchUsers();
  const set = new Set<string>();
  for (const u of users) {
    for (const s of u.sectors ?? []) {
      if (s && s.trim()) set.add(s.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
