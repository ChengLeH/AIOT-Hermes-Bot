import { APP_BRAND } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display font-semibold lowercase tracking-[0.36em] text-muted",
        className,
      )}
    >
      {APP_BRAND}
    </span>
  );
}
