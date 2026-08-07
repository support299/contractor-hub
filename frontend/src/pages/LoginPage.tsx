import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getAccessToken, getSession, loginPassword } from "@/lib/api";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from || "/admin/dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (getAccessToken() && getSession()?.userId) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginPassword(username.trim(), password);
      toast.success("Signed in");
      navigate(from, { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? String(err.message)
          : "Login failed — check email/password";
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
            <h1 className="text-2xl font-bold tracking-tight">Clean on the Go Hub</h1>
            <p className="text-sm text-muted-foreground mt-1">Admin sign in</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border bg-card p-6 shadow-sm space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="username">Email / username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Existing staff without a password?{" "}
            <Link to="/set-password" className="text-emerald-700 font-medium hover:underline">
              Set password
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
