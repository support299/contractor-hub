import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, fetchMe, getSession, updateMe } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function ProfilePage() {
  useDocumentTitle("Profile");
  const session = getSession();
  const [email, setEmail] = useState(session?.email || "");
  const [phone, setPhone] = useState(session?.phone || "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchMe()
      .then((me) => {
        if (!alive) return;
        setEmail(me.email || "");
        setPhone(me.phone || "");
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const me = await updateMe({ email: email.trim(), phone: phone.trim() });
      setEmail(me.email || "");
      setPhone(me.phone || "");
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold">{session?.name || "Profile"}</h1>
      <form
        onSubmit={(e) => void onSave(e)}
        className="bg-card border rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">Phone</Label>
            <Input
              id="profile-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              disabled={loading}
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end">
          <Button type="submit" disabled={loading || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}
