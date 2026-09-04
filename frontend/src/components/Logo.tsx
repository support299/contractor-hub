import { useState } from "react";
import { cn } from "@/lib/utils";

const BRAND_NAME = "Clean on the Go";

export function Logo({ className }: { className?: string }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span
        className={cn(
          "inline-flex items-center font-bold text-emerald-700 leading-tight truncate",
          className ?? "h-12",
        )}
      >
        {BRAND_NAME}
      </span>
    );
  }

  return (
    <img
      src="/logo.png"
      alt={BRAND_NAME}
      className={cn("object-contain object-left", className ?? "h-12 w-auto")}
      onError={() => setBroken(true)}
    />
  );
}
