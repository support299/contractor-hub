import { Toaster } from "@/components/ui/sonner";
import { FormsSection } from "@/components/admin/FormsSection";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function FormsPage() {
  useDocumentTitle("Forms");
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
