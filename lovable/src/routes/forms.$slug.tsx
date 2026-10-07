import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  evaluateCondition,
  fetchFormBySlug,
  fetchOpenPayrolls,
  submitFormAnswers,
  uploadFormFile,
  getFileSignedUrl,
  normalizeFileAnswers,
  type FormField,
  type HubForm,
  type PayrollOption,
  type UploadedFile,
} from "@/lib/forms-store";
import { fetchUsers, type HubUser } from "@/lib/hub-store";

export const Route = createFileRoute("/forms/$slug")({
  component: PublicFormPage,
});

function PublicFormPage() {
  const { slug } = Route.useParams();
  const [form, setForm] = useState<HubForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [users, setUsers] = useState<HubUser[]>([]);

  useEffect(() => {
    fetchUsers().then(setUsers);
  }, []);

  useEffect(() => {
    let active = true;
    fetchFormBySlug(slug).then((f) => {
      if (!active) return;
      setForm(f);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  const visibleFields = useMemo(() => {
    if (!form) return [];
    return form.fields.filter((f) => evaluateCondition(f.condition, answers));
  }, [form, answers]);

  const setAnswer = (id: string, value: unknown) =>
    setAnswers((a) => ({ ...a, [id]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    // required check
    for (const f of visibleFields) {
      if (f.required && !isStaticType(f)) {
        const v = answers[f.id];
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
          toast.error(`${f.label || "Field"} is required`);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      // Only include answers for visible, non-static fields
      const payload: Record<string, unknown> = {};
      for (const f of visibleFields) {
        if (isStaticType(f)) continue;
        if (answers[f.id] !== undefined) payload[f.id] = answers[f.id];
      }
      await submitFormAnswers(form.id, payload);
      setSubmitted(true);
      toast.success("Submitted, thank you!");
    } catch {
      toast.error("Could not submit. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!form) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Form not found.
      </div>
    );
  }

  if (form.status !== "active") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        This form is not currently accepting responses.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Thank you!</h1>
          <p className="text-muted-foreground">Your response has been recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-card border rounded-2xl p-6 sm:p-8 space-y-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {visibleFields.map((f) => (
            <FieldRenderer
              key={f.id}
              field={f}
              value={answers[f.id]}
              onChange={(v) => setAnswer(f.id, v)}
              users={users}
            />
          ))}

          <Button
            type="submit"
            disabled={submitting}
            className=""
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function isStaticType(t: FormField | FormField["type"]) {
  if (typeof t === "object" && t !== null) {
    if (t.type === "image") return !!t.imageUrl;
    return t.type === "headline" || t.type === "subheadline" || t.type === "paragraph";
  }
  return t === "headline" || t === "subheadline" || t === "paragraph";
}

export interface FieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  users: HubUser[];
}

export function FieldRenderer({ field, value, onChange, users }: FieldRendererProps) {
  if (field.type === "image") {
    if (field.imageUrl) {
      return (
        <div style={{ textAlign: field.imageAlign ?? "center" }}>
          <img
            src={field.imageUrl}
            alt=""
            style={{ width: field.imageWidth ?? 240, maxWidth: "100%", display: "inline-block" }}
          />
        </div>
      );
    }
    return <ImageUploadField field={field} value={value} onChange={onChange} />;
  }
  if (isStaticType(field)) {
    const Tag = field.type === "headline" ? "h2" : field.type === "subheadline" ? "h3" : "p";
    const style: React.CSSProperties = {
      fontSize: field.style?.fontSize,
      fontWeight: field.style?.fontWeight,
      color: field.style?.color,
      fontStyle: field.style?.italic ? "italic" : "normal",
      textAlign: field.style?.align ?? "left",
      whiteSpace: "pre-wrap",
    };
    const href = field.style?.href?.trim();
    return (
      <Tag style={style}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            {field.content}
          </a>
        ) : (
          field.content
        )}
      </Tag>
    );
  }

  const label = (
    <Label className="text-sm">
      {field.label}
      {field.required && <span className="text-red-600 ml-0.5">*</span>}
    </Label>
  );

  switch (field.type) {
    case "single_line":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </div>
      );
    case "number":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="number"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </div>
      );
    case "multi_line":
      return (
        <div className="space-y-1.5">
          {label}
          <Textarea
            rows={4}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
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
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "multi_dropdown": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5">
          {label}
          <OptionsMultiSelect
            options={field.options ?? []}
            value={selected}
            onChange={onChange}
            placeholder="Select…"
          />
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
                <RadioGroupItem value={o} id={`${field.id}-${o}`} />
                <Label htmlFor={`${field.id}-${o}`} className="text-sm cursor-pointer">
                  {o}
                </Label>
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
            required={field.required}
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
            required={field.required}
          />
        </div>
      );
    case "users": {
      const activeUsers = users.filter((u) => u.status === "active");
      return (
        <div className="space-y-1.5">
          {label}
          <UsersMultiSelect
            users={activeUsers}
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
          />
        </div>
      );
    }
    case "payrolls":
      return <PayrollsField field={field} value={value} onChange={onChange} />;
    case "file_upload":
      return <FileUploadField field={field} value={value} onChange={onChange} />;
    default:
      return null;
  }
}

interface FileUploadFieldProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}

function FileUploadField({ field, value, onChange }: FileUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const files = normalizeFileAnswers(value);

  const handleFiles = async (fileList: FileList | File[]) => {
    const fileArray = Array.from(fileList);
    if (fileArray.length === 0) return;
    setUploading(true);
    try {
      const uploadedList: UploadedFile[] = [];
      for (const file of fileArray) {
        const uploaded = await uploadFormFile(file);
        uploadedList.push(uploaded);
      }
      onChange([...files, ...uploadedList]);
    } catch {
      toast.error("Could not upload file(s)");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {field.label || "File upload"}
        {field.required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      <input
        type="file"
        multiple
        accept={field.accept || undefined}
        disabled={uploading}
        onChange={(e) => {
          if (e.target.files) {
            handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
        className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-foreground file:cursor-pointer hover:file:bg-muted"
      />
      {uploading && <p className="text-xs text-muted-foreground">Uploading file(s)…</p>}
      {files.length > 0 && (
        <ul className="space-y-1.5 pt-1 text-xs">
          {files.map((f, i) => (
            <li key={`${f.path}-${i}`} className="flex items-center justify-between gap-2 p-2 rounded-md border bg-background">
              <span className="truncate font-medium text-foreground">
                {f.name} {f.size ? `(${Math.round(f.size / 1024)} KB)` : ""}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-red-600 shrink-0"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImageUploadField({ field, value, onChange }: FileUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const files = normalizeFileAnswers(value);

  useEffect(() => {
    let active = true;
    files.forEach((f) => {
      if (f.path && !previewUrls[f.path]) {
        getFileSignedUrl(f.path).then((url) => {
          if (active && url) {
            setPreviewUrls((prev) => ({ ...prev, [f.path]: url }));
          }
        });
      }
    });
    return () => {
      active = false;
    };
  }, [files]);

  const handleFiles = async (fileList: FileList | File[]) => {
    const fileArray = Array.from(fileList);
    if (fileArray.length === 0) return;
    setUploading(true);
    try {
      const uploadedList: UploadedFile[] = [];
      for (const file of fileArray) {
        const uploaded = await uploadFormFile(file);
        uploadedList.push(uploaded);
      }
      onChange([...files, ...uploadedList]);
    } catch {
      toast.error("Could not upload image(s)");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {field.label || "Image"}
        {field.required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      <input
        type="file"
        multiple
        accept={field.accept || "image/*"}
        disabled={uploading}
        onChange={(e) => {
          if (e.target.files) {
            handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
        className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-foreground file:cursor-pointer hover:file:bg-muted"
      />
      {uploading && <p className="text-xs text-muted-foreground">Uploading image(s)…</p>}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {files.map((f, i) => (
            <div key={`${f.path}-${i}`} className="relative group rounded-md border p-1 bg-background">
              {previewUrls[f.path] ? (
                <img src={previewUrls[f.path]} alt={f.name} className="h-20 w-20 object-cover rounded" />
              ) : (
                <div className="h-20 w-20 flex items-center justify-center text-xs text-muted-foreground bg-muted rounded">
                  Image
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full p-0.5 shadow hover:bg-red-700"
                aria-label="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface UsersMultiSelectProps {
  users: HubUser[];
  value: string[];
  onChange: (v: string[]) => void;
}

function UsersMultiSelect({ users, value, onChange }: UsersMultiSelectProps) {
  const [open, setOpen] = useState(false);

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">No users available.</p>;
  }

  const toggle = (name: string) => {
    if (value.includes(name)) onChange(value.filter((n) => n !== name));
    else onChange([...value, name]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-auto min-h-10 py-1.5"
        >
          <div className="flex flex-wrap gap-1 items-center">
            {value.length === 0 ? (
              <span className="text-muted-foreground">Select users…</span>
            ) : (
              value.map((name) => (
                <Badge key={name} variant="secondary" className="gap-1">
                  {name}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(name);
                      }
                    }}
                    className="hover:text-destructive cursor-pointer inline-flex"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search users…" />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandGroup>
              {users.map((u) => {
                const selected = value.includes(u.name);
                return (
                  <CommandItem
                    key={u.id}
                    value={u.name}
                    onSelect={() => toggle(u.name)}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`}
                    />
                    {u.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface OptionsMultiSelectProps {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}

function OptionsMultiSelect({ options, value, onChange, placeholder }: OptionsMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter((n) => n !== opt));
    else onChange([...value, opt]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-auto min-h-10 py-1.5"
        >
          <div className="flex flex-wrap gap-1 items-center">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder ?? "Select…"}</span>
            ) : (
              value.map((opt) => (
                <Badge key={opt} variant="secondary" className="gap-1">
                  {opt}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(opt);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(opt);
                      }
                    }}
                    className="hover:text-destructive cursor-pointer inline-flex"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const selected = value.includes(opt);
                return (
                  <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)}>
                    <Check className={`mr-2 h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} />
                    {opt}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface PayrollsFieldProps {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}

function PayrollsField({ field, value, onChange }: PayrollsFieldProps) {
  const [options, setOptions] = useState<PayrollOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!field.sourceFormId) return;
    setLoading(true);
    fetchOpenPayrolls(field.sourceFormId, field.labelFieldId, field.statusFieldId)
      .then(setOptions)
      .finally(() => setLoading(false));
  }, [field.sourceFormId, field.labelFieldId, field.statusFieldId]);

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {field.label}
        {field.required && <span className="text-red-600 ml-0.5">*</span>}
      </Label>
      {!field.sourceFormId ? (
        <p className="text-xs text-muted-foreground">
          No payroll source form configured.
        </p>
      ) : loading ? (
        <p className="text-xs text-muted-foreground">Loading payrolls…</p>
      ) : options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No open payrolls available.</p>
      ) : (
        <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select a payroll…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.label}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
