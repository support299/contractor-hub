import { api } from "./api";

export type NotifyChannel = "email" | "sms" | "both";

export interface HubNotificationEmail {
  id: string;
  email: string;
  phone: string;
  label: string;
  active: boolean;
  createdAt: string | null;
}

export interface HubNotifyPrefs {
  channel: NotifyChannel;
}

export async function fetchNotificationEmails(): Promise<HubNotificationEmail[]> {
  return api<HubNotificationEmail[]>("/notification-emails/");
}

export async function addNotificationEmail(
  email: string,
  label = "",
  phone = "",
): Promise<HubNotificationEmail> {
  return api<HubNotificationEmail>("/notification-emails/", {
    method: "POST",
    body: { email, label, phone, active: true },
  });
}

export async function updateNotificationEmail(
  id: string,
  patch: Partial<Pick<HubNotificationEmail, "email" | "phone" | "label" | "active">>,
): Promise<HubNotificationEmail> {
  return api<HubNotificationEmail>(`/notification-emails/${id}/`, {
    method: "PATCH",
    body: patch,
  });
}

export async function deleteNotificationEmail(id: string): Promise<void> {
  await api(`/notification-emails/${id}/`, { method: "DELETE" });
}

export async function fetchNotifyPrefs(): Promise<HubNotifyPrefs> {
  return api<HubNotifyPrefs>("/notification-prefs/");
}

export async function updateNotifyPrefs(
  patch: Partial<HubNotifyPrefs>,
): Promise<HubNotifyPrefs> {
  return api<HubNotifyPrefs>("/notification-prefs/", {
    method: "PATCH",
    body: patch,
  });
}
