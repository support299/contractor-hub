import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Clock,
  DollarSign,
  Phone,
  Star,
  TriangleAlert,
  UserPlus,
  Zap,
} from "lucide-react";
import { isAdminOnlyCreateSlug, slugify, type HubForm } from "@/lib/forms-store";

/**
 * Ordered Quick Entry shortcuts. Add, remove, rename, or reorder items here.
 *
 * Form shortcuts resolve at runtime: first matching slug, then a name hint.
 * `staffSlugs` is tried first for non-admins (e.g. request-time-off vs new-absence).
 */
export type QuickEntryShortcut = {
  id: string;
  title: string;
  icon: LucideIcon;
  kind: "form" | "new-user";
  slugs?: string[];
  staffSlugs?: string[];
  nameHints?: string[];
  adminOnly?: boolean;
  /** Prefill form fields by label after the form loads. */
  prefillByLabel?: Record<string, unknown>;
};

export const QUICK_ENTRY_SHORTCUTS: QuickEntryShortcut[] = [
  {
    id: "absence",
    title: "Absence",
    icon: Ban,
    kind: "form",
    slugs: ["new-absence"],
    staffSlugs: ["request-time-off"],
    nameHints: ["new absence", "absence"],
    prefillByLabel: { Type: "Absent" },
  },
  {
    id: "late-arrival",
    title: "Late Arrival",
    icon: Clock,
    kind: "form",
    slugs: ["new-absence"],
    nameHints: ["late arrival"],
    prefillByLabel: { Type: "Late" },
  },
  {
    id: "new-tip",
    title: "New Tip",
    icon: DollarSign,
    kind: "form",
    slugs: ["new-tips", "new-tip", "new_tips"],
    nameHints: ["new tip", "new tips"],
  },
  {
    id: "efficiency",
    title: "Efficiency",
    icon: Zap,
    kind: "form",
    slugs: ["new-efficiency"],
    nameHints: ["efficiency"],
    adminOnly: true,
  },
  {
    id: "complaint",
    title: "Complaint / Callback",
    icon: Phone,
    kind: "form",
    slugs: ["new-complaint", "complaint-callback", "callback"],
    nameHints: ["complaint", "callback"],
  },
  {
    id: "client-feedback",
    title: "Client Feedback",
    icon: Star,
    kind: "form",
    slugs: [
      "how-are-we-doing",
      "comment-tu-nous-trouve",
      "review-your-recent-experience",
      "evaluez-votre-experience",
      "client-feedback",
    ],
    nameHints: ["client feedback", "how are we doing"],
  },
  {
    id: "damaged-lost",
    title: "Damaged or Lost Item",
    icon: TriangleAlert,
    kind: "form",
    slugs: ["damaged-lost-form", "damaged-or-lost-item", "lost-item"],
    nameHints: ["damaged", "lost item"],
  },
  {
    id: "new-user",
    title: "New User",
    icon: UserPlus,
    kind: "new-user",
    adminOnly: true,
  },
];

export type ResolvedQuickEntry =
  | { kind: "form"; slug: string; form: HubForm }
  | { kind: "new-user" };

function formBySlug(forms: HubForm[], slug: string): HubForm | undefined {
  return forms.find((f) => f.slug === slug);
}

function formByNameHint(forms: HubForm[], hints: string[]): HubForm | undefined {
  for (const hint of hints) {
    const h = hint.trim().toLowerCase();
    if (!h) continue;
    const exact = forms.find((f) => f.name.trim().toLowerCase() === h);
    if (exact) return exact;
  }
  for (const hint of hints) {
    const h = hint.trim().toLowerCase();
    if (!h) continue;
    const slugHint = slugify(h);
    const partial = forms.find(
      (f) =>
        f.name.toLowerCase().includes(h) ||
        (slugHint.length >= 4 && f.slug.includes(slugHint)),
    );
    if (partial) return partial;
  }
  return undefined;
}

export function resolveQuickEntry(
  shortcut: QuickEntryShortcut,
  forms: HubForm[],
  isAdmin: boolean,
): ResolvedQuickEntry | null {
  if (shortcut.kind === "new-user") return isAdmin ? { kind: "new-user" } : null;

  const preferred = !isAdmin && shortcut.staffSlugs?.length ? shortcut.staffSlugs : shortcut.slugs ?? [];
  for (const slug of preferred) {
    const form = formBySlug(forms, slug);
    if (form) return { kind: "form", slug: form.slug, form };
  }
  if (!isAdmin && shortcut.slugs?.length) {
    for (const slug of shortcut.slugs) {
      const form = formBySlug(forms, slug);
      if (form && !isAdminOnlyCreateSlug(form.slug)) {
        return { kind: "form", slug: form.slug, form };
      }
    }
  }
  const hinted = formByNameHint(forms, shortcut.nameHints ?? []);
  if (hinted) return { kind: "form", slug: hinted.slug, form: hinted };
  return null;
}

export type VisibleQuickEntry = QuickEntryShortcut & {
  resolved: ResolvedQuickEntry | null;
};

export function visibleQuickEntryShortcuts(
  forms: HubForm[],
  isAdmin: boolean,
): VisibleQuickEntry[] {
  const out: VisibleQuickEntry[] = [];
  for (const s of QUICK_ENTRY_SHORTCUTS) {
    if (s.adminOnly && !isAdmin) continue;
    if (s.kind === "new-user") {
      if (isAdmin) out.push({ ...s, resolved: { kind: "new-user" } });
      continue;
    }
    const resolved = resolveQuickEntry(s, forms, isAdmin);
    if (resolved?.kind === "form" && !isAdmin && isAdminOnlyCreateSlug(resolved.slug)) {
      continue;
    }
    out.push({ ...s, resolved });
  }
  return out;
}
