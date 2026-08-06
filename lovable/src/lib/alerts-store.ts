import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface HubAlert {
  id: string;
  message: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

type Row = {
  id: string;
  message: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

const fromRow = (r: Row): HubAlert => ({
  id: r.id,
  message: r.message,
  active: r.active,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

export async function fetchAlerts(): Promise<HubAlert[]> {
  const { data, error } = await supabase
    .from("hub_alerts" as never)
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("fetchAlerts", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(fromRow);
}

export async function addAlert(message: string, active = true) {
  const { error } = await supabase
    .from("hub_alerts" as never)
    .insert({ message, active } as never);
  if (error) throw error;
}

export async function updateAlert(id: string, patch: Partial<Pick<HubAlert, "message" | "active" | "sortOrder">>) {
  const dbPatch: Record<string, unknown> = {};
  if (patch.message !== undefined) dbPatch.message = patch.message;
  if (patch.active !== undefined) dbPatch.active = patch.active;
  if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
  const { error } = await supabase
    .from("hub_alerts" as never)
    .update(dbPatch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAlert(id: string) {
  const { error } = await supabase.from("hub_alerts" as never).delete().eq("id", id);
  if (error) throw error;
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<HubAlert[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const a = await fetchAlerts();
      if (active) setAlerts(a);
    };
    load();
    const channel = supabase
      .channel(`hub_alerts-changes-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hub_alerts" },
        () => load(),
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);
  return alerts;
}
