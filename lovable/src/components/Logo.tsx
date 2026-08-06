import logoAsset from "@/assets/clean-on-the-go-logo.png.asset.json";

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src={logoAsset.url}
      alt="Clean on the Go"
      className={className ?? "h-12 w-auto"}
    />
  );
}
