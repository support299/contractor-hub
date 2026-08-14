import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  deleteSubmission,
  fetchFormById,
  fetchSubmissions,
  getFileSignedUrl,
  isPayrollRecordsSlug,
  normalizeUserNames,
  singleUserName,
  updateSubmission,
  uploadFormFile,
  type FormField,
  type FormSubmission,
  type HubForm,
  type UploadedFile,
} from "@/lib/forms-store";
import { fetchUsers, type HubUser } from "@/lib/hub-store";
import { UsersMultiSelect, UsersSingleSelect } from "@/components/UserFieldSelect";

type Op = "equals" | "contains" | "not_contains";
type FieldFilter = { op: Op; value: string };

function isAnswerField(f: FormField) {
  return (
    f.type !== "headline" &&
    f.type !== "subheadline" &&
    f.type !== "paragraph" &&
    f.type !== "image"
  );
}

function isFileAnswer(v: unknown): v is { path: string; name: string; size?: number; type?: string } {
  return (
    !!v &&
    typeof v === "object" &&
    "path" in (v as Record<string, unknown>) &&
    "name" in (v as Record<string, unknown>)
  );
}

function formatAnswer(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (isFileAnswer(v)) return v.name;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function matchesFilter(value: unknown, filter: FieldFilter): boolean {
  const v = filter.value.trim().toLowerCase();
  if (!v) return true;
  const haystack = (Array.isArray(value) ? value.join(", ") : String(value ?? ""))
    .toLowerCase();
  if (filter.op === "equals") return haystack === v;
  if (filter.op === "contains") return haystack.includes(v);
  return !haystack.includes(v);
}

export default function FormSubmissionsPage() {
  const { formId = "" } = useParams<{ formId: string }>();
  const [form, setForm] = useState<HubForm | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<HubUser[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filters, setFilters] = useState<Record<string, FieldFilter>>({});
  const [editing, setEditing] = useState<FormSubmission | null>(null);

  const load = async () => {
    setLoading(true);
    const [f, s, u] = await Promise.all([
      fetchFormById(formId),
      fetchSubmissions(formId),
      fetchUsers(),
    ]);
    setForm(f);
    setSubmissions(s);
    setUsers(u);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const answerFields = useMemo(
    () => (form?.fields ?? []).filter(isAnswerField),
    [form],
  );

  const filtered = useMemo(() => {
    return submissions.filter((s) => {
      const created = new Date(s.createdAt).getTime();
      if (dateFrom) {
        const from = new Date(dateFrom).getTime();
        if (created < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
        if (created > to) return false;
      }
      for (const f of answerFields) {
        const filter = filters[f.id];
        if (filter && filter.value && !matchesFilter(s.answers[f.id], filter)) {
          return false;
        }
      }
      return true;
    });
  }, [submissions, dateFrom, dateTo, filters, answerFields]);

  const setFilter = (id: string, patch: Partial<FieldFilter>) => {
    setFilters((prev) => ({
      ...prev,
      [id]: { op: prev[id]?.op ?? "contains", value: prev[id]?.value ?? "", ...patch },
    }));
  };
  const clearFilter = (id: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleDelete = async (s: FormSubmission) => {
    if (!confirm("Delete this submission?")) return;
    try {
      await deleteSubmission(s.id);
      setSubmissions((list) => list.filter((x) => x.id !== s.id));
      toast.success("Submission deleted");
    } catch {
      toast.error("Could not delete submission");
    }
  };

  const activeFilterCount =
    Object.values(filters).filter((f) => f.value).length +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  return (
    <div className="space-y-6">
      <Toaster />
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/admin/forms"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" /> Back to forms
          </Link>
          <h1 className="text-2xl font-bold">{form?.name ?? "Submissions"}</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${filtered.length} of ${submissions.length} submission${submissions.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      <section className="bg-card border rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="date-from" className="text-xs">From</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="date-to" className="text-xs">To</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-44"
            />
          </div>
          {activeFilterCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setFilters({});
              }}
            >
              <X className="h-4 w-4" /> Clear filters
            </Button>
          )}
        </div>
      </section>

      <section className="bg-card border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            Loading submissions…
          </div>
        ) : !form ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            Form not found.
          </div>
        ) : submissions.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            No submissions yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Submitted</th>
                  {answerFields.map((f) => (
                    <th key={f.id} className="px-4 py-3 font-medium align-top min-w-[180px]">
                      <div className="space-y-1.5">
                        <div className="truncate" title={f.label}>
                          {f.label || "(untitled)"}
                        </div>
                        <div className="flex gap-1">
                          <Select
                            value={filters[f.id]?.op ?? "contains"}
                            onValueChange={(v) => setFilter(f.id, { op: v as Op })}
                          >
                            <SelectTrigger className="h-7 text-xs px-2 w-[110px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="equals">equals</SelectItem>
                              <SelectItem value="contains">contains</SelectItem>
                              <SelectItem value="not_contains">not contains</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            value={filters[f.id]?.value ?? ""}
                            onChange={(e) => setFilter(f.id, { value: e.target.value })}
                            placeholder="Filter…"
                            className="h-7 text-xs"
                          />
                          {filters[f.id]?.value && (
                            <button
                              type="button"
                              onClick={() => clearFilter(f.id)}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label="Clear"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-t align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    {answerFields.map((f) => {
                      const v = s.answers[f.id];
                      return (
                        <td key={f.id} className="px-4 py-3 text-muted-foreground">
                          <div className="max-w-[260px] whitespace-pre-wrap break-words">
                            {isFileAnswer(v) ? (
                              <FileAnswerLink file={v} />
                            ) : (
                              formatAnswer(v)
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 justify-end">
                        <button
                          onClick={() => setEditing(s)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Edit submission"
                          title="Edit submission"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          className="text-red-600 hover:text-red-700"
                          aria-label="Delete submission"
                          title="Delete submission"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={answerFields.length + 2}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      No submissions match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && (
        <EditSubmissionDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          submission={editing}
          form={form}
          users={users}
          onSaved={(updated) => {
            setSubmissions((list) => list.map((x) => (x.id === updated.id ? updated : x)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

interface EditProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  submission: FormSubmission | null;
  form: HubForm;
  users: HubUser[];
  onSaved: (s: FormSubmission) => void;
}

function EditSubmissionDialog({
  open,
  onOpenChange,
  submission,
  form,
  users,
  onSaved,
}: EditProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (submission) setAnswers({ ...submission.answers });
  }, [submission]);

  if (!submission) return null;

  const setAnswer = (id: string, value: unknown) =>
    setAnswers((a) => ({ ...a, [id]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSubmission(submission.id, answers);
      onSaved({ ...submission, answers });
      toast.success("Submission updated");
    } catch {
      toast.error("Could not update submission");
    } finally {
      setSaving(false);
    }
  };

  const fields = form.fields.filter(isAnswerField);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit submission</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {fields.map((f) => (
            <EditField
              key={f.id}
              field={f}
              value={answers[f.id]}
              onChange={(v) => setAnswer(f.id, v)}
              users={users}
              singleUserSelect={isPayrollRecordsSlug(form.slug)}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditFieldProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  users: HubUser[];
  singleUserSelect?: boolean;
}

function EditField({ field, value, onChange, users, singleUserSelect }: EditFieldProps) {
  const label = (
    <Label className="text-sm">
      {field.label || "(untitled)"}
    </Label>
  );

  switch (field.type) {
    case "single_line":
      return (
        <div className="space-y-1.5">
          {label}
          <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "number":
      return (
        <div className="space-y-1.5">
          {label}
          <Input type="number" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "multi_line":
      return (
        <div className="space-y-1.5">
          {label}
          <Textarea
            rows={3}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "dropdown":
      return (
        <div className="space-y-1.5">
          {label}
          <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "multi_dropdown": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (opt: string) => {
        if (selected.includes(opt)) onChange(selected.filter((n) => n !== opt));
        else onChange([...selected, opt]);
      };
      return (
        <div className="space-y-1.5">
          {label}
          <div className="space-y-1.5">
            {(field.options ?? []).map((opt) => (
              <div key={opt} className="flex items-center gap-2">
                <Checkbox
                  id={`e-${field.id}-${opt}`}
                  checked={selected.includes(opt)}
                  onCheckedChange={() => toggle(opt)}
                />
                <Label htmlFor={`e-${field.id}-${opt}`} className="text-sm cursor-pointer">
                  {opt}
                </Label>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "radio":
      return (
        <div className="space-y-1.5">
          {label}
          <RadioGroup value={(value as string) ?? ""} onValueChange={(v) => onChange(v)}>
            {(field.options ?? []).map((o) => (
              <div key={o} className="flex items-center gap-2">
                <RadioGroupItem value={o} id={`e-${field.id}-${o}`} />
                <Label htmlFor={`e-${field.id}-${o}`} className="text-sm">{o}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      );
    case "star_rating": {
      const max = field.maxStars ?? 5;
      const current = Number(value) || 0;
      return (
        <div className="space-y-1.5">
          {label}
          <div className="flex gap-1">
            {Array.from({ length: max }).map((_, i) => {
              const n = i + 1;
              return (
                <button
                  type="button"
                  key={n}
                  onClick={() => onChange(String(n))}
                  className={n <= current ? "text-amber-500" : "text-muted-foreground"}
                  aria-label={`${n} stars`}
                >
                  <Star className="h-6 w-6" fill={n <= current ? "currentColor" : "none"} />
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "date":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "date_time":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="datetime-local"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "users": {
      const active = users.filter((u) => u.status === "active");
      if (singleUserSelect) {
        const names = normalizeUserNames(value);
        const current = singleUserName(value);
        return (
          <div className="space-y-1.5">
            {label}
            <UsersSingleSelect
              users={active}
              value={current}
              onChange={(name) => onChange(name ? [name] : [])}
            />
            {names.length > 1 && (
              <p className="text-xs text-amber-700">
                This row had {names.length} technicians. Choose one to keep.
                Others: {names.slice(1).join(", ")}
              </p>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-1.5">
          {label}
          <UsersMultiSelect
            users={active}
            value={normalizeUserNames(value)}
            onChange={onChange}
          />
        </div>
      );
    }
    case "file_upload": {
      const current = isFileAnswer(value) ? (value as UploadedFile) : null;
      const handleFile = async (file: File) => {
        try {
          const uploaded = await uploadFormFile(file);
          onChange(uploaded);
        } catch {
          toast.error("Could not upload file");
        }
      };
      return (
        <div className="space-y-1.5">
          {label}
          {current && <FileAnswerLink file={current} />}
          <input
            type="file"
            accept={field.accept || undefined}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-foreground file:cursor-pointer hover:file:bg-muted"
          />
        </div>
      );
    }
    default:
      return null;
  }
}

interface FileAnswerLinkProps {
  file: { path: string; name: string; size?: number };
}

function FileAnswerLink({ file }: FileAnswerLinkProps) {
  const [loading, setLoading] = useState(false);
  const handleOpen = async () => {
    setLoading(true);
    try {
      const url = await getFileSignedUrl(file.path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.error("Could not generate download link");
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={loading}
      className="text-emerald-700 hover:underline text-left break-all"
      title={file.name}
    >
      {loading ? "Loading…" : file.name}
      {file.size ? (
        <span className="text-muted-foreground"> ({Math.round(file.size / 1024)} KB)</span>
      ) : null}
    </button>
  );
}
