import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  addNotificationEmail,
  deleteNotificationEmail,
  fetchNotificationEmails,
  updateNotificationEmail,
  type HubNotificationEmail,
} from "@/lib/notification-emails";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.body && typeof e.body === "object") {
    const body = e.body as Record<string, unknown>;
    const email = body.email;
    if (Array.isArray(email) && email[0]) return String(email[0]);
    if (typeof email === "string") return email;
    if (typeof body.detail === "string") return body.detail;
  }
  return "Could not save";
}

export function EmailNotifyManager() {
  const [rows, setRows] = useState<HubNotificationEmail[]>([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setRows(await fetchNotificationEmails());
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleAdd = async () => {
    const value = email.trim();
    if (!value) return;
    try {
      const row = await addNotificationEmail(value, label.trim(), phone.trim());
      setRows((prev) => [...prev, row].sort((a, b) => a.email.localeCompare(b.email)));
      setEmail("");
      setPhone("");
      setLabel("");
      toast.success("Added");
    } catch (e) {
      console.error(e);
      toast.error(errorMessage(e));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this contact?")) return;
    try {
      await deleteNotificationEmail(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("Removed");
    } catch (e) {
      console.error(e);
      toast.error("Could not remove");
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    try {
      const updated = await updateNotificationEmail(id, { active });
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (e) {
      console.error(e);
      toast.error("Could not update");
    }
  };

  return (
    <section className="bg-card border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="font-semibold">Notifications</h2>
      </div>

      <div className="px-6 py-4 border-b flex flex-col sm:flex-row gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
        />
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          aria-label="Phone"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name"
          aria-label="Name"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
        />
        <Button onClick={() => void handleAdd()} className="shrink-0">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No contacts yet.
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.id} className="px-6 py-3 flex items-center gap-3">
              <Switch
                checked={row.active}
                onCheckedChange={(v) => void handleToggle(row.id, v)}
              />
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate ${row.active ? "" : "text-muted-foreground line-through"}`}>
                  {row.email}
                </div>
                {row.phone || row.label ? (
                  <div className="text-xs text-muted-foreground truncate">
                    {[row.phone, row.label].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </div>
              <button
                onClick={() => void handleDelete(row.id)}
                className="text-muted-foreground hover:text-red-600"
                aria-label="Remove contact"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
