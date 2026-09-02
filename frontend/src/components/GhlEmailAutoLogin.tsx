import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { getSession, isDisplaySession, loginByEmail } from "@/lib/api";
import {
  emailFromSearch,
  isGhlEmailLoginEnabled,
  stripEmailParams,
} from "@/lib/ghl-email-login";

/** Share one request across React Strict Mode's double effect so cleanup cannot drop the login. */
const inflight = new Map<string, Promise<void>>();
const failed = new Set<string>();

function loginByEmailOnce(email: string) {
  const key = email.trim().toLowerCase();
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = loginByEmail(email)
    .then(() => undefined)
    .catch((err) => {
      failed.add(key);
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, pending);
  return pending;
}

export function GhlEmailAutoLogin({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const email = isGhlEmailLoginEnabled() ? emailFromSearch(location.search) : "";
  const [busy, setBusy] = useState(Boolean(email));

  useEffect(() => {
    if (!email) {
      setBusy(false);
      return;
    }

    const key = email.trim().toLowerCase();
    const stripTo = () =>
      `${location.pathname}${stripEmailParams(location.search)}${location.hash}`;

    const session = getSession();
    if (session?.userId && session.email?.toLowerCase() === key) {
      navigate(isDisplaySession(session) ? "/tv/scoreboard" : stripTo(), { replace: true });
      setBusy(false);
      return;
    }

    if (failed.has(key)) {
      setBusy(false);
      return;
    }

    setBusy(true);
    let active = true;

    (async () => {
      try {
        await loginByEmailOnce(email);
        if (!active) return;
        navigate(isDisplaySession() ? "/tv/scoreboard" : stripTo(), { replace: true });
      } catch {
        /* password / OTP login stays available */
      } finally {
        if (active) setBusy(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [email, location.hash, location.pathname, location.search, navigate]);

  if (busy) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50/60 via-background to-background flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-12 w-auto" />
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        </div>
      </div>
    );
  }

  return children;
}
