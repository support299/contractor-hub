import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Trash2,
  Star,
  X,
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
  ArrowUpDown,
  Save,
  Pencil,
} from "lucide-react";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  deleteSubmission,
  fetchOpenPayrolls,
  fetchSubmissions,
  FIELD_TYPE_LABELS,
  getFileSignedUrl,
  isPayrollRecordsSlug,
  isStaticField,
  newField,
  normalizeUserNames,
  singleUserName,
  updateForm,
  updateSubmission,
  uploadFormFile,
  useForms,
  type FieldType,
  type FormField,
  type FormSubmission,
  type HubForm,
  type PayrollOption,
  type UploadedFile,
} from "@/lib/forms-store";
import { fetchUsers, useSession, type HubUser } from "@/lib/hub-store";
import { UsersMultiSelect, UsersSingleSelect } from "@/components/UserFieldSelect";
import { isAdminSession } from "@/lib/api";
import { fetchLeaveApprovals, retryJobberSync, updateLeaveApproval, type ApprovalStatus, type LeaveApproval } from "@/lib/leave-store";

const LEAVE_FORM_SLUG = "request-time-off";

const COLUMN_FIELD_TYPES: FieldType[] = [
  "single_line",
  "multi_line",
  "number",
  "dropdown",
  "multi_dropdown",
  "radio",
  "star_rating",
  "date",
  "date_time",
  "users",
  "file_upload",
];

const CREATED_AT_ID = "__created_at__";

type Operator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "is_empty"
  | "is_not_empty";

const OPERATOR_LABELS: Record<Operator, string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  not_contains: "does not contain",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

function operatorsForType(type: FieldType | "created_at"): Operator[] {
  if (type === "number" || type === "star_rating")
    return ["equals", "not_equals", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty"];
  if (type === "date" || type === "date_time" || type === "created_at")
    return ["equals", "not_equals", "gt", "lt", "is_empty", "is_not_empty"];
  if (type === "dropdown" || type === "radio")
    return ["equals", "not_equals", "is_empty", "is_not_empty"];
  if (type === "multi_dropdown" || type === "users")
    return ["contains", "not_contains", "is_empty", "is_not_empty"];
  if (type === "file_upload") return ["is_empty", "is_not_empty"];
  return ["contains", "not_contains", "equals", "not_equals", "is_empty", "is_not_empty"];
}

interface Filter {
  id: string;
  fieldId: string;
  operator: Operator;
  value: string;
}

interface Sort {
  fieldId: string;
  dir: "asc" | "desc";
}

interface SmartList {
  id: string;
  name: string;
  combinator: "and" | "or";
  filters: Filter[];
  sorts: Sort[];
}

interface ViewState {
  columnOrder: string[];
  smartLists: SmartList[];
  activeListId: string | null;
  draftCombinator: "and" | "or";
  draftFilters: Filter[];
  draftSorts: Sort[];
}

const DEFAULT_VIEW: ViewState = {
  columnOrder: [],
  smartLists: [],
  activeListId: null,
  draftCombinator: "and",
  draftFilters: [],
  draftSorts: [],
};

function loadView(formId: string): ViewState {
  if (typeof window === "undefined") return { ...DEFAULT_VIEW };
  try {
    const raw = localStorage.getItem(`cotg-data-view-${formId}`);
    if (!raw) return { ...DEFAULT_VIEW };
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    return { ...DEFAULT_VIEW, ...parsed };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

function saveView(formId: string, v: ViewState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`cotg-data-view-${formId}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

function isFileAnswer(v: unknown): v is UploadedFile {
  return (
    !!v &&
    typeof v === "object" &&
    "path" in (v as Record<string, unknown>) &&
    "name" in (v as Record<string, unknown>)
  );
}

const TAB_ORDER_KEY = "cotg-data-tab-order";

function loadTabOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TAB_ORDER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTabOrder(order: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

export default function DataPage() {
  const forms = useForms();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>(loadTabOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && forms.length > 0) setActiveId(forms[0].id);
    if (activeId && !forms.find((f) => f.id === activeId) && forms.length > 0) {
      setActiveId(forms[0].id);
    }
  }, [forms, activeId]);

  // Prune stale IDs and append new forms
  useEffect(() => {
    const currentIds = new Set(forms.map((f) => f.id));
    const next = tabOrder.filter((id) => currentIds.has(id));
    for (const f of forms) {
      if (!next.includes(f.id)) next.push(f.id);
    }
    if (next.length !== tabOrder.length || next.some((id, i) => id !== tabOrder[i])) {
      setTabOrder(next);
      saveTabOrder(next);
    }
  }, [forms]);

  const orderedForms = useMemo(() => {
    const byId = new Map(forms.map((f) => [f.id, f]));
    const result: HubForm[] = [];
    for (const id of tabOrder) {
      const f = byId.get(id);
      if (f) {
        result.push(f);
        byId.delete(id);
      }
    }
    for (const f of forms) {
      if (byId.has(f.id)) result.push(f);
    }
    return result;
  }, [forms, tabOrder]);

  const activeForm = orderedForms.find((f) => f.id === activeId) ?? null;

  const handleDragStart = (id: string) => {
    setDraggingId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggingId) setDragOverId(id);
  };

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const next = [...tabOrder];
    const fromIdx = next.indexOf(draggingId);
    const toIdx = next.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggingId);
    setTabOrder(next);
    saveTabOrder(next);
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  return (
    <div className="space-y-6">
      <Toaster />
      <div>
        <h1 className="text-2xl font-bold">Data</h1>
        <p className="text-sm text-muted-foreground">
          Spreadsheet view of every form's submissions. Each form is a tab.
        </p>
      </div>

      {forms.length === 0 ? (
        <div className="bg-card border rounded-2xl px-6 py-10 text-center text-sm text-muted-foreground">
          No forms yet.{" "}
          <Link to="/admin/forms" className="text-emerald-700 hover:underline">
            Create one
          </Link>{" "}
          to get started.
        </div>
      ) : (
        <>
          <div className="border-b overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              {orderedForms.map((f) => {
                const active = f.id === activeId;
                const isDragging = f.id === draggingId;
                const isOver = f.id === dragOverId;
                return (
                  <button
                    key={f.id}
                    draggable
                    onClick={() => setActiveId(f.id)}
                    onDragStart={() => handleDragStart(f.id)}
                    onDragOver={(e) => handleDragOver(e, f.id)}
                    onDrop={() => handleDrop(f.id)}
                    onDragEnd={handleDragEnd}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap cursor-pointer select-none transition-opacity ${
                      active
                        ? "border-emerald-600 text-emerald-700"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    } ${isDragging ? "opacity-40" : ""} ${isOver ? "bg-muted rounded-t-md" : ""}`}
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          </div>

          {activeForm && <FormDataTable key={activeForm.id} form={activeForm} />}
        </>
      )}
    </div>
  );
}

interface FormDataTableProps {
  form: HubForm;
}

function FormDataTable({ form }: FormDataTableProps) {
  const canApproveLeave = isAdminSession(useSession());
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [users, setUsers] = useState<HubUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState<ViewState>(() => loadView(form.id));
  const [saveListOpen, setSaveListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const isLeaveForm = form.slug === LEAVE_FORM_SLUG;
  const isPayrollForm = isPayrollRecordsSlug(form.slug);
  const [approvals, setApprovals] = useState<Record<string, LeaveApproval>>({});

  // Reload submissions when form changes
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [s, u] = await Promise.all([fetchSubmissions(form.id), fetchUsers()]);
      if (!active) return;
      setSubmissions(s);
      setUsers(u);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [form.id]);

  useEffect(() => {
    setView(loadView(form.id));
  }, [form.id]);

  // Load + poll leave approvals for the Request Time Off form
  useEffect(() => {
    if (!isLeaveForm) return;
    let active = true;
    const load = async () => {
      try {
        const list = await fetchLeaveApprovals();
        if (!active) return;
        const map: Record<string, LeaveApproval> = {};
        for (const r of list) map[r.submission_id] = r;
        setApprovals(map);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, [isLeaveForm, form.id]);

  const setApprovalStatus = async (submissionId: string, status: ApprovalStatus) => {
    setApprovals((m) => ({
      ...m,
      [submissionId]: { ...(m[submissionId] ?? { submission_id: submissionId, decided_at: null }), status },
    }));
    try {
      const updated = await updateLeaveApproval(submissionId, status);
      setApprovals((m) => ({ ...m, [submissionId]: updated }));
      toast.success(`Marked ${status}`);
      if (status === "approved" && updated.jobber_sync_error) {
        toast.error(`Jobber sync failed: ${updated.jobber_sync_error}`);
      }
    } catch {
      toast.error("Could not update approval status");
    }
  };

  useEffect(() => {
    saveView(form.id, view);
  }, [form.id, view]);

  const reload = async () => {
    setLoading(true);
    const [s, u] = await Promise.all([fetchSubmissions(form.id), fetchUsers()]);
    setSubmissions(s);
    setUsers(u);
    setLoading(false);
  };

  const formFields = useMemo(
    () => form.fields.filter((f) => !isStaticField(f.type)),
    [form.fields],
  );
  const extraFields = form.extraFields ?? [];

  const allColumns = useMemo(() => {
    const cols: Array<{ field: FormField; source: "form" | "extra" }> = [
      ...formFields.map((f) => ({ field: f, source: "form" as const })),
      ...extraFields.map((f) => ({ field: f, source: "extra" as const })),
    ];
    // Apply saved column order
    const order = view.columnOrder;
    if (order.length === 0) return cols;
    const byId = new Map(cols.map((c) => [c.field.id, c]));
    const result: typeof cols = [];
    for (const id of order) {
      const c = byId.get(id);
      if (c) {
        result.push(c);
        byId.delete(id);
      }
    }
    for (const c of byId.values()) result.push(c);
    return result;
  }, [formFields, extraFields, view.columnOrder]);

  const fieldById = useMemo(() => {
    const m = new Map<string, FormField>();
    for (const f of formFields) m.set(f.id, f);
    for (const f of extraFields) m.set(f.id, f);
    return m;
  }, [formFields, extraFields]);

  // Active list / draft
  const activeList = view.activeListId
    ? view.smartLists.find((l) => l.id === view.activeListId) ?? null
    : null;
  const combinator = activeList ? activeList.combinator : view.draftCombinator;
  const filters = activeList ? activeList.filters : view.draftFilters;
  const sorts = activeList ? activeList.sorts : view.draftSorts;

  const setCombinator = (c: "and" | "or") => {
    setView((v) => {
      if (v.activeListId) {
        return {
          ...v,
          smartLists: v.smartLists.map((l) =>
            l.id === v.activeListId ? { ...l, combinator: c } : l,
          ),
        };
      }
      return { ...v, draftCombinator: c };
    });
  };
  const setFilters = (next: Filter[]) => {
    setView((v) => {
      if (v.activeListId) {
        return {
          ...v,
          smartLists: v.smartLists.map((l) =>
            l.id === v.activeListId ? { ...l, filters: next } : l,
          ),
        };
      }
      return { ...v, draftFilters: next };
    });
  };
  const setSorts = (next: Sort[]) => {
    setView((v) => {
      if (v.activeListId) {
        return {
          ...v,
          smartLists: v.smartLists.map((l) =>
            l.id === v.activeListId ? { ...l, sorts: next } : l,
          ),
        };
      }
      return { ...v, draftSorts: next };
    });
  };

  // Filtering + sorting
  const visibleRows = useMemo(() => {
    let rows = submissions;
    if (filters.length > 0) {
      rows = rows.filter((s) =>
        combinator === "or"
          ? filters.some((f) => matchFilter(s, f, fieldById))
          : filters.every((f) => matchFilter(s, f, fieldById)),
      );
    }
    if (sorts.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const s of sorts) {
          const av = sortValue(a, s.fieldId, fieldById);
          const bv = sortValue(b, s.fieldId, fieldById);
          const cmp = compareValues(av, bv);
          if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }
    return rows;
  }, [submissions, filters, sorts, combinator, fieldById]);

  const handleCellChange = async (sub: FormSubmission, fieldId: string, value: unknown) => {
    const nextAnswers = { ...sub.answers, [fieldId]: value };
    setSubmissions((list) =>
      list.map((x) => (x.id === sub.id ? { ...x, answers: nextAnswers } : x)),
    );
    try {
      await updateSubmission(sub.id, nextAnswers);
    } catch {
      toast.error("Could not save change");
      reload();
    }
  };

  const handleDeleteRow = async (sub: FormSubmission) => {
    if (!confirm("Delete this row?")) return;
    try {
      await deleteSubmission(sub.id);
      setSubmissions((list) => list.filter((x) => x.id !== sub.id));
      toast.success("Row deleted");
    } catch {
      toast.error("Could not delete row");
    }
  };

  const handleAddColumn = async (field: FormField) => {
    try {
      await updateForm(form.id, { extraFields: [...extraFields, field] });
      toast.success("Column added");
      setAddOpen(false);
    } catch {
      toast.error("Could not add column");
    }
  };

  const handleRemoveColumn = async (fieldId: string) => {
    if (!confirm("Remove this column? Data stored in this column will be hidden.")) return;
    try {
      await updateForm(form.id, {
        extraFields: extraFields.filter((f) => f.id !== fieldId),
      });
      toast.success("Column removed");
    } catch {
      toast.error("Could not remove column");
    }
  };

  const moveColumn = (fieldId: string, dir: -1 | 1) => {
    const ids = allColumns.map((c) => c.field.id);
    const idx = ids.indexOf(fieldId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    setView((v) => ({ ...v, columnOrder: ids }));
  };

  const saveAsSmartList = () => {
    const name = newListName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    const list: SmartList = {
      id: `sl_${rid()}`,
      name,
      combinator: view.draftCombinator,
      filters: view.draftFilters,
      sorts: view.draftSorts,
    };
    setView((v) => ({
      ...v,
      smartLists: [...v.smartLists, list],
      activeListId: list.id,
      draftFilters: [],
      draftSorts: [],
      draftCombinator: "and",
    }));
    setNewListName("");
    setSaveListOpen(false);
    toast.success("Smart list saved");
  };

  const updateActiveListName = (name: string) => {
    setView((v) => ({
      ...v,
      smartLists: v.smartLists.map((l) =>
        l.id === v.activeListId ? { ...l, name } : l,
      ),
    }));
  };

  const deleteActiveList = () => {
    if (!activeList) return;
    if (!confirm(`Delete smart list "${activeList.name}"?`)) return;
    setView((v) => ({
      ...v,
      smartLists: v.smartLists.filter((l) => l.id !== v.activeListId),
      activeListId: null,
    }));
  };

  const filterableFields: Array<{ id: string; label: string; type: FieldType | "created_at" }> = [
    { id: CREATED_AT_ID, label: "Submitted at", type: "created_at" },
    ...allColumns.map((c) => ({
      id: c.field.id,
      label: c.field.label || "(untitled)",
      type: c.field.type,
    })),
  ];

  return (
    <section className="bg-card border rounded-2xl flex flex-col min-h-0">
      {/* Smart lists row */}
      <div className="px-4 pt-3 flex flex-wrap items-center gap-2 border-b pb-3">
        <button
          onClick={() => setView((v) => ({ ...v, activeListId: null }))}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            view.activeListId === null
              ? "bg-emerald-600 border-emerald-600 text-white"
              : "bg-background hover:bg-muted"
          }`}
        >
          All
        </button>
        {view.smartLists.map((l) => (
          <button
            key={l.id}
            onClick={() => setView((v) => ({ ...v, activeListId: l.id }))}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              view.activeListId === l.id
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "bg-background hover:bg-muted"
            }`}
          >
            {l.name}
          </button>
        ))}
        {view.activeListId === null && (filters.length > 0 || sorts.length > 0) && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setSaveListOpen(true)}
          >
            <Save className="h-3 w-3" /> Save as smart list
          </Button>
        )}
        {activeList && (
          <div className="flex items-center gap-1 ml-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <Pencil className="h-3 w-3" /> Rename
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="space-y-2">
                  <Label className="text-xs">Smart list name</Label>
                  <Input
                    defaultValue={activeList.name}
                    onBlur={(e) => updateActiveListName(e.target.value.trim() || activeList.name)}
                  />
                </div>
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 text-red-600 hover:text-red-700"
              onClick={deleteActiveList}
            >
              <Trash2 className="h-3 w-3" /> Delete list
            </Button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterPopover
            filters={filters}
            combinator={combinator}
            fields={filterableFields}
            onChange={setFilters}
            onCombinatorChange={setCombinator}
          />
          <SortPopover sorts={sorts} fields={filterableFields} onChange={setSorts} />
          <div className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${visibleRows.length} of ${submissions.length} row${
                  submissions.length === 1 ? "" : "s"
                }`}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-4 w-4" /> Add column
        </Button>
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)]">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted/50 text-left sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 font-medium whitespace-nowrap w-44 border-b">
                Submitted
              </th>
              {allColumns.map(({ field, source }, i) => (
                <th
                  key={field.id}
                  className="px-3 py-2 font-medium align-top min-w-[180px] border-b"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate" title={field.label}>
                        {field.label || "(untitled)"}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-normal">
                        {source === "extra"
                          ? "Table column"
                          : isPayrollForm && field.type === "users"
                            ? "Users (single-select)"
                            : FIELD_TYPE_LABELS[field.type]}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveColumn(field.id, -1)}
                        disabled={i === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        title="Move left"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveColumn(field.id, 1)}
                        disabled={i === allColumns.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        title="Move right"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      {source === "extra" && (
                        <button
                          type="button"
                          onClick={() => handleRemoveColumn(field.id)}
                          className="text-muted-foreground hover:text-red-600 ml-0.5"
                          title="Remove column"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </th>
              ))}
              {isLeaveForm && (
                <th className="px-3 py-2 font-medium whitespace-nowrap min-w-[140px] border-b">
                  Approval status
                </th>
              )}
              <th className="px-3 py-2 w-12 border-b"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={allColumns.length + 2 + (isLeaveForm ? 1 : 0)}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {submissions.length === 0
                    ? "No submissions yet."
                    : "No rows match the current filters."}
                </td>
              </tr>
            )}
            {visibleRows.map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {new Date(s.createdAt).toLocaleString()}
                </td>
                {allColumns.map(({ field }) => (
                  <td key={field.id} className="px-2 py-1.5">
                    <Cell
                      field={field}
                      value={s.answers[field.id]}
                      users={users}
                      onChange={(v) => handleCellChange(s, field.id, v)}
                      singleUserSelect={isPayrollForm}
                    />
                  </td>
                ))}
                {isLeaveForm && (
                  <td className="px-2 py-1.5">
                    {canApproveLeave ? (
                    <Select
                      value={approvals[s.id]?.status ?? "pending"}
                      onValueChange={(v) => setApprovalStatus(s.id, v as ApprovalStatus)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                    ) : (
                      <span className="text-xs capitalize text-muted-foreground">
                        {approvals[s.id]?.status ?? "pending"}
                      </span>
                    )}
                    {approvals[s.id]?.vacation_summary?.leave_type === "Vacation" && (
                      <div className="mt-1 text-[10px] leading-snug text-amber-900">
                        Avail {approvals[s.id].vacation_summary?.available_vacation_days ?? "—"} ·{" "}
                        {approvals[s.id].vacation_summary?.weekday_count} weekdays
                        {approvals[s.id].vacation_summary?.warning
                          ? ` · ${approvals[s.id].vacation_summary?.warning}`
                          : ""}
                      </div>
                    )}
                    {canApproveLeave && approvals[s.id]?.jobber_sync_error ? (
                      <button
                        type="button"
                        className="mt-1 text-[10px] text-rose-700 underline"
                        onClick={async () => {
                          try {
                            const updated = await retryJobberSync(s.id);
                            setApprovals((m) => ({ ...m, [s.id]: updated }));
                            if (updated.jobber_task_id) toast.success("Jobber task created");
                            else toast.error(updated.jobber_sync_error || "Jobber sync failed");
                          } catch {
                            toast.error("Could not retry Jobber sync");
                          }
                        }}
                      >
                        Retry Jobber: {approvals[s.id].jobber_sync_error}
                      </button>
                    ) : null}
                  </td>
                )}
                <td className="px-3 py-2">
                  <button
                    onClick={() => handleDeleteRow(s)}
                    className="text-red-600 hover:text-red-700"
                    aria-label="Delete row"
                    title="Delete row"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddColumnDialog open={addOpen} onOpenChange={setAddOpen} onAdd={handleAddColumn} />

      <Dialog open={saveListOpen} onOpenChange={setSaveListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as smart list</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="e.g. New leads this week"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveListOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveAsSmartList}>
              Save list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---------- Filter / Sort helpers ----------

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    const f = v as Partial<UploadedFile>;
    if (f.name) return f.name;
    return JSON.stringify(v);
  }
  return String(v);
}

function answerValue(sub: FormSubmission, fieldId: string): unknown {
  if (fieldId === CREATED_AT_ID) return sub.createdAt;
  return sub.answers[fieldId];
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function matchFilter(
  sub: FormSubmission,
  f: Filter,
  fieldById: Map<string, FormField>,
): boolean {
  const raw = answerValue(sub, f.fieldId);
  if (f.operator === "is_empty") return isEmpty(raw);
  if (f.operator === "is_not_empty") return !isEmpty(raw);

  const field = fieldById.get(f.fieldId);
  const type: FieldType | "created_at" =
    f.fieldId === CREATED_AT_ID ? "created_at" : field?.type ?? "single_line";

  // Numeric comparisons
  if (
    f.operator === "gt" ||
    f.operator === "lt" ||
    f.operator === "gte" ||
    f.operator === "lte"
  ) {
    if (type === "date" || type === "date_time" || type === "created_at") {
      const a = new Date(String(raw ?? "")).getTime();
      const b = new Date(f.value).getTime();
      if (!isFinite(a) || !isFinite(b)) return false;
      if (f.operator === "gt") return a > b;
      if (f.operator === "lt") return a < b;
      if (f.operator === "gte") return a >= b;
      return a <= b;
    }
    const a = Number(raw);
    const b = Number(f.value);
    if (!isFinite(a) || !isFinite(b)) return false;
    if (f.operator === "gt") return a > b;
    if (f.operator === "lt") return a < b;
    if (f.operator === "gte") return a >= b;
    return a <= b;
  }

  // Array-style "contains"
  if (Array.isArray(raw)) {
    const list = (raw as unknown[]).map((x) => String(x).toLowerCase());
    const v = f.value.toLowerCase();
    if (f.operator === "contains" || f.operator === "equals") return list.includes(v);
    if (f.operator === "not_contains" || f.operator === "not_equals")
      return !list.includes(v);
  }

  const text = asString(raw).toLowerCase();
  const v = f.value.toLowerCase();
  if (f.operator === "equals") return text === v;
  if (f.operator === "not_equals") return text !== v;
  if (f.operator === "contains") return text.includes(v);
  if (f.operator === "not_contains") return !text.includes(v);
  return true;
}

function sortValue(
  sub: FormSubmission,
  fieldId: string,
  _fieldById: Map<string, FormField>,
): unknown {
  return answerValue(sub, fieldId);
}

function compareValues(a: unknown, b: unknown): number {
  const ae = isEmpty(a);
  const be = isEmpty(b);
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  const an = Number(a);
  const bn = Number(b);
  if (isFinite(an) && isFinite(bn) && typeof a !== "boolean" && typeof b !== "boolean") {
    return an - bn;
  }
  const ad = Date.parse(String(a));
  const bd = Date.parse(String(b));
  if (isFinite(ad) && isFinite(bd)) return ad - bd;
  return asString(a).localeCompare(asString(b));
}

// ---------- Filter UI ----------

interface FilterPopoverProps {
  filters: Filter[];
  combinator: "and" | "or";
  fields: Array<{ id: string; label: string; type: FieldType | "created_at" }>;
  onChange: (f: Filter[]) => void;
  onCombinatorChange: (c: "and" | "or") => void;
}

function FilterPopover({
  filters,
  combinator,
  fields,
  onChange,
  onCombinatorChange,
}: FilterPopoverProps) {
  const addFilter = () => {
    const first = fields[0];
    if (!first) return;
    const ops = operatorsForType(first.type);
    onChange([
      ...filters,
      { id: `flt_${rid()}`, fieldId: first.id, operator: ops[0], value: "" },
    ]);
  };
  const updateFilter = (id: string, patch: Partial<Filter>) => {
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };
  const removeFilter = (id: string) => onChange(filters.filter((f) => f.id !== id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1">
          <FilterIcon className="h-3.5 w-3.5" />
          Filter
          {filters.length > 0 && (
            <span className="ml-1 text-xs bg-emerald-100 text-emerald-700 px-1.5 rounded-full">
              {filters.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] max-w-[90vw]" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Filters</div>
            {filters.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Match</span>
                <Select
                  value={combinator}
                  onValueChange={(v) => onCombinatorChange(v as "and" | "or")}
                >
                  <SelectTrigger className="h-7 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and">All</SelectItem>
                    <SelectItem value="or">Any</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {filters.length === 0 && (
            <div className="text-sm text-muted-foreground">No filters yet.</div>
          )}
          {filters.map((f) => {
            const meta = fields.find((x) => x.id === f.fieldId);
            const ops = operatorsForType(meta?.type ?? "single_line");
            const showValue =
              f.operator !== "is_empty" && f.operator !== "is_not_empty";
            const t = meta?.type;
            const inputType =
              t === "number" || t === "star_rating"
                ? "number"
                : t === "date"
                ? "date"
                : t === "date_time" || t === "created_at"
                ? "datetime-local"
                : "text";
            return (
              <div key={f.id} className="flex items-start gap-1.5">
                <Select
                  value={f.fieldId}
                  onValueChange={(v) => {
                    const newMeta = fields.find((x) => x.id === v);
                    const newOps = operatorsForType(newMeta?.type ?? "single_line");
                    updateFilter(f.id, {
                      fieldId: v,
                      operator: newOps.includes(f.operator) ? f.operator : newOps[0],
                    });
                  }}
                >
                  <SelectTrigger className="h-8 flex-1 min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={f.operator}
                  onValueChange={(v) => updateFilter(f.id, { operator: v as Operator })}
                >
                  <SelectTrigger className="h-8 w-36 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ops.map((o) => (
                      <SelectItem key={o} value={o}>
                        {OPERATOR_LABELS[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showValue ? (
                  <Input
                    type={inputType}
                    value={f.value}
                    onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    className="h-8 w-40 shrink-0"
                  />
                ) : (
                  <div className="w-40 shrink-0" />
                )}
                <button
                  onClick={() => removeFilter(f.id)}
                  className="text-muted-foreground hover:text-red-600 p-1"
                  title="Remove filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <Button size="sm" variant="outline" onClick={addFilter}>
              <Plus className="h-3.5 w-3.5" /> Add filter
            </Button>
            {filters.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => onChange([])}>
                Clear all
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface SortPopoverProps {
  sorts: Sort[];
  fields: Array<{ id: string; label: string; type: FieldType | "created_at" }>;
  onChange: (s: Sort[]) => void;
}

function SortPopover({ sorts, fields, onChange }: SortPopoverProps) {
  const addSort = () => {
    const first = fields[0];
    if (!first) return;
    onChange([...sorts, { fieldId: first.id, dir: "asc" }]);
  };
  const updateSort = (i: number, patch: Partial<Sort>) =>
    onChange(sorts.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeSort = (i: number) => onChange(sorts.filter((_, idx) => idx !== i));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1">
          <ArrowUpDown className="h-3.5 w-3.5" />
          Sort
          {sorts.length > 0 && (
            <span className="ml-1 text-xs bg-emerald-100 text-emerald-700 px-1.5 rounded-full">
              {sorts.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[460px] max-w-[90vw]" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">Sort</div>
          {sorts.length === 0 && (
            <div className="text-sm text-muted-foreground">No sorts yet.</div>
          )}
          {sorts.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select
                value={s.fieldId}
                onValueChange={(v) => updateSort(i, { fieldId: v })}
              >
                <SelectTrigger className="h-8 flex-1 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={s.dir}
                onValueChange={(v) => updateSort(i, { dir: v as "asc" | "desc" })}
              >
                <SelectTrigger className="h-8 w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Ascending</SelectItem>
                  <SelectItem value="desc">Descending</SelectItem>
                </SelectContent>
              </Select>
              <button
                onClick={() => removeSort(i)}
                className="text-muted-foreground hover:text-red-600 p-1"
                title="Remove sort"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <Button size="sm" variant="outline" onClick={addSort}>
              <Plus className="h-3.5 w-3.5" /> Add sort
            </Button>
            {sorts.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => onChange([])}>
                Clear all
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Cell rendering ----------

interface CellProps {
  field: FormField;
  value: unknown;
  users: HubUser[];
  onChange: (v: unknown) => void;
  /** Payroll records: one technician per row; compact dropdown instead of all-staff chips. */
  singleUserSelect?: boolean;
}

function Cell({ field, value, users, onChange, singleUserSelect }: CellProps) {
  switch (field.type) {
    case "single_line":
      return (
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-8"
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-8"
        />
      );
    case "multi_line":
      return (
        <Textarea
          rows={2}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[2rem]"
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-8"
        />
      );
    case "date_time":
      return (
        <Input
          type="datetime-local"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-8"
        />
      );
    case "dropdown":
    case "radio":
      return (
        <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multi_dropdown": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (opt: string) => {
        if (selected.includes(opt)) onChange(selected.filter((n) => n !== opt));
        else onChange([...selected, opt]);
      };
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((opt) => (
            <label
              key={opt}
              className={`text-xs px-2 py-0.5 rounded-full border cursor-pointer ${
                selected.includes(opt)
                  ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                  : "bg-background"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    case "users": {
      const active = users.filter((u) => u.status === "active");
      if (singleUserSelect) {
        const names = normalizeUserNames(value);
        const current = singleUserName(value);
        return (
          <div className="min-w-[220px] max-w-xs space-y-1">
            <UsersSingleSelect
              users={active}
              value={current}
              onChange={(name) => onChange(name ? [name] : [])}
              compact
            />
            {names.length > 1 && (
              <p className="text-[10px] text-amber-700 leading-snug">
                Had {names.length} names; pick one to keep. Others:{" "}
                {names.slice(1).join(", ")}
              </p>
            )}
          </div>
        );
      }
      return (
        <div className="min-w-[220px] max-w-sm">
          <UsersMultiSelect
            users={active}
            value={normalizeUserNames(value)}
            onChange={onChange}
            compact
          />
        </div>
      );
    }
    case "star_rating": {
      const max = field.maxStars ?? 5;
      const current = Number(value) || 0;
      return (
        <div className="flex gap-0.5">
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
                <Star className="h-4 w-4" fill={n <= current ? "currentColor" : "none"} />
              </button>
            );
          })}
        </div>
      );
    }
    case "file_upload": {
      const current = isFileAnswer(value) ? value : null;
      const handleFile = async (file: File) => {
        try {
          const uploaded = await uploadFormFile(file);
          onChange(uploaded);
        } catch {
          toast.error("Could not upload file");
        }
      };
      return (
        <div className="space-y-1">
          {current && <FileLink file={current} />}
          <input
            type="file"
            accept={field.accept || undefined}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            className="block w-full text-xs"
          />
        </div>
      );
    }
    case "payrolls":
      return <PayrollsCell field={field} value={value} onChange={onChange} />;
    default:
      return <span className="text-muted-foreground text-xs">—</span>;
  }
}

interface PayrollsCellProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}

function PayrollsCell({ field, value, onChange }: PayrollsCellProps) {
  const [options, setOptions] = useState<PayrollOption[]>([]);
  useEffect(() => {
    if (!field.sourceFormId) return;
    fetchOpenPayrolls(field.sourceFormId, field.labelFieldId, field.statusFieldId).then(setOptions);
  }, [field.sourceFormId, field.labelFieldId, field.statusFieldId]);

  const current = typeof value === "string" ? value : "";
  // Back-compat: if stored value is an id, resolve to label
  const matched = options.find((o) => o.id === current);
  const displayValue = matched ? matched.label : current;

  if (!field.sourceFormId) {
    return <span className="text-xs">{displayValue || "—"}</span>;
  }

  return (
    <Select value={displayValue} onValueChange={(v) => onChange(v)}>
      <SelectTrigger className="h-8">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.label}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FileLink({ file }: { file: UploadedFile }) {
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
      className="text-emerald-700 hover:underline text-xs break-all text-left"
    >
      {loading ? "Loading…" : file.name}
    </button>
  );
}

interface AddColumnProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (field: FormField) => void;
}

function AddColumnDialog({ open, onOpenChange, onAdd }: AddColumnProps) {
  const [type, setType] = useState<FieldType>("single_line");
  const [label, setLabel] = useState("");
  const [optionsText, setOptionsText] = useState("Option 1\nOption 2");
  const [maxStars, setMaxStars] = useState(5);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (open) {
      setType("single_line");
      setLabel("");
      setOptionsText("Option 1\nOption 2");
      setMaxStars(5);
      setRequired(false);
    }
  }, [open]);

  const hasOptions = type === "dropdown" || type === "radio" || type === "multi_dropdown";

  const handleAdd = () => {
    if (!label.trim()) {
      toast.error("Column name is required");
      return;
    }
    const f = newField(type);
    f.label = label.trim();
    f.required = required;
    if (hasOptions) {
      const opts = optionsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      f.options = opts.length > 0 ? opts : ["Option 1"];
    }
    if (type === "star_rating") f.maxStars = maxStars;
    onAdd(f);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add column</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Column name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Status"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Field type</Label>
            <Select value={type} onValueChange={(v) => setType(v as FieldType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMN_FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasOptions && (
            <div className="space-y-1.5">
              <Label>Options (one per line)</Label>
              <Textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
          )}
          {type === "star_rating" && (
            <div className="space-y-1.5">
              <Label>Max stars</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxStars}
                onChange={(e) => setMaxStars(Number(e.target.value) || 5)}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="add-col-required"
              checked={required}
              onCheckedChange={(c) => setRequired(!!c)}
            />
            <Label htmlFor="add-col-required" className="text-sm cursor-pointer">
              Required
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd}>
            Add column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
