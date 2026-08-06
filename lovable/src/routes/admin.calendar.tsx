import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X as XIcon,
  Trash2,
  CalendarDays,
  FilePlus,
} from "lucide-react";
import { toast } from "sonner";
import { FormSubmitDialog } from "@/components/FormSubmitDialog";
import {
  useForms,
  fetchSubmissions,
  deleteSubmission,
  type FormSubmission,
  type HubForm,
  type FormField,
} from "@/lib/forms-store";

export const Route = createFileRoute("/admin/calendar")({
  component: CalendarPage,
});

type ApprovalStatus = "pending" | "approved" | "rejected";

interface ApprovalRow {
  submission_id: string;
  status: ApprovalStatus;
  decided_at: string | null;
}

interface LeaveRequest {
  submission: FormSubmission;
  status: ApprovalStatus;
  staff: string[];
  leaveType: string;
  startDate: string; // yyyy-mm-dd
  endDate: string;
  reason: string;
}

const LEAVE_FORM_SLUG = "request-time-off";
const ABSENCE_FORM_SLUG = "new-absence";

// ---- date helpers (work in local time using yyyy-mm-dd strings) ----
function parseYMD(s: string): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fmtYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fmtNice(s: string): string {
  const d = parseYMD(s);
  if (!d) return s;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function eachDay(start: string, end: string): string[] {
  const a = parseYMD(start);
  const b = parseYMD(end) ?? a;
  if (!a) return [];
  const out: string[] = [];
  const cur = new Date(a);
  const last = b!;
  // safety cap
  let i = 0;
  while (cur <= last && i < 366) {
    out.push(fmtYMD(cur));
    cur.setDate(cur.getDate() + 1);
    i++;
  }
  return out;
}

// pick a stable color per name
const PALETTE = [
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-violet-100 text-violet-800 border-violet-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
  "bg-lime-100 text-lime-800 border-lime-200",
];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function detectFields(form: HubForm) {
  const byLabel = (re: RegExp, type?: string) =>
    form.fields.find(
      (f) => (!type || f.type === type) && re.test(f.label || ""),
    );
  const startField =
    byLabel(/start/i, "date") ||
    form.fields.find((f) => f.type === "date");
  const endField =
    byLabel(/end/i, "date") ||
    form.fields.filter((f) => f.type === "date")[1];
  const userField =
    form.fields.find((f) => f.type === "users") ||
    byLabel(/name|staff|user/i);
  const typeField =
    byLabel(/leave\s*type|type/i, "dropdown") ||
    form.fields.find((f) => f.type === "dropdown");
  const reasonField = byLabel(/reason|note/i);
  return {
    startField: startField as FormField | undefined,
    endField: endField as FormField | undefined,
    userField: userField as FormField | undefined,
    typeField: typeField as FormField | undefined,
    reasonField: reasonField as FormField | undefined,
  };
}

function valueAsString(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}
function valueAsArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

function CalendarPage() {
  const forms = useForms();
  const leaveForm = useMemo(
    () => forms.find((f) => f.slug === LEAVE_FORM_SLUG),
    [forms],
  );

  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [approvals, setApprovals] = useState<Record<string, ApprovalRow>>({});
  const [loading, setLoading] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  // filters for the sidebar list
  const [filterStatus, setFilterStatus] = useState<ApprovalStatus | "all">("pending");
  const [filterStaff, setFilterStaff] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  const [confirmDelete, setConfirmDelete] = useState<LeaveRequest | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const fields = useMemo(
    () => (leaveForm ? detectFields(leaveForm) : null),
    [leaveForm],
  );

  // load submissions & approvals
  useEffect(() => {
    if (!leaveForm) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      const subs = await fetchSubmissions(leaveForm.id);
      const ids = subs.map((s) => s.id);
      let appMap: Record<string, ApprovalRow> = {};
      if (ids.length) {
        const { data } = await supabase
          .from("hub_leave_approvals")
          .select("submission_id,status,decided_at")
          .in("submission_id", ids);
        appMap = Object.fromEntries(
          ((data ?? []) as ApprovalRow[]).map((r) => [r.submission_id, r]),
        );
      }
      if (!active) return;
      setSubmissions(subs);
      setApprovals(appMap);
      setLoading(false);
    };
    load();

    const ch = supabase
      .channel(`calendar-${leaveForm.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hub_form_submissions", filter: `form_id=eq.${leaveForm.id}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hub_leave_approvals" },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [leaveForm]);

  const requests = useMemo<LeaveRequest[]>(() => {
    if (!leaveForm || !fields) return [];
    return submissions.map((s) => {
      const status: ApprovalStatus =
        approvals[s.id]?.status ?? "pending";
      const staff = fields.userField
        ? valueAsArray(s.answers[fields.userField.id])
        : [];
      return {
        submission: s,
        status,
        staff,
        leaveType: fields.typeField
          ? valueAsString(s.answers[fields.typeField.id])
          : "",
        startDate: fields.startField
          ? valueAsString(s.answers[fields.startField.id])
          : "",
        endDate: fields.endField
          ? valueAsString(s.answers[fields.endField.id])
          : fields.startField
            ? valueAsString(s.answers[fields.startField.id])
            : "",
        reason: fields.reasonField
          ? valueAsString(s.answers[fields.reasonField.id])
          : "",
      };
    });
  }, [submissions, approvals, fields, leaveForm]);

  const allStaff = useMemo(() => {
    const set = new Set<string>();
    requests.forEach((r) => r.staff.forEach((n) => n && set.add(n)));
    return Array.from(set).sort();
  }, [requests]);

  const allTypes = useMemo(() => {
    const set = new Set<string>();
    requests.forEach((r) => r.leaveType && set.add(r.leaveType));
    return Array.from(set).sort();
  }, [requests]);

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterStaff !== "all" && !r.staff.includes(filterStaff)) return false;
      if (filterType !== "all" && r.leaveType !== filterType) return false;
      if (filterFrom) {
        const end = parseYMD(r.endDate);
        const from = parseYMD(filterFrom);
        if (end && from && end < from) return false;
      }
      if (filterTo) {
        const start = parseYMD(r.startDate);
        const to = parseYMD(filterTo);
        if (start && to && start > to) return false;
      }
      return true;
    });
  }, [requests, filterStatus, filterStaff, filterType, filterFrom, filterTo]);

  // approved leaves indexed by day for calendar
  const leavesByDay = useMemo(() => {
    const map = new Map<string, Array<{ name: string; req: LeaveRequest }>>();
    requests
      .filter((r) => r.status === "approved" && r.startDate)
      .forEach((r) => {
        const days = eachDay(r.startDate, r.endDate || r.startDate);
        days.forEach((d) => {
          const arr = map.get(d) ?? [];
          (r.staff.length ? r.staff : ["—"]).forEach((name) =>
            arr.push({ name, req: r }),
          );
          map.set(d, arr);
        });
      });
    return map;
  }, [requests]);

  // ---- approval actions ----
  async function setStatus(id: string, status: ApprovalStatus) {
    const { error } = await supabase
      .from("hub_leave_approvals")
      .upsert(
        { submission_id: id, status, decided_at: new Date().toISOString() },
        { onConflict: "submission_id" },
      );
    if (error) {
      toast.error("Could not update status");
      return;
    }
    setApprovals((p) => ({
      ...p,
      [id]: { submission_id: id, status, decided_at: new Date().toISOString() },
    }));
    toast.success(`Request ${status}`);
  }

  async function handleDelete(req: LeaveRequest) {
    try {
      await deleteSubmission(req.submission.id);
      setSubmissions((s) => s.filter((x) => x.id !== req.submission.id));
      setApprovals((a) => {
        const next = { ...a };
        delete next[req.submission.id];
        return next;
      });
      toast.success("Leave entry deleted");
    } catch {
      toast.error("Could not delete");
    } finally {
      setConfirmDelete(null);
    }
  }

  // ---- calendar grid ----
  const monthMatrix = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const startDow = first.getDay(); // Sun=0
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startDow);
    const weeks: Date[][] = [];
    const cur = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d++) {
        row.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(row);
    }
    return weeks;
  }, [viewMonth]);

  if (!forms.length) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!leaveForm) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Calendar</h1>
        <p className="text-muted-foreground">
          The calendar pulls from the form with slug{" "}
          <code className="px-1.5 py-0.5 bg-muted rounded">{LEAVE_FORM_SLUG}</code>.
          Create or rename a form with that slug to start tracking time off.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-[calc(100vh-180px)]">
      {/* Calendar */}
      <div className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-emerald-600" />
            <h1 className="text-lg font-semibold">
              {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </h1>
            <Button className="h-8 gap-2 ml-2" onClick={() => setSubmitOpen(true)}>
              <FilePlus className="h-4 w-4" />
              Submit Record
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const n = new Date();
                setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1));
              }}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground border-b">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-2 text-center">
              {d}
            </div>
          ))}
        </div>

        <div className="flex-1 grid grid-cols-7 grid-rows-6 min-h-0 overflow-auto">
          {monthMatrix.flat().map((d, i) => {
            const inMonth = d.getMonth() === viewMonth.getMonth();
            const key = fmtYMD(d);
            const items = leavesByDay.get(key) ?? [];
            const isToday = key === fmtYMD(new Date());
            return (
              <div
                key={i}
                className={`border-b border-r p-1 min-h-[96px] flex flex-col gap-1 ${
                  inMonth ? "bg-background" : "bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-medium ${
                      isToday
                        ? "bg-emerald-600 text-white rounded-full h-5 w-5 flex items-center justify-center"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {items.slice(0, 4).map((it, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setConfirmDelete(it.req)}
                      className={`text-[11px] leading-tight px-1.5 py-0.5 rounded border text-left truncate hover:opacity-80 ${colorFor(it.name)}`}
                      title={`${it.name}${it.req.leaveType ? ` · ${it.req.leaveType}` : ""}`}
                    >
                      {it.name}
                      {it.req.leaveType ? (
                        <span className="opacity-70"> · {it.req.leaveType}</span>
                      ) : null}
                    </button>
                  ))}
                  {items.length > 4 && (
                    <span className="text-[10px] text-muted-foreground px-1">
                      +{items.length - 4} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sidebar */}
      <div className="bg-card border rounded-xl flex flex-col min-h-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold">Leave Requests</h2>
          <p className="text-xs text-muted-foreground">
            Approve to add to calendar
          </p>
        </div>

        <div className="px-4 py-3 border-b space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">Status</Label>
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as ApprovalStatus | "all")}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Leave type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {allTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Staff</Label>
            <Select value={filterStaff} onValueChange={setFilterStaff}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                {allStaff.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">From</Label>
              <Input type="date" className="h-8" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">To</Label>
              <Input type="date" className="h-8" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
          </div>
          {(filterStatus !== "pending" || filterStaff !== "all" || filterType !== "all" || filterFrom || filterTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setFilterStatus("pending");
                setFilterStaff("all");
                setFilterType("all");
                setFilterFrom("");
                setFilterTo("");
              }}
            >
              Reset filters
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-auto divide-y">
          {loading && (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          )}
          {!loading && filteredRequests.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No requests match these filters.
            </div>
          )}
          {filteredRequests.map((r) => (
            <div key={r.submission.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">
                    {r.staff.length ? r.staff.join(", ") : "Unknown"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtNice(r.startDate)}
                    {r.endDate && r.endDate !== r.startDate
                      ? ` → ${fmtNice(r.endDate)}`
                      : ""}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.leaveType && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Type: </span>
                  <span className="font-medium">{r.leaveType}</span>
                </div>
              )}
              {r.reason && (
                <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                  {r.reason}
                </div>
              )}
              <div className="text-[11px] text-muted-foreground">
                Submitted {new Date(r.submission.createdAt).toLocaleString()}
              </div>
              <div className="flex gap-1.5 pt-1">
                {r.status !== "approved" && (
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setStatus(r.submission.id, "approved")}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                )}
                {r.status !== "rejected" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setStatus(r.submission.id, "rejected")}
                  >
                    <XIcon className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(r)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FormSubmitDialog
        slug={ABSENCE_FORM_SLUG}
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title="New Absence"
      />

      {/* Delete confirm / detail dialog */}

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave entry</DialogTitle>
          </DialogHeader>
          {confirmDelete && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Staff: </span>
                <span className="font-medium">
                  {confirmDelete.staff.join(", ") || "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Dates: </span>
                <span className="font-medium">
                  {fmtNice(confirmDelete.startDate)}
                  {confirmDelete.endDate && confirmDelete.endDate !== confirmDelete.startDate
                    ? ` → ${fmtNice(confirmDelete.endDate)}`
                    : ""}
                </span>
              </div>
              {confirmDelete.leaveType && (
                <div>
                  <span className="text-muted-foreground">Type: </span>
                  <span className="font-medium">{confirmDelete.leaveType}</span>
                </div>
              )}
              {confirmDelete.reason && (
                <div className="text-muted-foreground whitespace-pre-wrap">
                  {confirmDelete.reason}
                </div>
              )}
              <div className="pt-2">
                <StatusBadge status={confirmDelete.status} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, string> = {
    pending: "bg-amber-100 text-amber-800 border-amber-200",
    approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
    rejected: "bg-rose-100 text-rose-800 border-rose-200",
  };
  return (
    <Badge variant="outline" className={`${map[status]} capitalize`}>
      {status}
    </Badge>
  );
}
