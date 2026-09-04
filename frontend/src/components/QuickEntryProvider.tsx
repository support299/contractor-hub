import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormSubmitDialog } from "@/components/FormSubmitDialog";
import { UserFormDialog } from "@/components/UserFormDialog";
import { isAdminSession } from "@/lib/api";
import { useForms } from "@/lib/forms-store";
import { useSession, useUsers } from "@/lib/hub-store";
import {
  visibleQuickEntryShortcuts,
  type VisibleQuickEntry,
} from "@/lib/quick-entry";

type FormLaunch = {
  slug: string;
  title: string;
  prefillByLabel?: Record<string, unknown>;
};

type QuickEntryContextValue = {
  items: VisibleQuickEntry[];
  launch: (item: VisibleQuickEntry) => void;
};

const QuickEntryContext = createContext<QuickEntryContextValue | null>(null);

export function useQuickEntry() {
  const ctx = useContext(QuickEntryContext);
  if (!ctx) throw new Error("useQuickEntry must be used within QuickEntryProvider");
  return ctx;
}

export function QuickEntryProvider({ children }: { children: ReactNode }) {
  const forms = useForms();
  const users = useUsers();
  const session = useSession();
  const admin = isAdminSession(session);
  const items = useMemo(() => visibleQuickEntryShortcuts(forms, admin), [forms, admin]);

  const [formLaunch, setFormLaunch] = useState<FormLaunch | null>(null);
  const [userOpen, setUserOpen] = useState(false);

  const launch = useCallback(
    (item: VisibleQuickEntry) => {
      if (item.kind === "new-user") {
        setUserOpen(true);
        return;
      }
      if (!item.resolved || item.resolved.kind !== "form") {
        toast.error(
          `No matching form for “${item.title}”. Check the form name or slug in Settings → Forms.`,
        );
        return;
      }
      setFormLaunch({
        slug: item.resolved.slug,
        title: item.title,
        prefillByLabel: item.prefillByLabel,
      });
    },
    [],
  );

  const value = useMemo(() => ({ items, launch }), [items, launch]);

  return (
    <QuickEntryContext.Provider value={value}>
      {children}
      {formLaunch ? (
        <FormSubmitDialog
          key={`${formLaunch.slug}:${formLaunch.title}`}
          slug={formLaunch.slug}
          title={formLaunch.title}
          prefillByLabel={formLaunch.prefillByLabel}
          open
          onOpenChange={(o) => {
            if (!o) setFormLaunch(null);
          }}
        />
      ) : null}
      <UserFormDialog open={userOpen} onOpenChange={setUserOpen} users={users} />
    </QuickEntryContext.Provider>
  );
}

export function QuickEntryHeaderButton() {
  const { items, launch } = useQuickEntry();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="px-2 sm:px-3 shrink-0" aria-label="Quick Entry">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Quick Entry</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {items.map((item) => {
          const Icon = item.icon;
          const missing = item.kind === "form" && !item.resolved;
          return (
            <DropdownMenuItem
              key={item.id}
              className="cursor-pointer"
              disabled={missing}
              onSelect={() => {
                if (!missing) launch(item);
              }}
            >
              <Icon className="h-4 w-4" />
              {item.title}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
