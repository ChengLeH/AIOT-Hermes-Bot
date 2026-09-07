import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Locale } from "@/lib/locale";

export function BubbleCopy({ text, locale }: { text: string; locale: Locale }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!text) return null;
  const label = locale === "en"
    ? state === "copied" ? "Copied" : state === "error" ? "Copy failed. Try again" : "Copy message"
    : state === "copied" ? "已複製" : state === "error" ? "複製失敗，請重試" : "複製訊息";
  return <div className="flex justify-end pt-1">
    <button type="button" aria-label={label} title={label}
      className="bubble-copy grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2"
      onClick={async () => {
        clearTimeout(timer.current);
        try { await navigator.clipboard.writeText(text); setState("copied"); }
        catch { setState("error"); }
        timer.current = setTimeout(() => setState("idle"), 1800);
      }}>
      {state === "copied" ? <Check className="size-[1em] text-[#b1c8bb]" /> : <Copy className="size-[1em]" />}
      <span className="sr-only" role="status">{state === "idle" ? "" : label}</span>
    </button>
  </div>;
}
