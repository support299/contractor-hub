import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  FileText,
  Film,
  Folder,
  FolderPlus,
  Plus,
  Trash2,
  ExternalLink,
  Upload,
  Pencil,
  Download,
  Play,
  Eye,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { isAdminSession } from "@/lib/api";
import { POSITIONS, useSession } from "@/lib/hub-store";
import {
  createDocument,
  createFolder,
  createTraining,
  deleteDocument,
  deleteFolder,
  deleteMedia,
  deleteTraining,
  fetchDocuments,
  fetchFolders,
  fetchTraining,
  getMediaUrl,
  mediaContentUrl,
  canInlinePreviewPdf,
  isPdfFile,
  updateDocument,
  updateFolder,
  updateTraining,
  uploadDocumentFile,
  type DocumentItem,
  type ResourceFolder,
  type TrainingMaterial,
} from "@/lib/resources-store";

const PdfDocumentViewer = lazy(() =>
  import("@/components/PdfDocumentViewer").then((m) => ({ default: m.PdfDocumentViewer })),
);

function getVideoThumbnail(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
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
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return ext.toUpperCase();
    return ext.toUpperCase();
  }
  if (mime) return mime.split("/").pop()!.toUpperCase();
  return "File";
}

type TabKey = "training" | "documents";

import { useDocumentTitle } from "@/hooks/use-document-title";

export default function ResourcesPage() {
  useDocumentTitle("Resources");
  const [tab, setTab] = useState<TabKey>("training");
  const session = useSession();
  const canManage = isAdminSession(session);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Resources</h1>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Organize training and documents in folders. Control which staff positions can see each item, and whether documents may be downloaded or copied."
            : "Browse training and documents available for your team position."}
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
      {tab === "training" ? (
        <TrainingTab canManage={canManage} />
      ) : (
        <DocumentsTab canManage={canManage} />
      )}
    </div>
  );
}

function PositionPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (p: string) => {
    if (value.includes(p)) onChange(value.filter((x) => x !== p));
    else onChange([...value, p]);
  };
  return (
    <div className="space-y-2">
      <Label>Visible to positions</Label>
      <p className="text-xs text-muted-foreground">
        Leave all unchecked to show to every position.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
        {POSITIONS.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={value.includes(p)} onCheckedChange={() => toggle(p)} />
            {p}
          </label>
        ))}
      </div>
    </div>
  );
}

function FolderSidebar({
  kind,
  folders,
  selectedId,
  onSelect,
  onChanged,
  canManage,
}: {
  kind: "training" | "documents";
  folders: ResourceFolder[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceFolder | null>(null);
  const [name, setName] = useState("");

  const startAdd = () => {
    setEditing(null);
    setName("");
    setOpen(true);
  };
  const startEdit = (f: ResourceFolder) => {
    setEditing(f);
    setName(f.name);
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Folder name required");
    try {
      if (editing) {
        await updateFolder(editing.id, { name: name.trim() });
        toast.success("Folder updated");
      } else {
        await createFolder({ name: name.trim(), kind, sort_order: folders.length });
        toast.success("Folder created");
      }
      setOpen(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save folder");
    }
  };

  const remove = async (f: ResourceFolder) => {
    if (!confirm(`Delete folder "${f.name}"? Items inside become uncategorized.`)) return;
    try {
      await deleteFolder(f.id);
      if (selectedId === f.id) onSelect(null);
      toast.success("Folder deleted");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete folder");
    }
  };

  return (
    <aside className="w-full md:w-56 shrink-0 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Folders</h2>
        {canManage ? (
          <Button size="icon" variant="ghost" onClick={startAdd} title="New folder">
            <FolderPlus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left ${
          selectedId === null ? "bg-emerald-100 text-emerald-800" : "hover:bg-muted"
        }`}
      >
        <Folder className="h-4 w-4" />
        All
      </button>
      {folders.map((f) => (
        <div
          key={f.id}
          className={`group flex items-center gap-1 rounded-lg ${
            selectedId === f.id ? "bg-emerald-100 text-emerald-800" : "hover:bg-muted"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(f.id)}
            className="flex-1 flex items-center gap-2 px-3 py-2 text-sm text-left min-w-0"
          >
            <Folder className="h-4 w-4 shrink-0" />
            <span className="truncate">{f.name}</span>
          </button>
          {canManage ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 opacity-0 group-hover:opacity-100"
                onClick={() => startEdit(f)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 opacity-0 group-hover:opacity-100"
                onClick={() => remove(f)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      ))}

      {canManage ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Rename folder" : "New folder"}</DialogTitle>
            </DialogHeader>
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Onboarding" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </aside>
  );
}

/* ---------------- Training ---------------- */

function TrainingTab({ canManage }: { canManage: boolean }) {
  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [items, setItems] = useState<TrainingMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingMaterial | null>(null);

  const loadFolders = async () => {
    try {
      setFolders(await fetchFolders("training"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load folders");
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      setItems(await fetchTraining());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load training");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFolders();
    load();
  }, []);

  const visible = useMemo(
    () => (folderId ? items.filter((i) => i.folder_id === folderId) : items),
    [items, folderId],
  );

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this training material?")) return;
    try {
      await deleteTraining(id);
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <FolderSidebar
        kind="training"
        folders={folders}
        selectedId={folderId}
        onSelect={setFolderId}
        onChanged={loadFolders}
        canManage={canManage}
      />
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            {folderId
              ? folders.find((f) => f.id === folderId)?.name ?? "Folder"
              : "All training"}
            <ChevronRight className="h-3 w-3" />
            {visible.length} item(s)
          </p>
          {canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add Training
            </Button>
          ) : null}
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-muted-foreground">
            No training materials in this folder yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((m) => {
              const thumb = getVideoThumbnail(m.video_url);
              return (
                <div key={m.id} className="border rounded-lg bg-card overflow-hidden flex flex-col">
                  <button
                    type="button"
                    onClick={() =>
                      m.video_url && window.open(m.video_url, "_blank", "noopener,noreferrer")
                    }
                    className="relative aspect-video bg-muted flex items-center justify-center group overflow-hidden"
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={m.title}
                        className="absolute inset-0 w-full h-full object-cover"
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
                  <div className="p-4 flex-1 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold leading-tight">{m.title}</h3>
                      {canManage ? (
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
                      ) : null}
                    </div>
                    {(m.folder_name || m.category) && (
                      <span className="self-start text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        {m.folder_name || m.category}
                      </span>
                    )}
                    {canManage && m.visible_positions?.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Positions: {m.visible_positions.join(", ")}
                      </p>
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
              );
            })}
          </div>
        )}
      </div>
      {canManage ? (
        <TrainingDialog
          open={open}
          onOpenChange={setOpen}
          editing={editing}
          folders={folders}
          defaultFolderId={folderId}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function TrainingDialog({
  open,
  onOpenChange,
  editing,
  folders,
  defaultFolderId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: TrainingMaterial | null;
  folders: ResourceFolder[];
  defaultFolderId: string | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setFolderId(editing?.folder_id ?? defaultFolderId ?? "");
      setDescription(editing?.description ?? "");
      setVideoUrl(editing?.video_url ?? "");
      setPositions(editing?.visible_positions ?? []);
    }
  }, [open, editing, defaultFolderId]);

  const handleSave = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setSaving(true);
    const payload = {
      title: title.trim(),
      folder_id: folderId || null,
      description,
      video_url: videoUrl.trim(),
      visible_positions: positions,
    };
    try {
      if (editing) await updateTraining(editing.id, payload);
      else await createTraining(payload);
      toast.success(editing ? "Updated" : "Created");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Training" : "Add Training"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Folder</Label>
            <Select
              value={folderId || "__none__"}
              onValueChange={(v) => setFolderId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No folder</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PositionPicker value={positions} onChange={setPositions} />
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
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

function DocumentsTab({ canManage }: { canManage: boolean }) {
  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [viewer, setViewer] = useState<DocumentItem | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const loadFolders = async () => {
    try {
      setFolders(await fetchFolders("documents"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load folders");
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      setItems(await fetchDocuments());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFolders();
    load();
  }, []);

  const visible = useMemo(
    () => (folderId ? items.filter((i) => i.folder_id === folderId) : items),
    [items, folderId],
  );

  const handleDelete = async (item: DocumentItem) => {
    if (!confirm("Delete this document?")) return;
    try {
      if (item.file_path) await deleteMedia(item.file_path);
      await deleteDocument(item.id);
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const openViewer = async (item: DocumentItem) => {
    if (!item.file_path) return;
    // Small PDFs: same-origin stream for pdf.js. Large PDFs / images: signed URL
    // (large files skip in-app preview to avoid OOM; open in new tab instead).
    if (canInlinePreviewPdf(item)) {
      setViewer(item);
      setViewerUrl(mediaContentUrl(item.file_path));
      return;
    }
    setViewer(item);
    setViewerUrl(null);
    const url = await getMediaUrl(item.file_path);
    if (!url) {
      toast.error("Unable to open");
      setViewer(null);
      return;
    }
    setViewerUrl(url);
  };

  const downloadDoc = async (item: DocumentItem) => {
    if (!item.allow_download) {
      toast.error("Download is disabled for this document");
      return;
    }
    if (!item.file_path) return;
    const url = await getMediaUrl(item.file_path);
    if (!url) return toast.error("Unable to download");
    const a = document.createElement("a");
    a.href = url;
    a.download = item.file_name || item.title;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <FolderSidebar
        kind="documents"
        folders={folders}
        selectedId={folderId}
        onSelect={setFolderId}
        onChanged={loadFolders}
        canManage={canManage}
      />
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {folderId
              ? folders.find((f) => f.id === folderId)?.name ?? "Folder"
              : "All documents"}{" "}
            · {visible.length} item(s)
          </p>
          {canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add Document
            </Button>
          ) : null}
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-muted-foreground">
            No documents in this folder yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visible.map((d) => {
              const typeLabel = fileTypeLabel(d.file_name, d.file_type);
              const sizeLabel = formatFileSize(d.file_size);
              return (
                <div
                  key={d.id}
                  className="group border rounded-xl bg-card hover:bg-muted/40 hover:border-emerald-500 transition flex items-center gap-4 p-4"
                >
                  <button
                    type="button"
                    className="h-12 w-12 shrink-0 rounded-lg bg-emerald-100 flex items-center justify-center"
                    onClick={() => openViewer(d)}
                    title="View"
                  >
                    <FileText className="h-6 w-6 text-emerald-600" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold leading-tight truncate">{d.title}</h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {[typeLabel, sizeLabel].filter(Boolean).join(" • ") || d.file_name || "—"}
                    </p>
                    {(d.folder_name || d.category) && (
                      <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        {d.folder_name || d.category}
                      </span>
                    )}
                    {canManage ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {!d.allow_download && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            No download
                          </span>
                        )}
                        {!d.allow_copy && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            Copy protected
                          </span>
                        )}
                      </div>
                    ) : null}
                    {canManage && d.visible_positions?.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        Positions: {d.visible_positions.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => openViewer(d)} title="View">
                      <Eye className="h-4 w-4" />
                    </Button>
                    {d.allow_download && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => downloadDoc(d)}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    {canManage ? (
                      <>
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
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canManage ? (
        <DocumentDialog
          open={open}
          onOpenChange={setOpen}
          editing={editing}
          folders={folders}
          defaultFolderId={folderId}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      ) : null}

      <DocumentViewerDialog
        item={viewer}
        url={viewerUrl}
        onClose={() => {
          setViewer(null);
          setViewerUrl(null);
        }}
        onDownload={() => viewer && downloadDoc(viewer)}
      />
    </div>
  );
}

function DocumentViewerDialog({
  item,
  url,
  onClose,
  onDownload,
}: {
  item: DocumentItem | null;
  url: string | null;
  onClose: () => void;
  onDownload: () => void;
}) {
  const allowCopy = item?.allow_copy ?? false;
  const allowDownload = item?.allow_download ?? false;
  const isPdf = item ? isPdfFile(item) : false;
  const inlinePdf = item ? canInlinePreviewPdf(item) : false;
  const isImage = (item?.file_type || "").startsWith("image/");
  const sizeLabel = item ? formatFileSize(item.file_size) : "";

  const openExternal = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="pr-8">{item?.title ?? "Document"}</DialogTitle>
        </DialogHeader>
        <div
          className={`flex-1 min-h-0 rounded-md border bg-muted/30 overflow-hidden ${
            allowCopy ? "select-text" : "select-none"
          }`}
          onContextMenu={(e) => {
            if (!allowCopy) e.preventDefault();
          }}
          onCopy={(e) => {
            if (!allowCopy) e.preventDefault();
          }}
          onCut={(e) => {
            if (!allowCopy) e.preventDefault();
          }}
        >
          {!item ? null : isPdf && !inlinePdf ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Preview unavailable for large PDFs</p>
                <p className="text-sm text-muted-foreground max-w-md">
                  This file{sizeLabel ? ` (${sizeLabel})` : ""} is too large for in-app preview.
                  Open it in a new tab to view.
                </p>
              </div>
              <Button onClick={openExternal} disabled={!url}>
                <ExternalLink className="h-4 w-4" />
                {url ? "Open in new tab" : "Preparing link…"}
              </Button>
            </div>
          ) : !url ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : inlinePdf ? (
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Loading PDF viewer…
                </div>
              }
            >
              <PdfDocumentViewer url={url} title={item?.title} allowCopy={allowCopy} />
            </Suspense>
          ) : isImage ? (
            <div className="h-full flex items-center justify-center p-4">
              <img
                src={url}
                alt={item?.title}
                className="max-h-full max-w-full object-contain"
                draggable={allowDownload || allowCopy}
              />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Preview not available for this file type.
                {allowDownload
                  ? " Use Download to open it."
                  : " Download is disabled for this document."}
              </p>
              {url ? (
                <Button variant="outline" onClick={openExternal}>
                  <ExternalLink className="h-4 w-4" />
                  Open in new tab
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {isPdf && !inlinePdf && url ? (
            <Button variant="secondary" onClick={openExternal}>
              <ExternalLink className="h-4 w-4" />
              Open in new tab
            </Button>
          ) : null}
          {allowDownload && (
            <Button onClick={onDownload}>
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDialog({
  open,
  onOpenChange,
  editing,
  folders,
  defaultFolderId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: DocumentItem | null;
  folders: ResourceFolder[];
  defaultFolderId: string | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState("");
  const [description, setDescription] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowCopy, setAllowCopy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setFolderId(editing?.folder_id ?? defaultFolderId ?? "");
      setDescription(editing?.description ?? "");
      setPositions(editing?.visible_positions ?? []);
      setAllowDownload(editing?.allow_download ?? true);
      setAllowCopy(editing?.allow_copy ?? false);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, editing, defaultFolderId]);

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
        if (editing?.file_path) await deleteMedia(editing.file_path);
        const uploaded = await uploadDocumentFile(file);
        filePath = uploaded.path;
        fileName = uploaded.name;
        fileType = uploaded.type;
        fileSize = uploaded.size;
      }
      const payload = {
        title: title.trim(),
        folder_id: folderId || null,
        description,
        file_path: filePath,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        visible_positions: positions,
        allow_download: allowDownload,
        allow_copy: allowCopy,
      };
      if (editing) await updateDocument(editing.id, payload);
      else await createDocument(payload);
      toast.success(editing ? "Updated" : "Created");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Document" : "Add Document"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Folder</Label>
            <Select
              value={folderId || "__none__"}
              onValueChange={(v) => setFolderId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No folder</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PositionPicker value={positions} onChange={setPositions} />
          <div className="flex flex-col gap-2 border rounded-md p-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={allowDownload}
                onCheckedChange={(v) => setAllowDownload(v === true)}
              />
              Allow download
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={allowCopy} onCheckedChange={(v) => setAllowCopy(v === true)} />
              Allow copy / select text in viewer
            </label>
            <p className="text-xs text-muted-foreground">
              For PDFs with selectable text: when off, the viewer blocks select/copy/right-click
              (soft deterrent, not DRM). Scanned image PDFs have no text to copy either way.
            </p>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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
              <p className="text-xs text-muted-foreground mt-1">Current: {editing.file_name}</p>
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
