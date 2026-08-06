import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import {
  FIELD_TYPE_LABELS,
  isConditionSource,
  isStaticField,
  isStaticText,
  newField,
  slugify,
  uploadFormFile,
  useForms,
  type FieldType,
  type FormField,
  type FormStatus,
  type HubForm,
} from "@/lib/forms-store";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Draft = {
  name: string;
  description: string;
  slug: string;
  status: FormStatus;
  fields: FormField[];
};

const emptyDraft: Draft = {
  name: "",
  description: "",
  slug: "",
  status: "active",
  fields: [],
};

const FIELD_TYPES: FieldType[] = [
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
  "payrolls",
  "file_upload",
  "image",
  "headline",
  "subheadline",
  "paragraph",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: HubForm | null;
  onSave: (draft: Draft) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}

export function FormBuilderDialog({ open, onOpenChange, initial, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft({
        name: initial.name,
        description: initial.description,
        slug: initial.slug,
        status: initial.status,
        fields: initial.fields ?? [],
      });
      setSlugTouched(true);
    } else {
      setDraft(emptyDraft);
      setSlugTouched(false);
    }
    setExpanded({});
  }, [open, initial]);

  const updateField = (id: string, patch: Partial<FormField>) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  };

  const removeField = (id: string) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields
        .filter((f) => f.id !== id)
        .map((f) => {
          if (!f.condition) return f;
          const rules = (f.condition.rules ?? []).filter((r) => r.fieldId !== id);
          const legacyMatches = f.condition.fieldId === id;
          if (rules.length === 0 || legacyMatches) {
            return { ...f, condition: null };
          }
          return { ...f, condition: { combinator: f.condition.combinator ?? "and", rules } };
        }),
    }));
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      const next = [...d.fields];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, fields: next };
    });
  };

  const addField = (type: FieldType) => {
    const f = newField(type);
    setDraft((d) => ({ ...d, fields: [...d.fields, f] }));
    setExpanded((e) => ({ ...e, [f.id]: true }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlug = draft.slug.trim() || slugify(draft.name);
    onSave({ ...draft, slug: finalSlug });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none max-h-none inset-0 top-0 left-0 translate-x-0 translate-y-0 rounded-none overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit form" : "Create form"}</DialogTitle>
          <DialogDescription>
            Build your form by adding fields. Use conditions to show or hide fields based on
            other answers.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fb-name">Name</Label>
              <Input
                id="fb-name"
                value={draft.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    name,
                    slug: slugTouched ? d.slug : slugify(name),
                  }));
                }}
                placeholder="Customer feedback"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fb-status">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(v) => setDraft({ ...draft, status: v as FormStatus })}
              >
                <SelectTrigger id="fb-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-desc">Description</Label>
            <Input
              id="fb-desc"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Short note about what this form is for"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-slug">Slug (unique)</Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">/forms/</span>
              <Input
                id="fb-slug"
                value={draft.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setDraft({ ...draft, slug: slugify(e.target.value) });
                }}
                placeholder="customer-feedback"
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Used in the public form URL. Lowercase letters, numbers, and dashes only.
            </p>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Fields ({draft.fields.length})</h3>
            </div>

            {draft.fields.length === 0 && (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No fields yet. Add one below to start building.
              </div>
            )}

            <div className="space-y-2">
              {draft.fields.map((f, idx) => (
                <FieldEditor
                  key={f.id}
                  field={f}
                  index={idx}
                  total={draft.fields.length}
                  allFields={draft.fields}
                  expanded={!!expanded[f.id]}
                  onToggle={() =>
                    setExpanded((e) => ({ ...e, [f.id]: !e[f.id] }))
                  }
                  onChange={(patch) => updateField(f.id, patch)}
                  onRemove={() => removeField(f.id)}
                  onMoveUp={() => moveField(idx, -1)}
                  onMoveDown={() => moveField(idx, 1)}
                />
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {FIELD_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addField(t)}
                >
                  <Plus className="h-3.5 w-3.5" /> {FIELD_TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {initial && onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={onDelete}
                className="mr-auto"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {initial ? "Save changes" : "Create form"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FieldEditorProps {
  field: FormField;
  index: number;
  total: number;
  allFields: FormField[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function FieldEditor({
  field,
  index,
  total,
  allFields,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: FieldEditorProps) {
  const hasOptions = field.type === "dropdown" || field.type === "radio" || field.type === "multi_dropdown";
  const staticText = isStaticText(field.type);
  const staticAny = isStaticField(field.type);

  const handleImageUpload = async (file: File) => {
    try {
      const uploaded = await uploadFormFile(file, "form-images");
      const { data, error } = await supabase.storage
        .from("form-uploads")
        .createSignedUrl(uploaded.path, 60 * 60 * 24 * 365 * 5);
      if (error || !data?.signedUrl) throw error ?? new Error("No URL");
      onChange({ imageUrl: data.signedUrl });
      toast.success("Image uploaded");
    } catch (err) {
      console.error(err);
      toast.error("Could not upload image");
    }
  };

  // Conditional logic editor lives in its own component below.

  const setOption = (i: number, value: string) => {
    const opts = [...(field.options ?? [])];
    opts[i] = value;
    onChange({ options: opts });
  };
  const addOption = () => {
    const opts = [...(field.options ?? []), `Option ${(field.options?.length ?? 0) + 1}`];
    onChange({ options: opts });
  };
  const removeOption = (i: number) => {
    const opts = (field.options ?? []).filter((_, idx) => idx !== i);
    onChange({ options: opts });
  };

  const setStyle = (patch: Partial<NonNullable<FormField["style"]>>) => {
    onChange({ style: { ...(field.style ?? {}), ...patch } });
  };

  const headerTitle = staticText
    ? field.content || FIELD_TYPE_LABELS[field.type]
    : field.type === "image"
    ? "Image"
    : field.label;

  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Toggle field"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {headerTitle || <span className="text-muted-foreground">Untitled</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {FIELD_TYPE_LABELS[field.type]}
            {!staticText && field.required ? " · required" : ""}
            {!staticAny && field.condition ? " · conditional" : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move up"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move down"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-red-600 hover:text-red-700"
          aria-label="Remove field"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!staticAny && (
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={field.label}
                  onChange={(e) => onChange({ label: e.target.value })}
                  placeholder="Your question"
                />
              </div>
            )}
            <div className={`space-y-1.5 ${staticAny ? "sm:col-span-2" : ""}`}>
              <Label className="text-xs">Type</Label>
              <Select
                value={field.type}
                onValueChange={(v) => {
                  const t = v as FieldType;
                  const fresh = newField(t);
                  onChange({
                    type: t,
                    options: fresh.options,
                    maxStars: fresh.maxStars,
                    content: fresh.content ?? field.content,
                    style: fresh.style ?? field.style,
                    imageUrl: fresh.imageUrl ?? field.imageUrl,
                    imageWidth: fresh.imageWidth ?? field.imageWidth,
                    imageAlign: fresh.imageAlign ?? field.imageAlign,
                    accept: fresh.accept ?? field.accept,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {staticText && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Text</Label>
                {field.type === "paragraph" ? (
                  <Textarea
                    rows={3}
                    value={field.content ?? ""}
                    onChange={(e) => onChange({ content: e.target.value })}
                  />
                ) : (
                  <Input
                    value={field.content ?? ""}
                    onChange={(e) => onChange({ content: e.target.value })}
                  />
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Font size (px)</Label>
                  <Input
                    type="number"
                    min={8}
                    max={96}
                    value={field.style?.fontSize ?? 16}
                    onChange={(e) =>
                      setStyle({ fontSize: Math.max(8, Math.min(96, Number(e.target.value) || 16)) })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Weight</Label>
                  <Select
                    value={String(field.style?.fontWeight ?? 400)}
                    onValueChange={(v) => setStyle({ fontWeight: Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                        <SelectItem key={w} value={String(w)}>
                          {w}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Color</Label>
                  <Input
                    type="color"
                    value={field.style?.color ?? "#0f172a"}
                    onChange={(e) => setStyle({ color: e.target.value })}
                    className="h-10 p-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Align</Label>
                  <Select
                    value={field.style?.align ?? "left"}
                    onValueChange={(v) =>
                      setStyle({ align: v as "left" | "center" | "right" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!field.style?.italic}
                  onCheckedChange={(v) => setStyle({ italic: v })}
                  id={`italic-${field.id}`}
                />
                <Label htmlFor={`italic-${field.id}`} className="text-sm cursor-pointer">
                  Italic
                </Label>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hyperlink URL (optional)</Label>
                <Input
                  type="url"
                  value={field.style?.href ?? ""}
                  onChange={(e) => setStyle({ href: e.target.value })}
                  placeholder="https://example.com"
                />
                <p className="text-xs text-muted-foreground">
                  If set, the text becomes a clickable link opening in a new tab.
                </p>
              </div>
              <div
                className="rounded-md border bg-background p-3"
                style={{
                  fontSize: field.style?.fontSize,
                  fontWeight: field.style?.fontWeight,
                  color: field.style?.color,
                  fontStyle: field.style?.italic ? "italic" : "normal",
                  textAlign: field.style?.align ?? "left",
                  whiteSpace: "pre-wrap",
                }}
              >
                {field.style?.href ? (
                  <a
                    href={field.style.href}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    {field.content || "Preview"}
                  </a>
                ) : (
                  field.content || "Preview"
                )}
              </div>
            </div>
          )}

          {(field.type === "single_line" || field.type === "multi_line") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Placeholder</Label>
              {field.type === "single_line" ? (
                <Input
                  value={field.placeholder ?? ""}
                  onChange={(e) => onChange({ placeholder: e.target.value })}
                />
              ) : (
                <Textarea
                  rows={2}
                  value={field.placeholder ?? ""}
                  onChange={(e) => onChange({ placeholder: e.target.value })}
                />
              )}
            </div>
          )}

          {hasOptions && (
            <div className="space-y-1.5">
              <Label className="text-xs">Options</Label>
              <div className="space-y-2">
                {(field.options ?? []).map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={(e) => setOption(i, e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="text-muted-foreground hover:text-red-600"
                      aria-label="Remove option"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addOption}>
                  <Plus className="h-3.5 w-3.5" /> Add option
                </Button>
              </div>
            </div>
          )}

          {field.type === "star_rating" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Max stars</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={field.maxStars ?? 5}
                  onChange={(e) =>
                    onChange({ maxStars: Math.max(1, Math.min(10, Number(e.target.value) || 5)) })
                  }
                  className="w-24"
                />
                <div className="flex gap-0.5 text-amber-500">
                  {Array.from({ length: field.maxStars ?? 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
              </div>
            </div>
          )}

          {field.type === "image" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Image</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImageUpload(f);
                      e.target.value = "";
                    }}
                    className="text-sm"
                  />
                  {field.imageUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange({ imageUrl: "" })}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              {field.imageUrl && (
                <div className="rounded-md border bg-background p-3" style={{ textAlign: field.imageAlign ?? "center" }}>
                  <img
                    src={field.imageUrl}
                    alt="Preview"
                    style={{ width: field.imageWidth ?? 240, maxWidth: "100%", display: "inline-block" }}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Width (px)</Label>
                  <Input
                    type="number"
                    min={32}
                    max={1200}
                    value={field.imageWidth ?? 240}
                    onChange={(e) =>
                      onChange({
                        imageWidth: Math.max(32, Math.min(1200, Number(e.target.value) || 240)),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Align</Label>
                  <Select
                    value={field.imageAlign ?? "center"}
                    onValueChange={(v) =>
                      onChange({ imageAlign: v as "left" | "center" | "right" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {field.type === "file_upload" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Accepted file types (optional)</Label>
              <Input
                value={field.accept ?? ""}
                onChange={(e) => onChange({ accept: e.target.value })}
                placeholder="e.g. image/*, .pdf, .docx"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated MIME types or extensions. Leave blank to allow any file.
              </p>
            </div>
          )}

          {field.type === "payrolls" && (
            <PayrollsConfig field={field} onChange={onChange} />
          )}


          {!staticAny && (
            <div className="flex items-center gap-2">
              <Switch
                checked={!!field.required}
                onCheckedChange={(v) => onChange({ required: v })}
                id={`req-${field.id}`}
              />
              <Label htmlFor={`req-${field.id}`} className="text-sm cursor-pointer">
                Required
              </Label>
            </div>
          )}

          <ConditionEditor
            field={field}
            allFields={allFields}
            index={index}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

interface ConditionEditorProps {
  field: FormField;
  allFields: FormField[];
  index: number;
  onChange: (patch: Partial<FormField>) => void;
}

function ConditionEditor({ field, allFields, index, onChange }: ConditionEditorProps) {
  const candidates = allFields.slice(0, index).filter((f) => isConditionSource(f.type));

  const sourceValues = (src: FormField | null | undefined): string[] => {
    if (!src) return [];
    if (src.type === "star_rating") {
      const max = src.maxStars ?? 5;
      return Array.from({ length: max }, (_, i) => String(i + 1));
    }
    return src.options ?? [];
  };

  const cond = field.condition && (field.condition.rules?.length || field.condition.fieldId)
    ? {
        combinator: field.condition.combinator ?? "and",
        rules:
          field.condition.rules && field.condition.rules.length > 0
            ? field.condition.rules
            : [{ fieldId: field.condition.fieldId ?? "", equals: field.condition.equals ?? [] }],
      }
    : null;

  const enableCond = () => {
    if (candidates.length === 0) return;
    const src = candidates[0];
    const vals = sourceValues(src);
    onChange({
      condition: {
        combinator: "and",
        rules: [{ fieldId: src.id, equals: vals[0] ? [vals[0]] : [] }],
      },
    });
  };

  const updateRule = (i: number, patch: Partial<{ fieldId: string; equals: string[] }>) => {
    if (!cond) return;
    const rules = cond.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange({ condition: { combinator: cond.combinator, rules } });
  };

  const addRule = () => {
    if (!cond || candidates.length === 0) return;
    const src = candidates[0];
    const vals = sourceValues(src);
    onChange({
      condition: {
        combinator: cond.combinator,
        rules: [...cond.rules, { fieldId: src.id, equals: vals[0] ? [vals[0]] : [] }],
      },
    });
  };

  const removeRule = (i: number) => {
    if (!cond) return;
    const rules = cond.rules.filter((_, idx) => idx !== i);
    if (rules.length === 0) {
      onChange({ condition: null });
    } else {
      onChange({ condition: { combinator: cond.combinator, rules } });
    }
  };

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Conditional visibility</Label>
        <Switch
          checked={!!cond}
          onCheckedChange={(v) => (v ? enableCond() : onChange({ condition: null }))}
          disabled={candidates.length === 0}
          id={`cond-${field.id}`}
        />
      </div>

      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Add a dropdown, radio, or star rating field above this one to enable conditional logic.
        </p>
      ) : !cond ? (
        <p className="text-xs text-muted-foreground">This field is always visible.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Show when</span>
            <Select
              value={cond.combinator}
              onValueChange={(v) =>
                onChange({ condition: { combinator: v as "and" | "or", rules: cond.rules } })
              }
            >
              <SelectTrigger className="h-7 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">ALL</SelectItem>
                <SelectItem value="or">ANY</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">of these match:</span>
          </div>

          {cond.rules.map((rule, ri) => {
            const src = allFields.find((f) => f.id === rule.fieldId) ?? null;
            const vals = sourceValues(src);
            return (
              <div key={ri} className="rounded-md border bg-muted/30 p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Select
                    value={rule.fieldId}
                    onValueChange={(v) => {
                      const s = allFields.find((f) => f.id === v) ?? null;
                      const sv = sourceValues(s);
                      updateRule(ri, { fieldId: v, equals: sv[0] ? [sv[0]] : [] });
                    }}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label || FIELD_TYPE_LABELS[c.type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeRule(ri)}
                    className="text-muted-foreground hover:text-red-600"
                    aria-label="Remove rule"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {vals.map((opt) => {
                    const selected = rule.equals.includes(opt);
                    return (
                      <button
                        type="button"
                        key={opt}
                        onClick={() => {
                          const eq = selected
                            ? rule.equals.filter((x) => x !== opt)
                            : [...rule.equals, opt];
                          updateRule(ri, { equals: eq });
                        }}
                        className={`px-2 py-0.5 rounded-full text-xs border ${
                          selected
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-background text-foreground"
                        }`}
                      >
                        {src?.type === "star_rating" ? `${opt} ★` : opt}
                      </button>
                    );
                  })}
                  {vals.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      Add options to the source field first.
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          <Button type="button" variant="outline" size="sm" onClick={addRule}>
            <Plus className="h-3.5 w-3.5" /> Add condition
          </Button>
        </div>
      )}
    </div>
  );
}

interface PayrollsConfigProps {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
}

function PayrollsConfig({ field, onChange }: PayrollsConfigProps) {
  const forms = useForms();
  const sourceForm = forms.find((f) => f.id === field.sourceFormId);
  const sourceFields = (sourceForm?.fields ?? []).filter(
    (f) => !isStaticField(f.type),
  );

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3 bg-background">
      <div className="space-y-1.5">
        <Label className="text-xs">Payroll source form</Label>
        <Select
          value={field.sourceFormId ?? ""}
          onValueChange={(v) =>
            onChange({ sourceFormId: v, labelFieldId: undefined, statusFieldId: undefined })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a form…" />
          </SelectTrigger>
          <SelectContent>
            {forms.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Submissions of this form become payrolls available to choose from.
        </p>
      </div>

      {sourceForm && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Label field (shown in dropdown)</Label>
            <Select
              value={field.labelFieldId ?? ""}
              onValueChange={(v) => onChange({ labelFieldId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                {sourceFields.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label || f.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status field (must equal "Open")</Label>
            <Select
              value={field.statusFieldId ?? ""}
              onValueChange={(v) => onChange({ statusFieldId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="No filter" />
              </SelectTrigger>
              <SelectContent>
                {sourceFields.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label || f.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
