import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  evaluateCondition,
  fetchFormBySlug,
  submitFormAnswers,
  type HubForm,
} from "@/lib/forms-store";
import { fetchUsers, type HubUser } from "@/lib/hub-store";
import { FieldRenderer, isStaticType } from "@/pages/PublicFormPage";

interface Props {
  slug: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmitted?: () => void;
  title?: string;
}

export function FormSubmitDialog({ slug, open, onOpenChange, onSubmitted, title }: Props) {
  const [form, setForm] = useState<HubForm | null>(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<HubUser[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAnswers({});
    setLoading(true);
    Promise.all([fetchFormBySlug(slug), fetchUsers()]).then(([f, u]) => {
      setForm(f);
      setUsers(u);
      setLoading(false);
    });
  }, [open, slug]);

  const visibleFields = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((f) => evaluateCondition(f.condition, answers));
  }, [form, answers]);

  const setAnswer = (id: string, value: unknown) =>
    setAnswers((a) => ({ ...a, [id]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    for (const f of visibleFields) {
      if (f.required && !isStaticType(f.type)) {
        const v = answers[f.id];
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
          toast.error(`${f.label || "Field"} is required`);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of visibleFields) {
        if (isStaticType(f.type)) continue;
        if (answers[f.id] !== undefined) payload[f.id] = answers[f.id];
      }
      await submitFormAnswers(form.id, payload);
      toast.success("Submitted");
      onOpenChange(false);
      onSubmitted?.();
    } catch {
      toast.error("Could not submit. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title ?? form?.name ?? "Submit"}</DialogTitle>
          {form?.description && <DialogDescription>{form.description}</DialogDescription>}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : !form ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Form not found.</div>
          ) : (
            <form id="form-submit-dialog" onSubmit={handleSubmit} className="space-y-5 py-2">
              {visibleFields.map((f) => (
                <FieldRenderer
                  key={f.id}
                  field={f}
                  value={answers[f.id]}
                  onChange={(v) => setAnswer(f.id, v)}
                  users={users}
                />
              ))}
            </form>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="form-submit-dialog" disabled={submitting || !form}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
