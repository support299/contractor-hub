import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * Short deep link for one record: /admin/submissions/<submission_id>.
 * Looks up which form it belongs to, then opens that form's submissions page with
 * the edit dialog already open. Insights links overdue complaints here.
 */
export default function SubmissionRedirectPage() {
  useDocumentTitle("Opening record");
  const { submissionId = "" } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ formId?: string; form?: string }>(`/submissions/${submissionId}/`)
      .then((s) => {
        const formId = s?.formId || s?.form;
        if (cancelled) return;
        if (!formId) {
          setMissing(true);
          return;
        }
        navigate(
          `/admin/forms/${formId}/submissions?edit=${encodeURIComponent(submissionId)}`,
          { replace: true },
        );
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId, navigate]);

  if (missing) {
    return (
      <div className="space-y-2">
        <p className="text-sm">That record no longer exists, or you don't have access to it.</p>
        <Link to="/admin/forms" className="text-sm underline">
          Go to Forms
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Opening record…
    </div>
  );
}
