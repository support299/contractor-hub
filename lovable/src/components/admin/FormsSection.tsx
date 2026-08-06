import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  addForm,
  deleteForm,
  updateForm,
  useForms,
  slugify,
  type HubForm,
} from "@/lib/forms-store";
import { ExternalLink, Eye, FileText, Inbox, Pencil, Plus, Search } from "lucide-react";
import { FormBuilderDialog } from "./FormBuilderDialog";
import { Link } from "@tanstack/react-router";

export function FormsSection() {
  const forms = useForms();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HubForm | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.slug.toLowerCase().includes(q),
    );
  }, [forms, query]);

  const openAdd = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (f: HubForm) => {
    setEditing(f);
    setOpen(true);
  };

  const handleSave = async (draft: {
    name: string;
    description: string;
    slug: string;
    status: "active" | "inactive";
    fields: HubForm["fields"];
  }) => {
    if (!draft.name.trim()) {
      toast.error("Form name is required");
      return;
    }
    const finalSlug = slugify(draft.slug || draft.name);
    if (!finalSlug) {
      toast.error("Slug is required");
      return;
    }
    const conflict = forms.find(
      (f) => f.slug === finalSlug && f.id !== editing?.id,
    );
    if (conflict) {
      toast.error("Slug already in use — pick another");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      slug: finalSlug,
      status: draft.status,
      fields: draft.fields,
    };
    try {
      if (editing) {
        await updateForm(editing.id, payload);
        toast.success("Form updated");
      } else {
        await addForm(payload);
        toast.success(`${payload.name} created`);
      }
      setOpen(false);
    } catch (err) {
      toast.error("Could not save form");
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm("Delete this form?")) return;
    try {
      await deleteForm(editing.id);
      toast.success("Form deleted");
      setOpen(false);
    } catch (err) {
      toast.error("Could not delete form");
      console.error(err);
    }
  };

  return (
    <section className="bg-card border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Forms ({forms.length})</h2>
          <p className="text-sm text-muted-foreground">
            Build and manage forms used across the hub.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search forms…"
              className="pl-8 w-56"
            />
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add form
          </Button>
        </div>
      </div>

      {forms.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No forms yet. Click “Add form” to create one.
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No forms match “{query}”.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Fields</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const url = `/forms/${f.slug}`;
                return (
                  <tr key={f.id} className="border-t align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">{f.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[280px]">
                      <div className="truncate">{f.description || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {f.fields?.length ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-700 hover:underline max-w-[220px]"
                      >
                        <span className="truncate">/forms/{f.slug}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          f.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {f.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 justify-end">
                        <Link
                          to="/admin/forms/$formId/submissions"
                          params={{ formId: f.id }}
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          aria-label="View submissions"
                          title="View submissions"
                        >
                          <Inbox className="h-4 w-4" />
                        </Link>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          aria-label="View form"
                          title="View form"
                        >
                          <Eye className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => openEdit(f)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Edit form"
                          title="Edit form"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <FormBuilderDialog
        open={open}
        onOpenChange={setOpen}
        initial={editing}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
      />
    </section>
  );
}
