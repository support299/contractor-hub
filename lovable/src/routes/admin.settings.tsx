import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addUser,
  deleteUser,
  
  POSITIONS,
  updateUser,
  useUsers,
  type HubUser,
  type Position,
  type Role,
  type UserStatus,
} from "@/lib/hub-store";
import { Pencil, Plus, Trash2, UserCircle2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertsManager } from "@/components/admin/AlertsManager";
import { FormsSection } from "@/components/admin/FormsSection";


export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
});

type FormState = {
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: UserStatus;
  sectors: string[];
  sectorInput: string;
  workDays: string;
  picture: string;
  position: string;
  jobberId: string;
  ghlId: string;
  regularRate: string;
  driveTimeRate: string;
  fcRate: string;
  trRate: string;
  suppliesDeduction: string;
};

const emptyForm: FormState = {
  name: "",
  email: "",
  phone: "",
  role: "employee",
  status: "active",
  sectors: [],
  sectorInput: "",
  workDays: "",
  picture: "",
  position: "",
  jobberId: "",
  ghlId: "",
  regularRate: "",
  driveTimeRate: "",
  fcRate: "",
  trRate: "",
  suppliesDeduction: "",
};

function AdminSettings() {
  const users = useUsers();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [sectorFocused, setSectorFocused] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const allSectors = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) for (const s of u.sectors ?? []) if (s?.trim()) set.add(s.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [users]);
  const sectorSuggestions = useMemo(() => {
    const q = form.sectorInput.trim().toLowerCase();
    return allSectors.filter(
      (s) => !form.sectors.includes(s) && (q === "" || s.toLowerCase().includes(q)),
    );
  }, [allSectors, form.sectorInput, form.sectors]);

  const addSector = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    setForm((f) =>
      f.sectors.includes(s) ? { ...f, sectorInput: "" } : { ...f, sectors: [...f.sectors, s], sectorInput: "" },
    );
  };
  const removeSector = (s: string) => {
    setForm((f) => ({ ...f, sectors: f.sectors.filter((x) => x !== s) }));
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (u: HubUser) => {
    setEditingId(u.id);
    setForm({
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      sectors: u.sectors ?? [],
      sectorInput: "",
      workDays: u.workDays != null ? String(u.workDays) : "",
      picture: u.picture ?? "",
      position: u.position ?? "",
      jobberId: u.jobberId ?? "",
      ghlId: u.ghlId ?? "",
      regularRate: u.regularRate != null ? String(u.regularRate) : "",
      driveTimeRate: u.driveTimeRate != null ? String(u.driveTimeRate) : "",
      fcRate: u.fcRate != null ? String(u.fcRate) : "",
      trRate: u.trRate != null ? String(u.trRate) : "",
      suppliesDeduction: u.suppliesDeduction != null ? String(u.suppliesDeduction) : "",
    });
    setOpen(true);
  };

  const handlePicture = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, picture: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const parseNum = (v: string) => (v.trim() ? Number(v) : undefined);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const sectors = [...form.sectors];
    if (form.sectorInput.trim() && !sectors.includes(form.sectorInput.trim())) {
      sectors.push(form.sectorInput.trim());
    }
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
      status: form.status,
      sectors,
      workDays: form.workDays.trim() ? Number(form.workDays) : undefined,
      picture: form.picture || undefined,
      position: (form.position || undefined) as Position | undefined,
      jobberId: form.jobberId.trim() || undefined,
      ghlId: form.ghlId.trim() || undefined,
      regularRate: parseNum(form.regularRate),
      driveTimeRate: parseNum(form.driveTimeRate),
      fcRate: parseNum(form.fcRate),
      trRate: parseNum(form.trRate),
      suppliesDeduction: parseNum(form.suppliesDeduction),
    };
    const dup = users.find(
      (u) =>
        u.id !== editingId &&
        ((payload.email && u.email.toLowerCase() === payload.email.toLowerCase()) ||
          (payload.phone && u.phone.replace(/\s+/g, "") === payload.phone.replace(/\s+/g, ""))),
    );
    if (dup) {
      toast.error("A user with that email or phone already exists");
      return;
    }
    try {
      if (editingId) {
        await updateUser(editingId, payload);
        toast.success("User updated");
      } else {
        await addUser(payload);
        toast.success(`${payload.name} added`);
      }
      setOpen(false);
    } catch (err) {
      toast.error("Could not save user");
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!confirm("Delete this user? This will remove all their data.")) return;
    try {
      await deleteUser(editingId);
      toast.success("User deleted");
      setOpen(false);
    } catch (err) {
      toast.error("Could not delete user");
      console.error(err);
    }
  };



  return (
    <div className="space-y-8">
      <Toaster />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage users and hub alerts.</p>
        </div>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="forms">Forms</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add new user
            </Button>
          </div>

          <section className="bg-card border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="font-semibold">Users ({users.length})</h2>
            </div>
        {users.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            No users yet. Click “Add new user” to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Sector</th>
                  <th className="px-4 py-3 font-medium">Work days</th>
                  <th className="px-4 py-3 font-medium">Position</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {u.picture ? (
                          <img
                            src={u.picture}
                            alt={u.name}
                            className="h-9 w-9 rounded-full object-cover"
                          />
                        ) : (
                          <UserCircle2 className="h-9 w-9 text-muted-foreground" />
                        )}
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.phone}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : u.role === "employee"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {u.status === "active" ? "Active" : "Not active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.sectors && u.sectors.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {u.sectors.map((s) => (
                            <span key={s} className="inline-block px-2 py-0.5 rounded bg-muted text-xs">
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.workDays != null ? u.workDays : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.position || "—"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Edit user"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </TabsContent>

        <TabsContent value="forms" className="mt-4">
          <FormsSection />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <AlertsManager />
        </TabsContent>
      </Tabs>



      

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit user" : "Add new user"}</DialogTitle>
            <DialogDescription>
              All fields except name are optional. Inactive users cannot log in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="flex items-center gap-4">
              {form.picture ? (
                <img
                  src={form.picture}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover border"
                />
              ) : (
                <UserCircle2 className="h-16 w-16 text-muted-foreground" />
              )}
              <div className="space-x-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePicture(f);
                  }}
                />
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                  {form.picture ? "Change picture" : "Upload picture"}
                </Button>
                {form.picture && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setForm((f) => ({ ...f, picture: "" }))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as Role })}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 555 555 5555"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as UserStatus })}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Not active</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 relative md:col-span-2">
                <Label htmlFor="sector">Sectors</Label>
                <div className="flex flex-wrap items-center gap-1 border rounded-md px-2 py-1.5 min-h-10 bg-background">
                  {form.sectors.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSector(s)}
                        className="hover:text-emerald-950"
                        aria-label={`Remove ${s}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="sector"
                    className="flex-1 min-w-[120px] bg-transparent outline-none text-sm px-1 py-1"
                    value={form.sectorInput}
                    onChange={(e) => setForm({ ...form, sectorInput: e.target.value })}
                    onFocus={() => setSectorFocused(true)}
                    onBlur={() => setTimeout(() => setSectorFocused(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addSector(form.sectorInput);
                      } else if (e.key === "Backspace" && !form.sectorInput && form.sectors.length) {
                        removeSector(form.sectors[form.sectors.length - 1]);
                      }
                    }}
                    placeholder={form.sectors.length ? "" : "Type and press Enter"}
                    autoComplete="off"
                  />
                </div>
                {sectorFocused && sectorSuggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                    {sectorSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addSector(s);
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="workDays">Work days (per week)</Label>
                <Input
                  id="workDays"
                  type="number"
                  min={0}
                  max={7}
                  value={form.workDays}
                  onChange={(e) => setForm({ ...form, workDays: e.target.value })}
                  placeholder="5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="position">Position</Label>
                <Select
                  value={form.position || "__none"}
                  onValueChange={(v) =>
                    setForm({ ...form, position: v === "__none" ? "" : v })
                  }
                >
                  <SelectTrigger id="position">
                    <SelectValue placeholder="Select a position" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {POSITIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="jobberId">Jobber ID</Label>
                <Input
                  id="jobberId"
                  value={form.jobberId}
                  onChange={(e) => setForm({ ...form, jobberId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ghlId">GHL ID</Label>
                <Input
                  id="ghlId"
                  value={form.ghlId}
                  onChange={(e) => setForm({ ...form, ghlId: e.target.value })}
                />
              </div>
              {([
                ["regularRate", "Regular Rate"],
                ["driveTimeRate", "Drive Time Rate"],
                ["fcRate", "FC Rate"],
                ["trRate", "TR Rate"],
                ["suppliesDeduction", "Supplies Deduction"],
              ] as const).map(([key, label]) => (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={key}>{label}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
                    <Input
                      id={key}
                      type="number"
                      step="0.01"
                      min={0}
                      className="pl-7"
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              {editingId && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  className="mr-auto"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingId ? "Save changes" : "Add user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
