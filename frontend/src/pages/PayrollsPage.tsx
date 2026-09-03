import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, DollarSign, Trash2, Loader2, FilePlus } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FormSubmitDialog } from "@/components/FormSubmitDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUsers, useSession } from "@/lib/hub-store";
import { isAdminSession } from "@/lib/api";
import {
  deleteSubmission,
  fetchForms,
  fetchSubmissions,
  PAYROLL_RECORDS_SLUG,
  type FormField,
  type FormSubmission,
  type HubForm,
} from "@/lib/forms-store";
import { PayrollImportDialog } from "@/components/admin/PayrollImportDialog";

const PAYROLL_SLUG = PAYROLL_RECORDS_SLUG;
const PAYROLL_PERIODS_SLUG = "new-payroll-periods";

function findFieldId(fields: FormField[], label: string): string | null {
  const target = label.toLowerCase();
  return fields.find((f) => (f.label || "").toLowerCase() === target)?.id ?? null;
}

function fmtDateLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isAnswerField(f: FormField) {
  return (
    f.type !== "headline" &&
    f.type !== "subheadline" &&
    f.type !== "paragraph" &&
    f.type !== "image"
  );
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function isNumericField(f: FormField): boolean {
  return f.type === "number";
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    const o = v as { name?: string };
    return o.name ?? JSON.stringify(v);
  }
  return String(v);
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

import { useDocumentTitle } from "@/hooks/use-document-title";

export default function PayrollsPage() {
  useDocumentTitle("Payrolls");
  const users = useUsers();
  const session = useSession();
  const admin = isAdminSession(session);
  const activeUsers = useMemo(
    () => users.filter((u) => u.status === "active"),
    [users],
  );
  const [staffId, setStaffId] = useState<string>("all");

  const [form, setForm] = useState<HubForm | null>(null);
  const [subs, setSubs] = useState<FormSubmission[]>([]);
  const [periodLabels, setPeriodLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const now = new Date();
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  });

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!admin && session?.userId) {
      setStaffId(session.userId);
    }
  }, [admin, session?.userId]);
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const forms = await fetchForms();
      const f = forms.find((x) => x.slug === PAYROLL_SLUG) ?? null;
      const periodsForm = forms.find((x) => x.slug === PAYROLL_PERIODS_SLUG) ?? null;
      if (!active) return;
      setForm(f);
      const [s, periodSubs] = await Promise.all([
        f ? fetchSubmissions(f.id) : Promise.resolve([] as FormSubmission[]),
        periodsForm ? fetchSubmissions(periodsForm.id) : Promise.resolve([] as FormSubmission[]),
      ]);
      if (!active) return;
      setSubs(s);
      setSelected(new Set());
      const labels: Record<string, string> = {};
      if (periodsForm) {
        const nameFid = findFieldId(periodsForm.fields, "Payroll Period Name");
        const startFid = findFieldId(periodsForm.fields, "Start Date");
        const endFid = findFieldId(periodsForm.fields, "End Date");
        for (const ps of periodSubs) {
          const name = nameFid ? (ps.answers[nameFid] as string | undefined) : undefined;
          if (name) {
            labels[ps.id] = name;
          } else if (startFid && endFid) {
            const start = ps.answers[startFid] as string | undefined;
            const end = ps.answers[endFid] as string | undefined;
            if (start && end) labels[ps.id] = `${fmtDateLabel(start)} – ${fmtDateLabel(end)}`;
          }
        }
      }
      setPeriodLabels(labels);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const periodFieldId = useMemo(
    () => findFieldId(form?.fields ?? [], "Payroll Period"),
    [form],
  );

  const answerFields = useMemo(
    () => (form?.fields ?? []).filter(isAnswerField),
    [form],
  );

  const numericFields = useMemo(
    () => answerFields.filter(isNumericField),
    [answerFields],
  );

  const usersFieldId = useMemo(
    () => (form?.fields ?? []).find((f) => f.type === "users")?.id ?? null,
    [form],
  );

  const selectedStaffName = useMemo(
    () => (staffId === "all" ? null : activeUsers.find((u) => u.id === staffId)?.name ?? null),
    [staffId, activeUsers],
  );

  const filtered = useMemo(() => {
    const from = range?.from ? new Date(range.from).setHours(0, 0, 0, 0) : -Infinity;
    const toDate = range?.to ?? range?.from;
    const to = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : Infinity;
    return subs.filter((s) => {
      const t = new Date(s.createdAt).getTime();
      if (t < from || t > to) return false;
      if (selectedStaffName && usersFieldId) {
        const v = s.answers[usersFieldId];
        const names = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
        if (!names.includes(selectedStaffName)) return false;
      }
      return true;
    });
  }, [subs, range, selectedStaffName, usersFieldId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  useEffect(() => {
    setPage(1);
  }, [range, staffId, pageSize, subs.length]);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  const userByName = useMemo(() => {
    const m = new Map<string, (typeof users)[number]>();
    for (const u of users) m.set(u.name.toLowerCase(), u);
    return m;
  }, [users]);

  function rateFor(label: string, u: (typeof users)[number] | undefined): number {
    if (!u) return 0;
    const l = label.toLowerCase();
    if (l.includes("regular")) return u.regularRate ?? 0;
    if (l.includes("drive")) return u.driveTimeRate ?? 0;
    if (l.includes("fc")) return u.fcRate ?? 0;
    if (l.includes("tr")) return u.trRate ?? 0;
    return 0;
  }

  function rowEarnings(s: FormSubmission): number {
    const techRaw = usersFieldId ? s.answers[usersFieldId] : undefined;
    const techName = Array.isArray(techRaw)
      ? String(techRaw[0] ?? "")
      : techRaw
        ? String(techRaw)
        : "";
    const u = userByName.get(techName.toLowerCase());
    let total = 0;
    for (const f of numericFields) {
      const h = toNumber(s.answers[f.id]);
      if (h !== null) total += h * rateFor(f.label || "", u);
    }
    return total;
  }

  const totals = useMemo(() => {
    const hours: Record<string, number> = {};
    const earningsByField: Record<string, number> = {};
    for (const f of numericFields) {
      hours[f.id] = 0;
      earningsByField[f.id] = 0;
    }
    let earnings = 0;
    for (const s of filtered) {
      const techRaw = usersFieldId ? s.answers[usersFieldId] : undefined;
      const techName = Array.isArray(techRaw)
        ? String(techRaw[0] ?? "")
        : techRaw
          ? String(techRaw)
          : "";
      const u = userByName.get(techName.toLowerCase());
      for (const f of numericFields) {
        const n = toNumber(s.answers[f.id]);
        if (n !== null) {
          hours[f.id] += n;
          const e = n * rateFor(f.label || "", u);
          earningsByField[f.id] += e;
          earnings += e;
        }
      }
    }
    return { hours, earningsByField, earnings };
  }, [filtered, numericFields, userByName, usersFieldId]);

  const selectedUser = useMemo(
    () => activeUsers.find((u) => u.id === staffId),
    [activeUsers, staffId],
  );

  const rangeLabel = range?.from
    ? range.to && range.to.getTime() !== range.from.getTime()
      ? `${format(range.from, "LLL d, y")} – ${format(range.to, "LLL d, y")}`
      : format(range.from, "LLL d, y")
    : "Pick a date range";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Payrolls</h1>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Loading…"
                : admin
                  ? `${filtered.length} submission${filtered.length === 1 ? "" : "s"} for the selected period`
                  : "Your payroll for the selected period"}
            </p>
          </div>
          {admin ? (
            <>
          <Button className="h-9 gap-2" onClick={() => setSubmitOpen(true)}>
            <FilePlus className="h-4 w-4" />
            Submit Record
          </Button>
          <PayrollImportDialog users={activeUsers} onImported={() => setReloadKey((k) => k + 1)} />
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {admin ? (
          <Select value={staffId} onValueChange={setStaffId}>

            <SelectTrigger className="h-9 min-w-[200px]">
              <SelectValue placeholder="All staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {activeUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          ) : (
            <div className="h-9 px-3 inline-flex items-center rounded-md border bg-card text-sm text-muted-foreground">
              {session?.name || "Your records"}
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-9 justify-start text-left font-normal gap-2",
                  !range?.from && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="h-4 w-4" />
                {rangeLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={2}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {!loading && !form && (
        <div className="rounded-2xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          The "New Payroll Records" form was not found.
        </div>
      )}

      {form && (
        <>
          {numericFields.length > 0 && (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {numericFields.map((f) => {
                const rate = selectedUser ? rateFor(f.label || "", selectedUser) : null;
                const hrs = totals.hours[f.id] ?? 0;
                const earned = totals.earningsByField[f.id] ?? 0;
                return (
                  <div
                    key={f.id}
                    className="rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {f.label || "(untitled)"}
                      </p>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-bold mt-2">{fmtMoney(hrs)} <span className="text-sm font-normal text-muted-foreground">hrs</span></p>
                    <div className="mt-2 flex items-baseline justify-between gap-2 border-t pt-2">
                      <span className="text-xs text-muted-foreground">Earnings</span>
                      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        ${fmtMoney(earned)}
                      </span>
                    </div>
                    {rate !== null && (
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {selectedUser?.name.split(" ")[0]}'s rate
                        </span>
                        <span className="text-xs font-medium">${fmtMoney(rate)}/hr</span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                    Total Earnings
                  </p>
                  <DollarSign className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                </div>
                <p className="text-2xl font-bold mt-2 text-emerald-700 dark:text-emerald-400">
                  ${fmtMoney(totals.earnings)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Total for {rangeLabel}
                </p>
              </div>
            </section>
          )}

          <section className="bg-card border rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b">
              <div className="text-sm font-medium text-muted-foreground">
                {selected.size > 0 ? (
                  <span>
                    {selected.size} selected
                  </span>
                ) : (
                  <span>Records</span>
                )}
              </div>
              {admin && selected.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 gap-2"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete {selected.size}
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    {admin ? (
                    <th className="px-4 py-3 w-10">
                      <Checkbox
                        checked={paged.length > 0 && paged.every((s) => selected.has(s.id))}
                        onCheckedChange={(v) => {
                          if (v) setSelected(new Set(paged.map((s) => s.id)));
                          else setSelected(new Set());
                        }}
                        aria-label="Select all"
                      />
                    </th>
                    ) : null}
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Submitted</th>
                    {answerFields.map((f) => (
                      <th
                        key={f.id}
                        className="px-4 py-3 font-medium whitespace-nowrap min-w-[140px]"
                      >
                        {f.label || "(untitled)"}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-medium whitespace-nowrap text-right">
                      Earnings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => (
                    <tr key={s.id} className="border-t align-top">
                      {admin ? (
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selected.has(s.id)}
                          onCheckedChange={(v) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(s.id);
                              else next.delete(s.id);
                              return next;
                            });
                          }}
                          aria-label="Select row"
                        />
                      </td>
                      ) : null}
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      {answerFields.map((f) => {
                        const raw = s.answers[f.id];
                        let display: string;
                        if (f.id === periodFieldId && typeof raw === "string") {
                          display = periodLabels[raw] ?? raw;
                        } else if (isNumericField(f)) {
                          const n = toNumber(raw);
                          display = n !== null ? fmtMoney(n) : "—";
                        } else {
                          display = formatValue(raw);
                        }
                        return (
                          <td
                            key={f.id}
                            className="px-4 py-3 text-muted-foreground"
                          >
                            <div className="max-w-[260px] whitespace-pre-wrap break-words">
                              {display}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right whitespace-nowrap font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                        ${fmtMoney(rowEarnings(s))}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={answerFields.length + (admin ? 3 : 2)}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        No submissions in the selected date range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <div className="flex items-center justify-between gap-4 flex-wrap px-4 py-3 border-t text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>Rows per page</span>
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                    <SelectTrigger className="h-8 w-[80px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 50, 100].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-muted-foreground">
                  {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {admin ? (
      <FormSubmitDialog
        slug={PAYROLL_SLUG}
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onSubmitted={() => setReloadKey((k) => k + 1)}
        title="Submit Payroll Record"
      />
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} record{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                setDeleting(true);
                try {
                  const ids = Array.from(selected);
                  await Promise.all(ids.map((id) => deleteSubmission(id)));
                  toast.success(`Deleted ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
                  setConfirmOpen(false);
                  setSelected(new Set());
                  setReloadKey((k) => k + 1);
                } catch (err) {
                  console.error(err);
                  toast.error("Failed to delete some records.");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
