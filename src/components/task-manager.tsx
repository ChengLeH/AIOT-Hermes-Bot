import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Plus, Square, Trash2, X } from "lucide-react";
import { taskStatusLabel, type Locale } from "@/lib/locale";
import { cn, formatAge } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import { ForkIcon, IndependentTaskIcon } from "./fork-icon";

export type TaskManagerRecord = { id: string; title: string; status: string; mode?: "fork" | "independent"; createdAt?: string | number; updatedAt?: string | number; interruptRequested?: boolean };

export type TaskManagerProps = {
  open: boolean;
  name: string;
  profile: string;
  swatch: string;
  tasks: readonly TaskManagerRecord[];
  selectedTaskId: string | null;
  locale: Locale;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
  onStop?: (id: string) => void;
  onDelete?: (ids: string[]) => Promise<boolean>;
  busy?: boolean;
  stoppingTaskId?: string | null;
  error?: string;
};

/** The caller owns task data, selection and any browser-history entries. */
export function TaskManager({
  open, name, profile, swatch, tasks, selectedTaskId, locale, onSelect, onCreate, onClose, onStop, onDelete, busy = false, stoppingTaskId, error,
}: TaskManagerProps) {
  const en = locale === "en";
  const [now, setNow] = useState(Date.now);
  const [selecting, setSelecting] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const deleteLock = useRef(false);
  const isActive = (task: TaskManagerRecord) => ["preparing", "submitting", "running", "waiting_approval", "waiting_input", "disconnected", "unknown", "working", "queued"].includes(task.status);
  const canDelete = (task: TaskManagerRecord) => ["ready", "idle", "completed", "failed", "cancelled", "interrupted"].includes(task.status);
  const deletable = tasks.filter(canDelete);
  const selectedForDelete = deletable.filter((task) => checkedIds.has(task.id)).map((task) => task.id);
  const allChecked = deletable.length > 0 && selectedForDelete.length === deletable.length;
  function toggleChecked(id: string) {
    setCheckedIds((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function deleteSelected() {
    if (!onDelete || busy || deleteLock.current) return;
    setDeleteError(false);
    if (!selecting) { setSelecting(true); return; }
    if (!selectedForDelete.length) return;
    deleteLock.current = true; setDeleting(true);
    try {
      if (await onDelete(selectedForDelete)) { setCheckedIds(new Set()); setSelecting(false); }
      else setDeleteError(true);
    } catch { setDeleteError(true); }
    finally { deleteLock.current = false; setDeleting(false); }
  }
  const timestamp = (value: string | number | undefined) => { const parsed = typeof value === "number" ? value : Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0; };
  const ordered = [...tasks].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
  useEffect(() => { if (!open) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, [open]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ pointer: number; y: number; height: number; viewport: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!open) { setExpanded(false); setDragHeight(null); drag.current = null; setSelecting(false); setCheckedIds(new Set()); setDeleteError(false); return; }
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/65 backdrop-blur-sm" />
        <Dialog.Content
          ref={sheet}
          data-expanded={expanded}
          data-dragging={dragHeight !== null}
          className="task-manager-sheet fixed bottom-0 left-1/2 z-[121] flex w-full max-w-xl -translate-x-1/2 flex-col rounded-t-3xl border border-border bg-bg text-fg shadow-panel outline-none"
          style={{ paddingBottom: "var(--app-safe-bottom, env(safe-area-inset-bottom))", ...(dragHeight !== null ? { height: dragHeight } : {}) }}
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected && !returnFocus.current.matches("input, textarea, [contenteditable='true']")) returnFocus.current.focus({ preventScroll: true });
          }}
        >
          <button
            type="button"
            className="task-manager-handle"
            aria-label={en ? (expanded ? "Reduce task sheet" : "Expand task sheet") : (expanded ? "縮小任務清單" : "展開任務清單")}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setExpanded((value) => !value); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") suppressClick.current = false;
              if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                event.preventDefault(); setExpanded(event.key === "ArrowUp" || event.key === "Home");
              }
            }}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              suppressClick.current = false;
              drag.current = { pointer: event.pointerId, y: event.clientY, height: sheet.current?.getBoundingClientRect().height || 0, viewport: window.visualViewport?.height || window.innerHeight };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId) return;
              const delta = start.y - event.clientY;
              if (Math.abs(delta) > 6) suppressClick.current = true;
              if (suppressClick.current) setDragHeight(Math.max(start.viewport * .58, Math.min(start.viewport, start.height + delta)));
            }}
            onPointerUp={(event) => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId) return;
              const delta = start.y - event.clientY;
              if (Math.abs(delta) > 6) {
                suppressClick.current = true;
                setExpanded(Math.abs(delta) >= 32 ? delta > 0 : start.height + delta > start.viewport * .79);
              }
              drag.current = null; setDragHeight(null);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { drag.current = null; setDragHeight(null); suppressClick.current = true; }}
            onLostPointerCapture={() => { drag.current = null; setDragHeight(null); }}
          ><span aria-hidden="true" /></button>
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 pb-3">
            <BotAvatar profile={profile} swatch={swatch} size={40} />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">{en ? "Tasks" : "任務管理"}</Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-xs text-muted">
                {en ? `${name} · Tasks` : `${name} 的任務`}
              </Dialog.Description>
            </div>
            {selecting ? <button type="button" className="min-h-11 shrink-0 rounded-xl px-2 text-xs text-muted hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent" disabled={busy || deleting || !deletable.length} onClick={() => setCheckedIds(allChecked ? new Set() : new Set(deletable.map((task) => task.id)))}>{allChecked ? (en ? "Deselect all" : "取消全選") : (en ? "Select all" : "全選")}</button> : null}
            <Dialog.Close asChild>
              <button type="button" aria-label={en ? "Close tasks" : "關閉任務管理"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          {deleteError ? <p role="alert" className="px-5 py-2 text-sm text-danger">{en ? "Could not delete these tasks. Please try again." : "目前無法刪除所選任務，請重試。"}</p> : null}
          {error ? <p role="alert" className="px-5 py-2 text-sm text-danger">{error}</p> : null}
          <div id={listId} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
            {tasks.length ? (
              <ul className="space-y-1" aria-label={en ? `${name}'s tasks` : `${name} 的任務清單`}>
                {ordered.map((task) => {
                  const selected = task.id === selectedTaskId;
                  const active = isActive(task);
                  const removable = canDelete(task);
                  const stopping = active && (task.interruptRequested || stoppingTaskId === task.id);
                  const created = timestamp(task.createdAt);
                  const stopLabel = stopping ? (en ? "Stopping task" : "正在停止任務") : (en ? "Stop task" : "停止任務");
                  const status = stopping ? (en ? "Stopping…" : "正在停止…") : taskStatusLabel(locale, task.status);
                  const modeLabel = task.mode === "fork" ? (en ? "Forked task" : "分支任務") : (en ? "Independent task" : "獨立任務");
                  return (
                    <li key={task.id} className="flex items-center gap-1">
                      {selecting ? <button type="button" role="checkbox" aria-checked={removable && checkedIds.has(task.id)} aria-label={`${en ? "Select task" : "選取任務"} · ${task.title}${active ? (en ? ". Stop the task first." : "，請先停止任務") : ""}`} disabled={!removable || busy || deleting} onClick={() => toggleChecked(task.id)} className="grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"><span className={cn("grid size-5 place-items-center rounded-full border", removable && checkedIds.has(task.id) ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>{removable && checkedIds.has(task.id) ? <Check size={12} aria-hidden="true" /> : null}</span></button> : null}
                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        disabled={deleting || (selecting && (active || busy))}
                        onClick={() => selecting ? toggleChecked(task.id) : onSelect(task.id)}
                        className={cn("flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", selected ? "border-border-strong bg-bg-subtle" : "border-transparent hover:bg-bg-elevated")}
                      >
                        <BotAvatar profile={profile} swatch={swatch} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{task.title || (en ? "Untitled task" : "未命名任務")}</span>
                          <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                            {selecting && active ? <span>{en ? "Stop task first" : "先停止任務"}</span> : status ? <span>{status}</span> : null}
                            <span className="task-mode-badge" role="img" aria-label={modeLabel} title={modeLabel}>
                              {task.mode === "fork" ? <ForkIcon width={14} height={14} /> : <IndependentTaskIcon width={14} height={14} />}
                            </span>
                            {created > 0 ? <time dateTime={new Date(created).toISOString()} title={new Date(created).toLocaleString(en ? "en" : "zh-TW")} className="ml-auto shrink-0 text-[11px]">{formatAge(created, now, locale)}</time> : null}
                          </span>
                        </span>
                      </button>
                      {active && onStop ? <button type="button" className="mr-1 grid size-11 shrink-0 place-items-center rounded-full bg-transparent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent" disabled={busy || stopping || deleting} onClick={() => onStop(task.id)} aria-label={`${stopLabel} · ${task.title}`} title={stopLabel}><span className="stop-btn grid size-7 place-items-center rounded-full"><Square size={12} fill="currentColor" aria-hidden="true" /></span></button> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
                <BotAvatar profile={profile} swatch={swatch} size={48} />
                <p className="text-sm">{en ? "No tasks yet" : "目前沒有任務"}</p>
                <p className="text-xs leading-relaxed text-muted">{en ? `Create a task for ${name} to get started.` : `建立新任務，讓 ${name} 開始處理。`}</p>
              </div>
            )}
          </div>
          {selecting ? <p className="shrink-0 px-5 py-2 text-xs text-muted">{en ? "Deletes the selected sessions from Hermes and AIOT. Stop running tasks first." : "會同步刪除 Hermes 與 AIOT 的所選對話。執行中的任務請先停止。"}</p> : null}
          <footer className="flex shrink-0 gap-3 border-t border-border px-4 py-3">
            <button type="button" onClick={() => void deleteSelected()} disabled={!onDelete || busy || deleting || (selecting && !selectedForDelete.length) || !tasks.length} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border-strong bg-bg-elevated text-sm font-medium hover:bg-bg-hover disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><Trash2 size={16} aria-hidden="true" />{deleting ? (en ? "Deleting…" : "正在刪除…") : selecting && selectedForDelete.length ? (en ? `Delete (${selectedForDelete.length})` : `刪除（${selectedForDelete.length}）`) : (en ? "Delete" : "刪除")}</button>
            <button type="button" onClick={onCreate} disabled={deleting} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border-strong bg-bg-elevated text-sm font-medium hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <Plus size={16} aria-hidden="true" />
              {en ? "New task" : "新增任務"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
