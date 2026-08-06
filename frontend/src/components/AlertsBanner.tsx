import { useAlerts } from "@/lib/alerts-store";

export function AlertsBanner() {
  const alerts = useAlerts();
  const active = alerts.filter((a) => a.active);
  if (active.length === 0) return null;

  // duplicate items so the marquee loops seamlessly
  const items = [...active, ...active];

  return (
    <div className="w-full bg-emerald-500 text-white overflow-hidden">
      <div className="alerts-marquee flex whitespace-nowrap py-2.5 text-sm font-semibold">
        {items.map((a, i) => (
          <span key={`${a.id}-${i}`} className="px-8 inline-flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
            {a.message}
          </span>
        ))}
      </div>
    </div>
  );
}
