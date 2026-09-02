import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { GhlEmailAutoLogin } from "@/components/GhlEmailAutoLogin";
import {
  RequireAdmin,
  RequireAuth,
  RequireNotDisplay,
  RequireScoreboardAccess,
} from "@/components/RequireAuth";
import { getSession, isDisplaySession } from "@/lib/api";
import AdminLayout from "@/pages/AdminLayout";
import TvLayout from "@/pages/TvLayout";
import DashboardPage from "@/pages/DashboardPage";
import ScoreboardPage from "@/pages/ScoreboardPage";
import PayrollsPage from "@/pages/PayrollsPage";
import CalendarPage from "@/pages/CalendarPage";
import ResourcesPage from "@/pages/ResourcesPage";
import DataPage from "@/pages/DataPage";
import SettingsPage from "@/pages/SettingsPage";
import FormsPage from "@/pages/FormsPage";
import FormSubmissionsPage from "@/pages/FormSubmissionsPage";
import PublicFormPage from "@/pages/PublicFormPage";
import LoginPage from "@/pages/LoginPage";
import SetPasswordPage from "@/pages/SetPasswordPage";

function HomeRedirect() {
  const location = useLocation();
  const to = isDisplaySession(getSession()) ? "/tv/scoreboard" : "/admin/dashboard";
  return <Navigate to={`${to}${location.search}`} replace />;
}

export default function App() {
  return (
    <>
      <GhlEmailAutoLogin>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/forms/:slug" element={<PublicFormPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<RequireScoreboardAccess />}>
              <Route path="/tv/scoreboard" element={<TvLayout />}>
                <Route index element={<ScoreboardPage />} />
              </Route>
            </Route>
            <Route element={<RequireNotDisplay />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="payrolls" element={<PayrollsPage />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="resources" element={<ResourcesPage />} />
                <Route element={<RequireAdmin />}>
                  <Route path="scoreboard" element={<ScoreboardPage />} />
                  <Route path="data" element={<DataPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="forms" element={<FormsPage />} />
                  <Route path="forms/:formId/submissions" element={<FormSubmissionsPage />} />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </GhlEmailAutoLogin>
      <Toaster />
    </>
  );
}
