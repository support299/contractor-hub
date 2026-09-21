import { api } from "./api";

export interface HubNotificationEmail {
  id: string;
  email: string;
  label: string;
  active: boolean;
  createdAt: string | null;
}

export async function fetchNotificationEmails(): Promise<HubNotificationEmail[]> {
  return api<HubNotificationEmail[]>("/notification-emails/");
}

export async function addNotificationEmail(
  email: string,
  label = "",
): Promise<HubNotificationEmail> {
  return api<HubNotificationEmail>("/notification-emails/", {
    method: "POST",
    body: { email, label, active: true },
  });
}

export async function updateNotificationEmail(
  id: string,
  patch: Partial<Pick<HubNotificationEmail, "email" | "label" | "active">>,
): Promise<HubNotificationEmail> {
  return api<HubNotificationEmail>(`/notification-emails/${id}/`, {
    method: "PATCH",
    body: patch,
  });
}

export async function deleteNotificationEmail(id: string): Promise<void> {
  await api(`/notification-emails/${id}/`, { method: "DELETE" });
}
