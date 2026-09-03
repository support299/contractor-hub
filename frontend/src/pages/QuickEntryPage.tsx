import { useQuickEntry } from "@/components/QuickEntryProvider";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function QuickEntryPage() {
  useDocumentTitle("Quick Entry");
  const { items, launch } = useQuickEntry();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quick Entry</h1>
        <p className="text-sm text-muted-foreground">
          Open a common form in one click. Same shortcuts live in the header.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          const missing = item.kind === "form" && !item.resolved;
          return (
            <button
              key={item.id}
              type="button"
              disabled={missing}
              title={missing ? "No matching form found" : item.title}
              onClick={() => launch(item)}
              className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/60 hover:shadow disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Icon className="h-5 w-5" />
              </span>
              <span className="font-medium leading-snug">{item.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
