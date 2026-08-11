import { useMemo, useRef, useState } from "react";
import { Upload, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
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
  fetchForms,
  fetchSubmissions,
  normalizeUserNames,
  PAYROLL_RECORDS_SLUG,
  submitFormAnswers,
  updateSubmission,
  type FormField,
  type HubForm,
} from "@/lib/forms-store";
import type { HubUser } from "@/lib/hub-store";

interface Props {
  users: HubUser[];
  onImported?: () => void;
}

interface Row {
  name: string;
  date: Date;
  hours: number;
  workingOn: string;
  note: string;
}

interface StaffTotals {
  csvName: string;
  matchedUser?: HubUser;
  regular: number;
  drive: number;
  fc: number;
  tr: number;
}

const PAYROLL_PERIODS_SLUG = "new-payroll-periods";

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Parse a single CSV line respecting quotes
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function parseDate(s: string): Date | null {
  // "Jun 30, 2026"
  const d = new Date(s.replace(/^"|"$/g, ""));
  return isNaN(d.getTime()) ? null : d;
}

function categorize(row: Row): "drive" | "fc" | "tr" | "regular" {
  const note = row.note.toLowerCase().trim();
  if (note.includes("drive time")) return "drive";
  if (note.includes("first clean")) return "fc";
  if (/\btr\b/.test(note)) return "tr";
  return "regular";
}

function findFieldId(fields: FormField[], label: string): string | null {
  const target = label.toLowerCase();
  return fields.find((f) => (f.label || "").toLowerCase() === target)?.id ?? null;
}

function fmtDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function PayrollImportDialog({ users, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<StaffTotals[]>([]);
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);

  const userIndex = useMemo(() => {
    const m = new Map<string, HubUser>();
    for (const u of users) m.set(normalizeName(u.name), u);
    return m;
  }, [users]);

  function matchUser(csvName: string): HubUser | undefined {
    const key = normalizeName(csvName);
    if (userIndex.has(key)) return userIndex.get(key);
    // try loose contains
    for (const [k, u] of userIndex) {
      if (k.includes(key) || key.includes(k)) return u;
    }
    return undefined;
  }

  async function handleFile(file: File) {
    setParsing(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      // find header row for details
      const headerIdx = lines.findIndex((l) => {
        const cells = parseCsvLine(l).map((c) => c.toLowerCase());
        return cells[0] === "name" && cells.includes("date") && cells.includes("hours");
      });
      if (headerIdx < 0) throw new Error("Could not find a Name/Date/Hours header row in this CSV.");

      const parsed: Row[] = [];
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const raw = lines[i];
        if (!raw || !raw.trim()) continue;
        const c = parseCsvLine(raw);
        if (c.length < 5) continue;
        const name = c[0];
        const date = parseDate(c[1]);
        const hours = parseFloat(c[4]);
        if (!name || !date || !Number.isFinite(hours)) continue;
        parsed.push({
          name,
          date,
          hours,
          workingOn: c[5] ?? "",
          note: (c[6] ?? "").replace(/^"|"$/g, ""),
        });
      }
      if (parsed.length === 0) throw new Error("No timesheet rows found in this CSV.");

      // group by csv name
      const byName = new Map<string, StaffTotals>();
      let min = parsed[0].date;
      let max = parsed[0].date;
      for (const r of parsed) {
        if (r.date < min) min = r.date;
        if (r.date > max) max = r.date;
        const key = r.name;
        if (!byName.has(key)) {
          byName.set(key, {
            csvName: r.name,
            matchedUser: matchUser(r.name),
            regular: 0,
            drive: 0,
            fc: 0,
            tr: 0,
          });
        }
        const st = byName.get(key)!;
        const cat = categorize(r);
        st[cat] += r.hours;
      }
      const list = Array.from(byName.values())
        .filter((s) => s.regular + s.drive + s.fc + s.tr > 0.0001)
        .sort((a, b) => a.csvName.localeCompare(b.csvName));

      setRows(parsed);
      setTotals(list);
      setDateRange({ start: min, end: max });
      setOpen(true);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to parse CSV");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleImport() {
    if (!dateRange) return;
    const matched = totals.filter((t) => t.matchedUser);
    if (matched.length === 0) {
      toast.error("No CSV names matched an existing staff member.");
      return;
    }
    setSubmitting(true);
    try {
      const forms = await fetchForms();
      const recordsForm = forms.find((f) => f.slug === PAYROLL_RECORDS_SLUG);
      const periodsForm = forms.find((f) => f.slug === PAYROLL_PERIODS_SLUG);
      if (!recordsForm) throw new Error(`Form "${PAYROLL_RECORDS_SLUG}" not found`);
      if (!periodsForm) throw new Error(`Form "${PAYROLL_PERIODS_SLUG}" not found`);

      // Resolve field ids on periods form
      const pf = periodsForm.fields;
      const nameFid = findFieldId(pf, "Payroll Period Name");
      const startFid = findFieldId(pf, "Start Date");
      const endFid = findFieldId(pf, "End Date");
      const statusFid = findFieldId(pf, "Status");

      const periodName = `${fmtDateLabel(dateRange.start)} – ${fmtDateLabel(dateRange.end)}`;

      // find existing period submission by name
      const existing = await fetchSubmissions(periodsForm.id);
      let periodSubmissionId = existing.find(
        (s) => nameFid && String(s.answers[nameFid] ?? "") === periodName,
      )?.id;

      if (!periodSubmissionId) {
        const answers: Record<string, unknown> = {};
        if (nameFid) answers[nameFid] = periodName;
        if (startFid) answers[startFid] = fmtDateISO(dateRange.start);
        if (endFid) answers[endFid] = fmtDateISO(dateRange.end);
        if (statusFid) answers[statusFid] = "Open";
        const created = await submitFormAnswers(periodsForm.id, answers);
        periodSubmissionId = created.id;
      }

      // Records form field ids
      const rf = recordsForm.fields;
      const fPeriod = findFieldId(rf, "Payroll Period");
      const fTech = findFieldId(rf, "Technician");
      const fReg = findFieldId(rf, "Regular Hours");
      const fDrive = findFieldId(rf, "Drive Time Hours");
      const fFc = findFieldId(rf, "FC Hours");
      const fTr = findFieldId(rf, "TR Hours");

      // Load existing records for this period so we can update instead of duplicate
      const existingRecords = await fetchSubmissions(recordsForm.id);
      const existingByTech = new Map<string, string>(); // technician name -> submission id
      for (const rec of existingRecords) {
        if (!fPeriod || rec.answers[fPeriod] !== periodSubmissionId) continue;
        const names = fTech ? normalizeUserNames(rec.answers[fTech]) : [];
        for (const tech of names) {
          existingByTech.set(tech.toLowerCase(), rec.id);
        }
      }

      let created = 0;
      let updated = 0;
      for (const t of matched) {
        const answers: Record<string, unknown> = {};
        if (fPeriod) answers[fPeriod] = periodSubmissionId;
        // Always store as single-element array (Users field shape)
        if (fTech) answers[fTech] = [t.matchedUser!.name];
        if (fReg) answers[fReg] = round2(t.regular);
        if (fDrive) answers[fDrive] = round2(t.drive);
        if (fFc) answers[fFc] = round2(t.fc);
        if (fTr) answers[fTr] = round2(t.tr);

        const existingId = existingByTech.get(t.matchedUser!.name.toLowerCase());
        if (existingId) {
          await updateSubmission(existingId, answers);
          updated++;
        } else {
          await submitFormAnswers(recordsForm.id, answers);
          created++;
        }
      }

      const parts: string[] = [];
      if (created) parts.push(`${created} added`);
      if (updated) parts.push(`${updated} updated`);
      toast.success(`Imported for "${periodName}": ${parts.join(", ") || "no changes"}.`);
      setOpen(false);
      setRows([]);
      setTotals([]);
      setDateRange(null);
      onImported?.();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to import");
    } finally {
      setSubmitting(false);
    }
  }

  const matchedCount = totals.filter((t) => t.matchedUser).length;
  const unmatched = totals.filter((t) => !t.matchedUser);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        variant="outline"
        className="h-9 gap-2"
        onClick={() => fileRef.current?.click()}
        disabled={parsing}
      >
        {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Import CSV
      </Button>

      <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Timesheet CSV</DialogTitle>
            <DialogDescription>
              {dateRange ? (
                <>
                  Payroll period{" "}
                  <span className="font-medium text-foreground">
                    {fmtDateLabel(dateRange.start)} – {fmtDateLabel(dateRange.end)}
                  </span>
                  {" · "}
                  {matchedCount} matched staff
                  {unmatched.length > 0 && `, ${unmatched.length} unmatched`}
                </>
              ) : (
                "Preview and confirm import"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            {unmatched.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 p-3 text-xs flex gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">These CSV names don't match any staff and will be skipped:</div>
                  <div className="mt-1">{unmatched.map((u) => u.csvName).join(", ")}</div>
                </div>
              </div>
            )}

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Staff</th>
                    <th className="px-3 py-2 font-medium text-right">Regular</th>
                    <th className="px-3 py-2 font-medium text-right">Drive</th>
                    <th className="px-3 py-2 font-medium text-right">FC</th>
                    <th className="px-3 py-2 font-medium text-right">TR</th>
                    <th className="px-3 py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => {
                    const total = t.regular + t.drive + t.fc + t.tr;
                    return (
                      <tr key={t.csvName} className="border-t">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {t.matchedUser ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                            )}
                            <div>
                              <div className="font-medium">{t.matchedUser?.name ?? t.csvName}</div>
                              {t.matchedUser && t.matchedUser.name !== t.csvName && (
                                <div className="text-[11px] text-muted-foreground">CSV: {t.csvName}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{round2(t.regular).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{round2(t.drive).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{round2(t.fc).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{round2(t.tr).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{round2(total).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {rows.length} timesheet rows · Drive = "General" or "Drive time" notes ·
              FC = notes containing "First clean" · TR = notes containing "TR" · Regular = everything else.
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={submitting || matchedCount === 0}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Import {matchedCount} record{matchedCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
