import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getAccessToken } from "@/lib/api";
import {
  clearAllNotifications,
  fetchNotifications,
  isNotification,
  markAllNotificationsRead,
  markNotificationRead,
  notificationsWsUrl,
  type HubNotification,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HubNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications(1);
      setItems(data.results ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch (e) {
      console.error("fetchNotifications", e);
    }
  }, []);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || !aliveRef.current) return;
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    const ws = new WebSocket(notificationsWsUrl(token));
    wsRef.current = ws;
    ws.onopen = () => {
      retryRef.current = 0;
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        if (!isNotification(data)) return;
        setItems((prev) => {
          if (prev.some((n) => n.id === data.id)) {
            return prev.map((n) => (n.id === data.id ? data : n));
          }
          if (!data.readAt) {
            setUnread((n) => n + 1);
          }
          return [data, ...prev];
        });
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (!aliveRef.current) return;
      const delay = Math.min(30000, 1000 * 2 ** retryRef.current);
      retryRef.current = Math.min(retryRef.current + 1, 6);
      timerRef.current = window.setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    connect();
    const onFocus = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        load();
        connect();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      aliveRef.current = false;
      window.removeEventListener("focus", onFocus);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [load, connect]);

  const onClickItem = async (n: HubNotification) => {
    setOpen(false);
    if (!n.readAt) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      setUnread((c) => Math.max(0, c - 1));
      try {
        await markNotificationRead(n.id);
      } catch (e) {
        console.error("markNotificationRead", e);
      }
    }
    if (n.link) navigate(n.link);
  };

  const onMarkAll = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnread(0);
    try {
      await markAllNotificationsRead();
    } catch (err) {
      console.error("markAllNotificationsRead", err);
    }
  };

  const onClearAll = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setItems([]);
    setUnread(0);
    try {
      await clearAllNotifications();
    } catch (err) {
      console.error("clearAllNotifications", err);
      load();
    }
  };

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative shrink-0" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0 max-w-[90vw]">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {items.length > 0 ? (
            <div className="flex items-center gap-2 shrink-0">
              {unread > 0 ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={onMarkAll}
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={onClearAll}
              >
                Clear all
              </button>
            </div>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground px-3 py-8 text-center">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onClickItem(n)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/60 transition",
                  !n.readAt && "bg-emerald-50/70",
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.readAt ? (
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-600 shrink-0" />
                  ) : (
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    <p className="text-sm text-muted-foreground leading-snug mt-0.5">{n.body}</p>
                    {n.createdAt ? (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    ) : null}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
