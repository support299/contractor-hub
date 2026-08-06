import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AdminLayout from "@/pages/AdminLayout";
import DashboardPage from "@/pages/DashboardPage";
import PayrollsPage from "@/pages/PayrollsPage";
import CalendarPage from "@/pages/CalendarPage";
import ResourcesPage from "@/pages/ResourcesPage";
import DataPage from "@/pages/DataPage";
import SettingsPage from "@/pages/SettingsPage";
import FormsPage from "@/pages/FormsPage";
import FormSubmissionsPage from "@/pages/FormSubmissionsPage";
import PublicFormPage from "@/pages/PublicFormPage";

/**
 * Auth matches Lovable: no login gate on /admin/*.
 * Staff picker on the dashboard is local UI state (not authentication).
 */
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/login" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/forms/:slug" element={<PublicFormPage />} />

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="payrolls" element={<PayrollsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="resources" element={<ResourcesPage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="forms" element={<FormsPage />} />
          <Route path="forms/:formId/submissions" element={<FormSubmissionsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
