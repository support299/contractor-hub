import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { addAlert, deleteAlert, updateAlert, useAlerts } from "@/lib/alerts-store";

export function AlertsManager() {
  const alerts = useAlerts();
  const [newMessage, setNewMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const handleAdd = async () => {
    const m = newMessage.trim();
    if (!m) return;
    try {
      await addAlert(m);
      setNewMessage("");
      toast.success("Alert added");
    } catch (e) {
      console.error(e);
      toast.error("Could not add alert");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this alert?")) return;
    try {
      await deleteAlert(id);
      toast.success("Alert deleted");
    } catch (e) {
      console.error(e);
      toast.error("Could not delete alert");
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    try {
      await updateAlert(id, { active });
    } catch (e) {
      console.error(e);
      toast.error("Could not update alert");
    }
  };

  const startEdit = (id: string, msg: string) => {
    setEditingId(id);
    setEditingValue(msg);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const m = editingValue.trim();
    if (!m) return;
    try {
      await updateAlert(editingId, { message: m });
      setEditingId(null);
      toast.success("Alert updated");
    } catch (e) {
      console.error(e);
      toast.error("Could not update alert");
    }
  };

  return (
    <section className="bg-card border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="font-semibold">Scrolling alerts</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Active alerts scroll across the top banner of the hub.
        </p>
      </div>

      <div className="px-6 py-4 border-b flex gap-2">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Add a new alert message…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add alert
        </Button>
      </div>

      {alerts.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No alerts yet. Add one above.
        </div>
      ) : (
        <ul className="divide-y">
          {alerts.map((a) => (
            <li key={a.id} className="px-6 py-3 flex items-center gap-3">
              <Switch
                checked={a.active}
                onCheckedChange={(v) => handleToggle(a.id, v)}
              />
              {editingId === a.id ? (
                <>
                  <Input
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveEdit();
                      }
                    }}
                    autoFocus
                    className="flex-1"
                  />
                  <button
                    onClick={saveEdit}
                    className="text-emerald-600 hover:text-emerald-700"
                    aria-label="Save"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${a.active ? "" : "text-muted-foreground line-through"}`}>
                    {a.message}
                  </span>
                  <button
                    onClick={() => startEdit(a.id, a.message)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Edit alert"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="text-muted-foreground hover:text-red-600"
                    aria-label="Delete alert"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
