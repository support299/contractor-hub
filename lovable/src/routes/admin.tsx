import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { AlertsBanner } from "@/components/AlertsBanner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Clean on the Go Hub" }] }),
  component: AdminLayout,
});

function AdminLayout() {
  const location = useLocation();
  const navItems = [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/payrolls", label: "Payrolls" },
    { to: "/admin/calendar", label: "Calendar" },
    { to: "/admin/resources", label: "Resources" },
    { to: "/admin/data", label: "Records" },
  ];


  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AlertsBanner />
      <header className="border-b bg-card">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-auto" />
            <span className="px-2 py-0.5 rounded-md bg-foreground text-background text-xs font-semibold">
              ADMIN
            </span>
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
        </nav>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
