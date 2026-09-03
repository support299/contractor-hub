import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useUsers, type HubUser } from "@/lib/hub-store";
import { Pencil, Plus, UserCircle2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertsManager } from "@/components/admin/AlertsManager";
import { FormsSection } from "@/components/admin/FormsSection";
import { UserFormDialog } from "@/components/UserFormDialog";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const users = useUsers();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HubUser | null>(null);

  const openAdd = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (u: HubUser) => {
    setEditing(u);
    setOpen(true);
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
              <p className="text-xs text-muted-foreground mt-1">
                Staff need a work email to use Set password at /set-password. Login column shows who
                has finished onboarding.
              </p>
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
                      <th className="px-4 py-3 font-medium">Login</th>
                      <th className="px-4 py-3 font-medium">Sector</th>
                      <th className="px-4 py-3 font-medium">Work days</th>
                      <th className="px-4 py-3 font-medium">Hire date</th>
                      <th className="px-4 py-3 font-medium">Vacation days</th>
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
                                : u.role === "display"
                                  ? "bg-amber-100 text-amber-800"
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
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              u.passwordConfigured
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {u.passwordConfigured ? "Ready" : "Needs set password"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {u.sectors && u.sectors.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                              {u.sectors.map((s) => (
                                <span
                                  key={s}
                                  className="inline-block px-2 py-0.5 rounded bg-muted text-xs"
                                >
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
                        <td className="px-4 py-3 text-muted-foreground">{u.hireDate || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {u.availableVacationDays != null ? u.availableVacationDays : "—"}
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

      <UserFormDialog open={open} onOpenChange={setOpen} user={editing} users={users} />
    </div>
  );
}
