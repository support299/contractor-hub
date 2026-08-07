import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { AlertsBanner } from "@/components/AlertsBanner";
import { Button } from "@/components/ui/button";
import { clearAuth, isAdminSession } from "@/lib/api";
import { useSession } from "@/lib/hub-store";

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const admin = isAdminSession(session);
  const navItems = [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/payrolls", label: "Payrolls" },
    { to: "/admin/calendar", label: "Calendar" },
    { to: "/admin/resources", label: "Resources" },
    { to: "/admin/data", label: "Records" },
  ];

  const logout = () => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AlertsBanner />
      <header className="border-b bg-card">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="h-10 w-auto shrink-0" />
            <span className="px-2 py-0.5 rounded-md bg-foreground text-background text-xs font-semibold">
              {admin ? "ADMIN" : "STAFF"}
            </span>
            {session?.name ? (
              <span className="text-sm text-muted-foreground truncate hidden sm:inline">
                {session.name}
              </span>
            ) : null}
          </div>
          <Button variant="outline" size="sm" onClick={logout}>
            Sign out
          </Button>
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
