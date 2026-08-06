import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  Film,
  Plus,
  Trash2,
  ExternalLink,
  Upload,
  Pencil,
  Download,
  Play,
} from "lucide-react";
import { toast } from "sonner";



function getVideoThumbnail(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // YouTube
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://img.youtube.com/vi/${v}/hqdefault.jpg`;
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "v");
      if (idx >= 0 && parts[idx + 1])
        return `https://img.youtube.com/vi/${parts[idx + 1]}/hqdefault.jpg`;
    }
    // Vimeo (use vumbnail.com — no API key required)
    if (host.endsWith("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id && /^\d+$/.test(id)) return `https://vumbnail.com/${id}.jpg`;
    }
  } catch {
    return null;
  }
  return null;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function fileTypeLabel(name: string, mime: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ext) {
    if (ext === "pdf") return "PDF";
    if (["doc", "docx"].includes(ext)) return "Doc";
    if (["xls", "xlsx", "csv"].includes(ext)) return "Excel";
    if (["ppt", "pptx"].includes(ext)) return "Slides";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext))
      return ext.toUpperCase();
    return ext.toUpperCase();
  }
  if (mime) return mime.split("/").pop()!.toUpperCase();
  return "File";
}

export const Route = createFileRoute("/admin/resources")({
  head: () => ({ meta: [{ title: "Resources — Admin" }] }),
  component: ResourcesPage,
});

interface TrainingMaterial {
  id: string;
  title: string;
  category: string;
  description: string;
  video_url: string;
  created_at: string;
}

interface DocumentItem {
  id: string;
  title: string;
  category: string;
  description: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

type TabKey = "training" | "documents";

function ResourcesPage() {
  const [tab, setTab] = useState<TabKey>("training");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Resources</h1>
        <p className="text-sm text-muted-foreground">
          Manage training materials and documents.
        </p>
      </div>
      <div className="flex gap-2 border-b">
        {(
          [
            { key: "training", label: "Training" },
            { key: "documents", label: "Documents" },
          ] as { key: TabKey; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === t.key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "training" ? <TrainingTab /> : <DocumentsTab />}
    </div>
  );
}


/* ---------------- Training ---------------- */

function TrainingTab() {
  const [items, setItems] = useState<TrainingMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingMaterial | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("hub_training_materials")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setItems((data ?? []) as TrainingMaterial[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this training material?")) return;
    const { error } = await supabase.from("hub_training_materials").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add Training Material
        </Button>
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          No training materials yet. Click "Add Training Material" to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((m) => (
            <div
              key={m.id}
              className="border rounded-lg bg-card overflow-hidden flex flex-col"
            >
              {(() => {
                const thumb = getVideoThumbnail(m.video_url);
                return (
                  <button
                    type="button"
                    onClick={() =>
                      m.video_url &&
                      window.open(m.video_url, "_blank", "noopener,noreferrer")
                    }
                    className="relative aspect-video bg-muted flex items-center justify-center group overflow-hidden"
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={m.title}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Film className="h-10 w-10 text-muted-foreground" />
                    )}
                    {m.video_url && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition">
                        <div className="h-12 w-12 rounded-full bg-white/90 flex items-center justify-center">
                          <Play className="h-6 w-6 text-emerald-700 fill-emerald-700" />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })()}
              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{m.title}</h3>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setEditing(m);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {m.category && (
                  <span className="self-start text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                    {m.category}
                  </span>
                )}
                {m.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                    {m.description}
                  </p>
                )}
                <div className="mt-auto pt-2">
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!m.video_url}
                    onClick={() => window.open(m.video_url, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Watch Video
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <TrainingDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </div>
  );
}

function TrainingDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: TrainingMaterial | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setCategory(editing?.category ?? "");
      setDescription(editing?.description ?? "");
      setVideoUrl(editing?.video_url ?? "");
    }
  }, [open, editing]);

  const handleSave = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setSaving(true);
    const payload = {
      title: title.trim(),
      category: category.trim(),
      description,
      video_url: videoUrl.trim(),
    };
    const { error } = editing
      ? await supabase.from("hub_training_materials").update(payload).eq("id", editing.id)
      : await supabase.from("hub_training_materials").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Updated" : "Created");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit Training Material" : "Add Training Material"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Onboarding, Safety"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <div>
            <Label>Video Link</Label>
            <Input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Documents ---------------- */

function DocumentsTab() {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentItem | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("hub_documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setItems((data ?? []) as DocumentItem[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (item: DocumentItem) => {
    if (!confirm("Delete this document?")) return;
    if (item.file_path) {
      await supabase.storage.from("hub-documents").remove([item.file_path]);
    }
    const { error } = await supabase.from("hub_documents").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const handleOpen = async (item: DocumentItem) => {
    if (!item.file_path) return;
    const { data, error } = await supabase.storage
      .from("hub-documents")
      .createSignedUrl(item.file_path, 60 * 60);
    if (error || !data?.signedUrl) return toast.error(error?.message ?? "Unable to open");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add Document
        </Button>
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          No documents yet. Click "Add Document" to upload one.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((d) => {
            const typeLabel = fileTypeLabel(d.file_name, d.file_type);
            const sizeLabel = formatFileSize(d.file_size);
            return (
              <div
                key={d.id}
                className="group border rounded-xl bg-card hover:bg-muted/40 hover:border-emerald-500 transition flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => handleOpen(d)}
              >
                <div className="h-12 w-12 shrink-0 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold leading-tight truncate">{d.title}</h3>
                  <p className="text-sm text-muted-foreground truncate">
                    {[typeLabel, sizeLabel].filter(Boolean).join(" • ") ||
                      d.file_name ||
                      "—"}
                  </p>
                  {d.category && (
                    <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      {d.category}
                    </span>
                  )}
                  {d.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap mt-1">
                      {d.description}
                    </p>
                  )}
                </div>
                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditing(d);
                      setOpen(true);
                    }}
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(d)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleOpen(d)}
                    title="Open"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DocumentDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </div>
  );
}

function DocumentDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: DocumentItem | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setCategory(editing?.category ?? "");
      setDescription(editing?.description ?? "");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, editing]);

  const handleSave = async () => {
    if (!title.trim()) return toast.error("Title is required");
    if (!editing && !file) return toast.error("Please choose a file");
    setSaving(true);
    try {
      let filePath = editing?.file_path ?? "";
      let fileName = editing?.file_name ?? "";
      let fileType = editing?.file_type ?? "";
      let fileSize = editing?.file_size ?? 0;
      if (file) {
        if (editing?.file_path) {
          await supabase.storage.from("hub-documents").remove([editing.file_path]);
        }
        const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
        const path = `${crypto.randomUUID()}${ext ? "." + ext : ""}`;
        const { error: upErr } = await supabase.storage
          .from("hub-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        filePath = path;
        fileName = file.name;
        fileType = file.type;
        fileSize = file.size;
      }
      const payload = {
        title: title.trim(),
        category: category.trim(),
        description,
        file_path: filePath,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
      };
      const { error } = editing
        ? await supabase.from("hub_documents").update(payload).eq("id", editing.id)
        : await supabase.from("hub_documents").insert(payload);
      if (error) throw error;
      toast.success(editing ? "Updated" : "Created");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Document" : "Add Document"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Policies, Manuals"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <div>
            <Label>File {editing ? "(leave empty to keep current)" : ""}</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Upload className="h-4 w-4 text-muted-foreground" />
            </div>
            {editing?.file_name && !file && (
              <p className="text-xs text-muted-foreground mt-1">
                Current: {editing.file_name}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
