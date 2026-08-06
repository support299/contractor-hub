import { useState } from "react";

const BRAND_NAME = "Clean on the Go";

export function Logo({ className }: { className?: string }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span
        className={`inline-flex items-center font-bold text-emerald-700 leading-none ${className ?? "h-12"}`}
      >
        {BRAND_NAME}
      </span>
    );
  }

  return (
    <img
      src="/logo.png"
      alt={BRAND_NAME}
      className={className ?? "h-12 w-auto"}
      onError={() => setBroken(true)}
    />
  );
}
