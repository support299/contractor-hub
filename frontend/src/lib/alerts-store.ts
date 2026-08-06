import { useEffect, useState } from "react";
import { api } from "./api";

export interface HubAlert {
  id: string;
  message: string;
  active: boolean;
  sortOrder?: number;
  createdAt: string;
}

const CHANGE_EVENT = "cotg-alerts-storage";
function emitChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export async function fetchAlerts(): Promise<HubAlert[]> {
  return api<HubAlert[]>("/alerts/", { auth: false });
}

export async function fetchActiveAlerts(): Promise<HubAlert[]> {
  return api<HubAlert[]>("/alerts/active/", { auth: false });
}

export async function addAlert(message: string): Promise<HubAlert> {
  const alert = await api<HubAlert>("/alerts/", {
    method: "POST",
    body: { message, active: true },
  });
  emitChange();
  return alert;
}

export async function updateAlert(
  id: string,
  patch: Partial<Pick<HubAlert, "message" | "active" | "sortOrder">>,
): Promise<HubAlert> {
  const alert = await api<HubAlert>(`/alerts/${id}/`, {
    method: "PATCH",
    body: patch,
  });
  emitChange();
  return alert;
}

export async function deleteAlert(id: string): Promise<void> {
  await api(`/alerts/${id}/`, { method: "DELETE" });
  emitChange();
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<HubAlert[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const a = await fetchAlerts();
        if (active) setAlerts(a);
      } catch (e) {
        console.error("fetchAlerts", e);
        if (active) setAlerts([]);
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
  return alerts;
}
