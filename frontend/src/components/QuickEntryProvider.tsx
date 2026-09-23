import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { useForms, type HubForm } from "@/lib/forms-store";
import { useSession } from "@/lib/hub-store";
import {
  visibleQuickEntryShortcuts,
  type VisibleQuickEntry,
} from "@/lib/quick-entry";

type FormLaunch = {
  slug: string;
  title: string;
  prefillByLabel?: Record<string, unknown>;
  form?: HubForm;
};

type QuickEntryContextValue = {
  items: VisibleQuickEntry[];
  launch: (item: VisibleQuickEntry, opts?: { defer?: boolean }) => void;
};

const QuickEntryContext = createContext<QuickEntryContextValue | null>(null);

export function useQuickEntry() {
  const ctx = useContext(QuickEntryContext);
  if (!ctx) throw new Error("useQuickEntry must be used within QuickEntryProvider");
  return ctx;
}

export function QuickEntryProvider({ children }: { children: ReactNode }) {
  const forms = useForms();
  const session = useSession();
  const admin = isAdminSession(session);
  const items = useMemo(() => visibleQuickEntryShortcuts(forms, admin), [forms, admin]);

  const [formLaunch, setFormLaunch] = useState<FormLaunch | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const launchTimer = useRef<number | null>(null);

  const launchNow = useCallback((item: VisibleQuickEntry) => {
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
      form: item.resolved.form,
    });
  }, []);

  const launch = useCallback(
    (item: VisibleQuickEntry, opts?: { defer?: boolean }) => {
      if (launchTimer.current) {
        window.clearTimeout(launchTimer.current);
        launchTimer.current = null;
      }
      if (opts?.defer) {
        // Let Radix close the dropdown and release pointer-lock before the dialog opens.
        // Same click otherwise dismisses the dialog immediately.
        launchTimer.current = window.setTimeout(() => {
          launchTimer.current = null;
          launchNow(item);
        }, 80);
        return;
      }
      launchNow(item);
    },
    [launchNow],
  );

  useEffect(
    () => () => {
      if (launchTimer.current) window.clearTimeout(launchTimer.current);
    },
    [],
  );

  const value = useMemo(() => ({ items, launch }), [items, launch]);

  return (
    <QuickEntryContext.Provider value={value}>
      {children}
      <FormSubmitDialog
        key={formLaunch ? `${formLaunch.slug}:${formLaunch.title}` : "quick-entry-form"}
        slug={formLaunch?.slug ?? ""}
        title={formLaunch?.title}
        prefillByLabel={formLaunch?.prefillByLabel}
        initialForm={formLaunch?.form ?? null}
        open={!!formLaunch}
        onOpenChange={(o) => {
          if (!o) setFormLaunch(null);
        }}
      />
      <UserFormDialog open={userOpen} onOpenChange={setUserOpen} />
    </QuickEntryContext.Provider>
  );
}

export function QuickEntryHeaderButton() {
  const { items, launch } = useQuickEntry();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="px-2 sm:px-3 shrink-0" aria-label="Quick Entry">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Quick Entry</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const missing = item.kind === "form" && !item.resolved;
          return (
            <DropdownMenuItem
              key={item.id}
              className="cursor-pointer"
              disabled={missing}
              onSelect={() => {
                if (!missing) launch(item, { defer: true });
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
