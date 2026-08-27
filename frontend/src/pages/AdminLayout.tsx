import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { AlertsBanner } from "@/components/AlertsBanner";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { clearAuth, isAdminSession } from "@/lib/api";
import { useSession } from "@/lib/hub-store";

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const admin = isAdminSession(session);
  const [searchParams] = useSearchParams();
  const tv =
    searchParams.get("tv") === "1" && location.pathname.startsWith("/admin/scoreboard");
  const roleLabel = (session?.role || "staff").toUpperCase();
  const navItems = [
    { to: "/admin/dashboard", label: "Dashboard" },
    ...(admin ? [{ to: "/admin/scoreboard", label: "Scoreboard" }] : []),
    { to: "/admin/payrolls", label: "Payrolls" },
    { to: "/admin/calendar", label: "Calendar" },
    { to: "/admin/resources", label: "Resources" },
    ...(admin ? [{ to: "/admin/data", label: "Records" }] : []),
  ];

  const logout = () => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  const exitTvView = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    const next = new URLSearchParams(searchParams);
    next.delete("tv");
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" });
  };

  if (tv) {
    return (
      <div className="min-h-screen bg-background relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute top-3 right-3 z-20 bg-card/90"
          onClick={exitTvView}
        >
          Exit TV view
        </Button>
        <main className="min-h-screen p-3 pt-12">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AlertsBanner />
      <header className="border-b bg-card">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="h-10 w-auto shrink-0" />
            <span className="px-2 py-0.5 rounded-md bg-foreground text-background text-xs font-semibold">
              {roleLabel}
            </span>
            {session?.name ? (
              <span className="text-sm text-muted-foreground truncate hidden sm:inline">
                {session.name}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NotificationBell />
            <Button variant="outline" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="flex-1 px-6 py-6 grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-6 min-h-0">
        <nav className="flex flex-col space-y-1">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition ${
                  active
                    ? "bg-emerald-100 text-emerald-700"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="flex-1 min-h-4" />
          {admin ? (
            <>
              <Link
                to="/admin/settings"
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition ${
                  location.pathname.startsWith("/admin/settings")
                    ? "bg-emerald-100 text-emerald-700"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Settings
              </Link>
              <Link
                to="/admin/forms"
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition ${
                  location.pathname.startsWith("/admin/forms")
                    ? "bg-emerald-100 text-emerald-700"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Forms
              </Link>
            </>
          ) : null}
        </nav>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
