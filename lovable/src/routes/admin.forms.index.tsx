import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { FormsSection } from "@/components/admin/FormsSection";

export const Route = createFileRoute("/admin/forms/")({
  head: () => ({ meta: [{ title: "Forms — Admin" }] }),
  component: AdminForms,
});

function AdminForms() {
  return (
    <div className="space-y-8">
      <Toaster />
      <div>
        <h1 className="text-2xl font-bold">Forms</h1>
        <p className="text-sm text-muted-foreground">
          Build and manage forms used across the hub.
        </p>
      </div>
      <FormsSection />
    </div>
  );
}
