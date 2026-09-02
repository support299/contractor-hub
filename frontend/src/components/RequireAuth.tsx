import { Navigate, Outlet, useLocation } from "react-router-dom";
import {
  getAccessToken,
  getSession,
  homePathForSession,
  isAdminSession,
  isDisplaySession,
} from "@/lib/api";

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
  if (!isAdminSession(session)) {
    return <Navigate to={homePathForSession(session)} replace />;
  }
  return <Outlet />;
}

/** Display (TV) accounts cannot enter the rest of the Hub. */
export function RequireNotDisplay() {
  const session = getSession();
  if (isDisplaySession(session)) {
    return <Navigate to="/tv/scoreboard" replace />;
  }
  return <Outlet />;
}

/** Admin or office-TV display — team scoreboard only. */
export function RequireScoreboardAccess() {
  const session = getSession();
  if (session?.role === "admin" || session?.role === "display") {
    return <Outlet />;
  }
  return <Navigate to={homePathForSession(session)} replace />;
}
