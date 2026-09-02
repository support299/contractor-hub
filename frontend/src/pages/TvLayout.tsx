import { Outlet, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { clearAuth, isAdminSession } from "@/lib/api";
import { useSession } from "@/lib/hub-store";

export default function TvLayout() {
  const navigate = useNavigate();
  const session = useSession();
  const admin = isAdminSession(session);

  const logout = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    clearAuth();
    navigate("/login", { replace: true });
  };

  const exitToHub = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    navigate("/admin/scoreboard");
  };

  return (
    <div className="min-h-screen bg-background relative">
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {admin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-card/90"
            onClick={exitToHub}
          >
            Exit to Hub
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-card/90"
          onClick={logout}
        >
          Sign out
        </Button>
      </div>
      <main className="min-h-screen p-3 pt-12">
        <Outlet />
      </main>
    </div>
  );
}
