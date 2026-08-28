import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getAccessToken, getSession } from "@/lib/api";

/** Require JWT for admin area. Public forms stay open. */
export function RequireAuth() {
  const location = useLocation();
  const token = getAccessToken();
  const session = getSession();
  if (!token || !session?.userId) {
    return (
      <Navigate
        to={`/login${location.search}`}
        replace
        state={{ from: location.pathname }}
      />
    );
  }
  return <Outlet />;
}

/** Admin-only routes (Settings, Forms). */
export function RequireAdmin() {
  const session = getSession();
  if (session?.role !== "admin") {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return <Outlet />;
}
