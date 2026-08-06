import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAccessToken, loginPassword } from "@/lib/api";
import { toast } from "sonner";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/admin/dashboard";
  const [username, setUsername] = useState("admin@cotg.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (getAccessToken()) {
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
      console.error(err);
      toast.error("Login failed — check username/password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 border rounded-xl bg-card p-6 shadow-sm"
      >
        <div className="flex flex-col items-center gap-2 mb-2">
          <Logo className="h-12 w-auto" />
          <h1 className="text-lg font-semibold">Admin sign in</h1>
          <p className="text-sm text-muted-foreground text-center">
            Clean on the Go Hub
          </p>
        </div>
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
      </form>
    </div>
  );
}
