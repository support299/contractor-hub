import { api, API_BASE } from "./api";

export type HubNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type NotificationList = {
  count: number;
  results: HubNotification[];
  unreadCount: number;
};

export async function fetchNotifications(page = 1): Promise<NotificationList> {
  return api<NotificationList>(`/notifications/?page=${page}`);
}

export async function fetchUnreadCount(): Promise<number> {
  const data = await api<{ unreadCount: number }>("/notifications/unread-count/");
  return data.unreadCount ?? 0;
}

export async function markNotificationRead(id: string): Promise<HubNotification> {
  return api<HubNotification>(`/notifications/${id}/read/`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await api("/notifications/read-all/", { method: "POST" });
}

export function notificationsWsUrl(token: string): string {
  const api = (API_BASE || "").replace(/\/$/, "");
  const origin = api.replace(/\/api$/, "");
  const wsOrigin = origin.startsWith("https")
    ? origin.replace(/^https/, "wss")
    : origin.replace(/^http/, "ws");
  return `${wsOrigin}/ws/notifications/?token=${encodeURIComponent(token)}`;
}

export function isNotification(value: unknown): value is HubNotification {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.type === "string" && typeof v.body === "string";
}
