import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiError } from "@/lib/api";
import {
  addRestock,
  deleteClientRule,
  deleteOverride,
  deleteRestock,
  fetchClientRules,
  fetchPayLog,
  fetchPayWeek,
  FLAG_LABELS,
  markWeekPaid,
  RULE_LABELS,
  saveClientRule,
  saveOverride,
  TYPE_LABELS,
  type ClientRules,
  type PayLogEntry,
  type PayRow,
  type PayWeek,
} from "@/lib/contractor-pay";

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const money = (v: string | null | undefined) =>
  v == null ? "—" : v.startsWith("-") ? `-$${v.slice(1)}` : `$${v}`;

// Upcoming visits aren't completed yet; that's only a problem once the day has passed.
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

function attentionFlags(r: PayRow): string[] {
  return r.flags.filter(
    (f) => f !== "estimate" && (f !== "not_completed" || r.date < todayIso()),
  );
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function ContractorPayPage() {
  useDocumentTitle("Contractor Pay");
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [data, setData] = useState<PayWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [contractorId, setContractorId] = useState("all");
  const [editing, setEditing] = useState<PayRow | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchPayWeek(week));
    } catch (err) {
      toast.error(errorText(err, "Could not load contractor pay"));
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => contractorId === "all" || r.contractor_id === contractorId),
    [data, contractorId],
  );
  const issues = rows.filter((r) => r.type === "pay" && attentionFlags(r).length > 0);
  const editable = Boolean(data?.can_edit && !data.paid);

  const payWeek = async () => {
    if (!data) return;
    if (
      !confirm(
        `Mark ${fmtDate(data.week_start)} – ${fmtDate(data.week_end)} as paid ($${data.summary.total_paid})? ` +
          "The week is then frozen. Later increases are paid as adjustments.",
      )
    )
      return;
    setPaying(true);
    try {
      await markWeekPaid(data.week_start);
      toast.success("Week marked paid");
      load();
    } catch (err) {
      toast.error(errorText(err, "Could not mark the week paid"));
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Contractor Pay</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{data?.rules}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            disabled={!data}
            onClick={() => data && setWeek(shiftDays(data.week_start, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium min-w-[13rem] text-center">
            {data ? `${fmtDate(data.week_start)} – ${fmtDate(data.week_end)}` : "…"}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            disabled={!data}
            onClick={() => data && setWeek(shiftDays(data.week_start, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Select value={contractorId} onValueChange={setContractorId}>
            <SelectTrigger className="h-9 min-w-[180px]">
              <SelectValue placeholder="All contractors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contractors</SelectItem>
              {(data?.contractors ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {data && (
        <div className="flex items-center gap-3 flex-wrap rounded-lg border bg-card p-4">
          {data.paid ? (
            <Badge className="bg-emerald-600">Paid</Badge>
          ) : (
            <Badge variant="outline">Open</Badge>
          )}
          <span className="text-sm">
            Total <strong>${data.summary.total_paid}</strong> · pay day {fmtDate(data.pay_day)}
            {data.paid && data.paid_by ? ` · marked paid by ${data.paid_by}` : ""}
          </span>
          {!data.can_edit && (
            <span className="text-xs text-muted-foreground">
              View only: you aren't allowed to change contractor pay.
            </span>
          )}
          {editable && data.week_over && (
            <Button className="ml-auto" disabled={paying} onClick={payWeek}>
              Mark week paid
            </Button>
          )}
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data ? (
        <>
          <section className="space-y-2">
            <h2 className="font-semibold">Totals</h2>
            <div className="rounded-lg border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contractor</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead className="text-right">Pay</TableHead>
                    <TableHead className="text-right">Tips</TableHead>
                    <TableHead className="text-right">Adjustments</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.summary.by_contractor
                    .filter((c) => contractorId === "all" || c.contractor_id === contractorId)
                    .map((c) => (
                      <TableRow key={c.contractor_id}>
                        <TableCell>{c.contractor_name}</TableCell>
                        <TableCell className="text-right">{c.visits}</TableCell>
                        <TableCell className="text-right">{money(c.pay)}</TableCell>
                        <TableCell className="text-right">{money(c.tips)}</TableCell>
                        <TableCell className="text-right">{money(c.adjustments)}</TableCell>
                        <TableCell className="text-right">{money(c.deductions)}</TableCell>
                        <TableCell className="text-right font-semibold">{money(c.total)}</TableCell>
                      </TableRow>
                    ))}
                  {data.summary.by_contractor.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                        No contractor visits this week.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          {issues.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Needs attention ({issues.length})</h2>
              <ul className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1 text-sm">
                {issues.map((r) => (
                  <li key={r.id}>
                    {fmtDate(r.date)} · {r.client_name} · {r.contractor_name}:{" "}
                    {attentionFlags(r).map((f) => FLAG_LABELS[f] ?? f).join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold">Lines</h2>
            <div className="rounded-lg border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Contractor</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead className="text-right">Calculated</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={r.status === "void" ? "opacity-50" : undefined}>
                      <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                      <TableCell>{r.contractor_name}</TableCell>
                      <TableCell>
                        <div>
                          {TYPE_LABELS[r.type]}
                          {r.client_name ? ` · ${r.client_name}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[r.job_title, r.note, r.reason && `Reason: ${r.reason}`, r.changed_by && `by ${r.changed_by}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {r.flags.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-1">
                            {r.flags.map((f) => (
                              <Badge key={f} variant="outline" className="text-[10px]">
                                {FLAG_LABELS[f] ?? f}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{r.pay_rule ? RULE_LABELS[r.pay_rule] : ""}</TableCell>
                      <TableCell className="text-right">{money(r.calculated_amount)}</TableCell>
                      <TableCell className="text-right font-medium">{money(r.amount_paid)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {editable && r.type === "pay" && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                            Change
                          </Button>
                        )}
                        {editable && r.type === "restock_deduction" && r.deduction_id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Remove restock"
                            onClick={async () => {
                              if (!confirm("Remove this restock deduction?")) return;
                              try {
                                await deleteRestock(r.deduction_id!);
                                load();
                              } catch (err) {
                                toast.error(errorText(err, "Could not remove it"));
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                        Nothing this week.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          {editable && <RestockForm data={data} onSaved={load} />}
        </>
      ) : null}

      <ClientRulesSection canEdit={Boolean(data?.can_edit)} onChanged={load} />
      <ChangeLog />

      <OverrideDialog row={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}

function OverrideDialog({
  row,
  onClose,
  onSaved,
}: {
  row: PayRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    setAmount(row.override_id ? row.amount_paid : "");
    setReason(row.override_id ? row.reason ?? "" : "");
  }, [row]);

  if (!row) return null;

  const save = async () => {
    setSaving(true);
    try {
      await saveOverride({
        visit_id: row.visit_id!,
        contractor_id: row.contractor_id,
        amount,
        reason,
      });
      toast.success("Pay changed");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(errorText(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await deleteOverride(row.override_id!);
      toast.success("Back to the calculated amount");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(errorText(err, "Could not remove"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change pay</DialogTitle>
          <DialogDescription>
            {row.contractor_name} · {row.client_name} · {fmtDate(row.date)}. Calculated:{" "}
            {money(row.calculated_amount)} (price {money(row.visit_amount)}, discount{" "}
            {money(row.discount_share)}).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="override-amount">Pay for this visit</Label>
            <Input
              id="override-amount"
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="override-reason">Reason</Label>
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. agreed different pay"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {row.override_id && (
            <Button variant="outline" className="mr-auto" disabled={saving} onClick={remove}>
              Use calculated amount
            </Button>
          )}
          <Button disabled={saving || !amount || !reason.trim()} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestockForm({ data, onSaved }: { data: PayWeek; onSaved: () => void }) {
  const [contractorId, setContractorId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(data.week_end);
  const [note, setNote] = useState("");

  useEffect(() => setDate(data.week_end), [data.week_end]);

  const save = async () => {
    try {
      await addRestock({ contractor_id: contractorId, amount, date, note });
      toast.success("Restock deduction added");
      setAmount("");
      setNote("");
      onSaved();
    } catch (err) {
      toast.error(errorText(err, "Could not add it"));
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Add a restock deduction</h2>
      <div className="rounded-lg border bg-card p-4 grid gap-3 sm:grid-cols-[1fr_8rem_10rem_2fr_auto] items-end">
        <div className="space-y-1">
          <Label>Contractor</Label>
          <Select value={contractorId} onValueChange={setContractorId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {data.contractors
                .filter((c) => c.status === "active")
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="restock-amount">Amount</Label>
          <Input
            id="restock-amount"
            type="number"
            step="0.01"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="restock-date">Date</Label>
          <Input
            id="restock-date"
            type="date"
            min={data.week_start}
            max={data.week_end}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="restock-note">What was restocked</Label>
          <Input id="restock-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button disabled={!contractorId || !amount || !note.trim()} onClick={save}>
          Add
        </Button>
      </div>
    </section>
  );
}

function ClientRulesSection({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [data, setData] = useState<ClientRules | null>(null);
  const [clientId, setClientId] = useState("");
  const [rule, setRule] = useState<"percent" | "fixed">("fixed");
  const [fixed, setFixed] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await fetchClientRules());
    } catch (err) {
      toast.error(errorText(err, "Could not load client pay rules"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    try {
      await saveClientRule({
        client_jobber_id: clientId,
        rule,
        fixed_amount: rule === "fixed" ? fixed : undefined,
        note,
      });
      toast.success("Client pay rule saved");
      setClientId("");
      setFixed("");
      setNote("");
      load();
      onChanged();
    } catch (err) {
      toast.error(errorText(err, "Could not save"));
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Client pay rules</h2>
      <p className="text-sm text-muted-foreground">
        Clients without a rule pay the contractor's %. A fixed amount is per visit, split between
        everyone on the visit.
      </p>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Changed by</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.rules ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.client_name || r.client_jobber_id}</TableCell>
                <TableCell>{r.rule === "fixed" ? `Fixed ${money(r.fixed_amount)} per visit` : "Contractor %"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.note}</TableCell>
                <TableCell className="text-sm">{r.changed_by ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove rule"
                      onClick={async () => {
                        if (!confirm(`Remove the rule for ${r.client_name}?`)) return;
                        try {
                          await deleteClientRule(r.id);
                          load();
                          onChanged();
                        } catch (err) {
                          toast.error(errorText(err, "Could not remove"));
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {data && data.rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No client rules: every client uses the contractor's %.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {canEdit && data && (
        <div className="rounded-lg border bg-card p-4 grid gap-3 sm:grid-cols-[2fr_10rem_8rem_2fr_auto] items-end">
          <div className="space-y-1">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {data.clients.map((c) => (
                  <SelectItem key={c.client_jobber_id} value={c.client_jobber_id}>
                    {c.client_name || c.client_jobber_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Rule</Label>
            <Select value={rule} onValueChange={(v) => setRule(v as "percent" | "fixed")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed per visit</SelectItem>
                <SelectItem value="percent">Contractor %</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-fixed">Amount</Label>
            <Input
              id="rule-fixed"
              type="number"
              step="0.01"
              min={0}
              disabled={rule !== "fixed"}
              value={fixed}
              onChange={(e) => setFixed(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-note">Note</Label>
            <Input id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button disabled={!clientId || (rule === "fixed" && !fixed)} onClick={save}>
            Save
          </Button>
        </div>
      )}
    </section>
  );
}

function ChangeLog() {
  const [entries, setEntries] = useState<PayLogEntry[] | null>(null);

  const show = async () => {
    try {
      setEntries(await fetchPayLog());
    } catch (err) {
      toast.error(errorText(err, "Could not load the change log"));
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Change log</h2>
        {entries === null && (
          <Button size="sm" variant="outline" onClick={show}>
            Show
          </Button>
        )}
      </div>
      {entries && (
        <ul className="rounded-lg border bg-card p-3 space-y-1 text-sm max-h-80 overflow-y-auto">
          {entries.length === 0 && <li className="text-muted-foreground">No changes yet.</li>}
          {entries.map((e, i) => (
            <li key={i}>
              <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span> ·{" "}
              {e.by ?? "System"} · {e.action} ·{" "}
              <span className="text-muted-foreground">
                {Object.entries(e.detail)
                  .map(([k, v]) => `${k}: ${v ?? "—"}`)
                  .join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
