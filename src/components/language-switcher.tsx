import { LOCALES, type Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({
  locale,
  onChange,
  label,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  label: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-2 flex gap-2">
        {LOCALES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "h-10 flex-1 rounded-xl border text-sm",
              locale === item.id
                ? "border-border-strong bg-bg-elevated text-fg"
                : "border-border text-muted",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
