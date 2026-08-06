import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getAccessToken, getSession } from "@/lib/api";

/** Require JWT for admin area. Public forms stay open. */
export function RequireAuth() {
  const location = useLocation();
  const token = getAccessToken();
  const session = getSession();
  if (!token || !session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
