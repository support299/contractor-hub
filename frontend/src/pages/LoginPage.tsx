import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  ApiError,
  getAccessToken,
  getSession,
  homePathForSession,
  isDisplaySession,
  loginPassword,
  requestOtp,
  verifyOtp,
} from "@/lib/api";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from || homePathForSession();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setAuthTick] = useState(0);

  useEffect(() => {
    const bump = () => setAuthTick((n) => n + 1);
    window.addEventListener("cotg-storage", bump);
    return () => window.removeEventListener("cotg-storage", bump);
  }, []);

  if (getAccessToken() && getSession()?.userId) {
    const session = getSession();
    const dest = isDisplaySession(session) ? "/tv/scoreboard" : from;
    return <Navigate to={dest} replace />;
  }

  const onPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await loginPassword(username.trim(), password);
      toast.success("Signed in");
      navigate(isDisplaySession() ? "/tv/scoreboard" : from, { replace: true });
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

  const onRequestOtp = async (e?: FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    try {
      await requestOtp(phone.trim());
      setOtpSent(true);
      setOtp("");
      toast.success("Code sent — check your phone");
    } catch (err) {
      const msg =
        err instanceof ApiError ? String(err.message) : "Failed to send code";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const onVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await verifyOtp(phone.trim(), otp.trim());
      toast.success("Signed in");
      navigate(isDisplaySession() ? "/tv/scoreboard" : from, { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiError ? String(err.message) : "Invalid or expired code";
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
            <p className="text-sm text-muted-foreground mt-1">Staff sign in</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <Tabs defaultValue="password">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="password">Email & password</TabsTrigger>
              <TabsTrigger value="phone">Phone OTP</TabsTrigger>
            </TabsList>

            <TabsContent value="password">
              <form onSubmit={onPasswordSubmit} className="space-y-4">
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
                  <Link
                    to="/set-password"
                    className="text-emerald-700 font-medium hover:underline"
                  >
                    Set password
                  </Link>
                </p>
              </form>
            </TabsContent>

            <TabsContent value="phone">
              {!otpSent ? (
                <form onSubmit={onRequestOtp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 555 555 5555"
                      autoComplete="tel"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Use the phone on your staff profile.
                    </p>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Sending…" : "Send code"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={onVerifyOtp} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter the code sent to <span className="font-medium text-foreground">{phone}</span>
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="otp">Verification code</Label>
                    <InputOTP
                      maxLength={6}
                      value={otp}
                      onChange={setOtp}
                      containerClassName="justify-center"
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || otp.length !== 6}
                  >
                    {loading ? "Verifying…" : "Verify & sign in"}
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      className="text-muted-foreground hover:underline"
                      onClick={() => {
                        setOtpSent(false);
                        setOtp("");
                      }}
                      disabled={loading}
                    >
                      Change phone
                    </button>
                    <button
                      type="button"
                      className="text-emerald-700 font-medium hover:underline"
                      onClick={() => onRequestOtp()}
                      disabled={loading}
                    >
                      Resend code
                    </button>
                  </div>
                </form>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
