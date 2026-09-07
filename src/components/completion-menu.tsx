import { useEffect, useRef } from "react";
import { groupCompletionItems, type CompletionItem } from "@/lib/completions";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function CompletionMenu({
  items,
  index,
  trigger,
  locale,
  onHover,
  onSelect,
}: {
  items: CompletionItem[];
  index: number;
  trigger: "/" | "@";
  locale: Locale;
  onHover: (index: number) => void;
  onSelect: (item: CompletionItem) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const groups = groupCompletionItems(items);
  let offset = 0;

  useEffect(() => {
    const el = root.current?.querySelector('[aria-selected="true"]');
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (items.length === 0) return null;

  return (
    <div
      ref={root}
      className="completion-menu mx-auto mb-2 max-h-56 w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-bg-elevated"
      role="listbox"
    >
      {groups.map((group) => {
        const start = offset;
        offset += group.items.length;
        return (
          <div key={group.group || "default"}>
            {group.group ? (
              <p className="px-3 pt-2 pb-1 text-[0.65rem] tracking-wide text-subtle">{group.group}</p>
            ) : null}
            <ul>
              {group.items.map((item, i) => {
                const abs = start + i;
                return (
                  <li key={`${item.insert}-${abs}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={abs === index}
                      onMouseEnter={() => onHover(abs)}
                      onClick={() => onSelect(item)}
                      className={cn(
                        "flex min-h-11 w-full flex-col items-start justify-center px-3 py-2 text-left",
                        abs === index ? "bg-bg-hover" : "hover:bg-bg-hover",
                      )}
                    >
                      <span className="text-sm text-fg">{item.label}</span>
                      <span className="text-xs text-muted">
                        {item.description ||
                          (trigger === "@"
                            ? t(locale, item.mention === "agent" ? "completions.agent" : "completions.mention")
                            : "")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
