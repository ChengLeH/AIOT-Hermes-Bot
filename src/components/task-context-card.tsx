import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { BotAvatar } from "./bot-avatar";
import type { TaskContextMessage } from "@/lib/task-context";
import type { Locale } from "@/lib/locale";

export type TaskContextSnapshot = { available: boolean; messages?: TaskContextMessage[] };

/** The original server snapshot, never recomputed from the current Bot conversation. */
export function TaskContextCard({ count, snapshot, locale, name, profile, swatch }: {
  count: number; snapshot?: TaskContextSnapshot; locale: Locale; name: string; profile: string; swatch: string;
}) {
  const en = locale === "en";
  const marker = useId();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const messages = snapshot?.available ? (snapshot.messages || [])
    .filter(message => message && (message.role === "user" || message.role === "assistant") && typeof message.text === "string")
    .slice(0, 7)
    .map(message => ({ ...message, text: message.text.slice(0, 4000) })) : [];
  function changeOpen(next: boolean) {
    if (next === openRef.current) return;
    if (next) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches("input,textarea")) focused.blur();
      window.history.pushState({ ...window.history.state, aiotTaskContext: marker }, "");
      openRef.current = true; setOpen(true);
    } else if (window.history.state?.aiotTaskContext === marker) {
      window.history.back();
    } else { openRef.current = false; setOpen(false); }
  }
  useEffect(() => {
    const pop = () => { const visible = window.history.state?.aiotTaskContext === marker; openRef.current = visible; setOpen(visible); };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (window.history.state?.aiotTaskContext === marker) {
        const state = { ...window.history.state }; delete state.aiotTaskContext;
        window.history.replaceState(state, "");
      }
    };
  }, [marker]);
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button type="button" className="task-context-badge task-context-trigger" aria-label={en ? `View ${count} fork context messages` : `查看 ${count} 則分岔脈絡`}>{en ? `Fork · ${count} messages` : `分岔任務 · ${count} 則脈絡`}</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="task-context-overlay" />
      <Dialog.Content className="task-context-card" onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); changeOpen(false); }}>
        <header className="task-context-card-heading">
          <BotAvatar profile={profile} swatch={swatch} size={32} />
          <div className="min-w-0 flex-1"><Dialog.Title className="text-sm font-semibold">{en ? "Context carried into this fork" : "這次分岔帶入的脈絡"}</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-relaxed text-muted">{en ? `${name} · Original messages at creation, oldest first.` : `${name} · 建立時帶入的訊息，由舊到新排列。`}</Dialog.Description></div>
          <Dialog.Close className="icon-toggle grid size-11 shrink-0 place-items-center rounded-lg" aria-label={en ? "Close context" : "收起脈絡"}><X size={18} /></Dialog.Close>
        </header>
        <div className="task-context-card-scroll">
          {!snapshot?.available ? <p className="p-4 text-sm leading-relaxed text-muted">{en ? "This older task did not retain its original context snapshot. Its message count is available, but we cannot show the exact messages." : "這個較早的任務沒有保留原始脈絡快照。目前只有則數，無法還原當時的訊息內容。"}</p> : messages.length === 0 ? <p className="p-4 text-sm text-muted">{en ? "No earlier messages were included." : "這次沒有帶入先前訊息。"}</p> : <ol className="task-context-message-list">{messages.map((message, index) => <li key={index} className="task-context-message">
            <div className="mb-2 flex items-center gap-2 text-xs"><span className="task-context-number">{index + 1}</span><span>{message.role === "user" ? (en ? "You" : "你") : name}</span></div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{message.text}</p>
          </li>)}</ol>}
        </div>
        <footer className="px-4 py-3 text-xs leading-relaxed text-muted">{en ? "Read-only context. Longer messages may have been shortened when this task was created." : "僅供查看；較長的訊息可能已在建立任務時節錄。"}</footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
