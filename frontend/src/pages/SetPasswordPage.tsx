import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getAccessToken, getSession, homePathForSession, setPassword } from "@/lib/api";

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  if (getAccessToken() && getSession()?.userId) {
    return <Navigate to={homePathForSession()} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await setPassword(email.trim(), password, confirm);
      toast.success("Password set — you're signed in");
      navigate(homePathForSession(), { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? String(err.message)
          : "Could not set password";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50/60 via-background to-background flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-12 w-auto" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Set your password</h1>
            <p className="text-sm text-muted-foreground mt-1">
              For existing staff accounts that have not signed in yet. Use the email on your
              profile.
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border bg-card p-6 shadow-sm space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving…" : "Set password & sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already set up?{" "}
            <Link to="/login" className="text-emerald-700 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
