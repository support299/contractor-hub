import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { LogOut, Menu } from "lucide-react";
import { Logo } from "@/components/Logo";
import { AlertsBanner } from "@/components/AlertsBanner";
import { NotificationBell } from "@/components/NotificationBell";
import {
  QuickEntryHeaderButton,
  QuickEntryProvider,
} from "@/components/QuickEntryProvider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { clearAuth, isAdminSession } from "@/lib/api";
import { useSession } from "@/lib/hub-store";
import { cn } from "@/lib/utils";

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const admin = isAdminSession(session);
  const [searchParams] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const roleLabel = (session?.role || "staff").toUpperCase();
  const navItems = [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/quick-entry", label: "Quick Entry" },
    ...(admin ? [{ to: "/admin/scoreboard", label: "Scoreboard" }] : []),
    { to: "/admin/payrolls", label: "Payrolls" },
    { to: "/admin/calendar", label: "Calendar" },
    { to: "/admin/resources", label: "Resources" },
    ...(admin ? [{ to: "/admin/data", label: "Records" }] : []),
  ];
  const adminNavItems = admin
    ? [
        { to: "/admin/settings", label: "Settings" },
        { to: "/admin/forms", label: "Forms" },
      ]
    : [];

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const logout = () => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  if (
    searchParams.get("tv") === "1" &&
    location.pathname.startsWith("/admin/scoreboard")
  ) {
    return <Navigate to="/tv/scoreboard" replace />;
  }

  const navLinkClass = (to: string) =>
    cn(
      "block px-3 py-2 rounded-lg text-sm font-medium transition",
      location.pathname.startsWith(to)
        ? "bg-emerald-100 text-emerald-700"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  const renderLinks = (
    items: { to: string; label: string }[],
    onNavigate?: () => void,
  ) =>
    items.map((item) => (
      <Link key={item.to} to={item.to} onClick={onNavigate} className={navLinkClass(item.to)}>
        {item.label}
      </Link>
    ));

  return (
    <QuickEntryProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <AlertsBanner />
        <header className="border-b bg-card sticky top-0 z-40">
          <div className="px-3 py-2.5 md:px-6 md:py-4 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0"
              aria-label="Open menu"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Logo className="h-8 md:h-10 w-auto max-w-[9.5rem] sm:max-w-[14rem] md:max-w-none shrink min-w-0" />
              <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-foreground text-background text-[10px] sm:text-xs font-semibold shrink-0">
                {roleLabel}
              </span>
              {session?.name ? (
                <span className="text-sm text-muted-foreground truncate hidden lg:inline">
                  {session.name}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <QuickEntryHeaderButton />
              <NotificationBell />
              <Button
                variant="outline"
                size="sm"
                className="hidden md:inline-flex"
                onClick={logout}
              >
                Sign out
              </Button>
            </div>
          </div>
        </header>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-[min(20rem,85vw)] p-0 flex flex-col">
            <SheetHeader className="px-4 py-4 border-b text-left space-y-1">
              <SheetTitle className="text-base">Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Hub navigation
              </SheetDescription>
              {session?.name ? (
                <p className="text-sm text-muted-foreground truncate">{session.name}</p>
              ) : null}
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
              {renderLinks(navItems, () => setNavOpen(false))}
              {adminNavItems.length > 0 ? (
                <div className="mt-3 pt-3 border-t flex flex-col gap-1">
                  {renderLinks(adminNavItems, () => setNavOpen(false))}
                </div>
              ) : null}
            </nav>
            <div className="p-3 border-t">
              <Button variant="outline" className="w-full" onClick={logout}>
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex-1 px-3 py-4 md:px-6 md:py-6 grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-4 md:gap-6 min-h-0">
          <nav className="hidden md:flex flex-col space-y-1">
            {renderLinks(navItems)}
            <div className="flex-1 min-h-4" />
            {renderLinks(adminNavItems)}
          </nav>
          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </QuickEntryProvider>
  );
}
