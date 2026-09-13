import * as Dialog from "@radix-ui/react-dialog";
import { forwardRef, useCallback, useEffect, useLayoutEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, ListTodo, Search, Square, X } from "lucide-react";
import { hermesFetch } from "@/lib/hermes-fetch";
import { approvalDeadlineLabels, localizeNotice, localizeTaskNotice, taskStatusLabel, t, type Locale } from "@/lib/locale";
import { CodeBlock, Markdown } from "@/lib/markdown";
import { BotAvatar } from "./bot-avatar";
import { BubbleCopy } from "./bubble-copy";
import { TaskContextCard, type TaskContextSnapshot } from "./task-context-card";
import { TaskManager } from "./task-manager";
import { MessageAttachments, QueuePreview } from "./attachment-media";
import type { AttachmentDescriptor } from "@/lib/attachment-rules";
import { postBotUpload, fileKindError, MAX_ATTACHMENTS, DEFAULT_MAX_BYTES } from "@/lib/attachments";
import { createPreviewUrl, queueFromFile, revokeQueuedPreview, transferQueueToSession, type QueuedAttachment } from "@/lib/attachment-preview";
import { createUploadBatch } from "@/lib/upload-batch";
import { UploadFeedback } from "./upload-feedback";
import { ComposerAttachmentButton, ComposerSendButton } from "./composer-buttons";
import { findMessageMatches, nextMatchIndex, searchCountLabel } from "@/lib/chat-search";
import { subscribeTaskDeepLink, takeTaskDeepLink } from "@/lib/task-deep-link";
import { PLAN_FADE_MS, projectTaskPlan, type SessionTodoState } from "@/lib/task-plan";
import type { TaskContextMessage } from "@/lib/task-context";
import { reconcileTaskWorkspaceHistory, taskWorkspaceMarker } from "@/lib/app-history";
import { afterCardStartPaint, waitForCardAnimation } from "@/lib/card-motion";
import { collectUnseenCompletedTasks } from "@/lib/task-completion";

function blurTextInput() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && (focused.matches("input, textarea") || focused.isContentEditable)) focused.blur();
}

function SessionPlan({ task, state, locale }: { task: WorkspaceTask; state: SessionTodoState; locale: Locale }) {
  const en = locale === "en";
  const listId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [fading, setFading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const view = projectTaskPlan({ status: task.status, terminalAt: task.terminalAt, todoState: state });
  const { todos, completed, cancelled, notCompleted, settled, endedAt, fadeRemainingMs } = view;
  useEffect(() => {
    setFading(false);
    if (!settled) { setHidden(false); return; }
    const remaining = Number.isFinite(endedAt) ? Math.max(0, endedAt + PLAN_FADE_MS - Date.now()) : 0;
    if (!remaining) { setHidden(true); return; }
    setHidden(false);
    const frame = requestAnimationFrame(() => setFading(true));
    const timer = window.setTimeout(() => setHidden(true), remaining);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [settled, endedAt]);
  if (!todos.length || hidden || (settled && fadeRemainingMs <= 0)) return null;
  const title = en ? "Task plan" : "工作計畫";
  return <section className="mx-4 mb-2 shrink-0 rounded-xl border border-border bg-bg-elevated transition-opacity duration-[5000ms] ease-out motion-reduce:transition-none" style={{ opacity: fading ? 0 : view.opacity, transitionDuration: fading ? `${fadeRemainingMs}ms` : "0ms" }} aria-label={title}>
    <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={!collapsed} aria-controls={listId} onClick={() => setCollapsed((value) => !value)}>
      <ListTodo size={14} aria-hidden="true" /><span className="flex-1 font-medium">{title}</span><span className="text-muted">{en ? `${completed}/${todos.length} done` : `${completed}/${todos.length} 已完成`}{cancelled ? (en ? ` · ${cancelled} cancelled` : ` · ${cancelled} 已取消`) : ""}{notCompleted ? (en ? ` · ${notCompleted} not completed` : ` · ${notCompleted} 未完成`) : ""}</span>{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
    </button>
    {!collapsed && <ul id={listId} className="max-h-40 space-y-2 overflow-y-auto px-3 pb-3">{todos.map((todo) => {
      const label = todo.displayStatus === "not_completed" ? (en ? "Not completed" : "未完成") : todo.displayStatus === "run_failed" ? (en ? "Not completed (run failed)" : "未完成（任務失敗）") : todo.displayStatus === "run_stopped" ? (en ? "Stopped" : "已停止") : todo.displayStatus === "in_progress" ? (en ? "In progress" : "執行中") : todo.displayStatus === "completed" ? (en ? "Completed" : "已完成") : todo.displayStatus === "cancelled" ? (en ? "Cancelled" : "已取消") : todo.displayStatus === "pending" ? (en ? "Pending" : "待處理") : (en ? "Status unconfirmed" : "等待確認狀態");
      return <li key={todo.id} className="flex items-start gap-2 text-xs"><span className="mt-0.5 grid size-3.5 shrink-0 place-items-center" aria-hidden="true">{todo.status === "completed" ? <Check size={12} /> : <span className={`size-1.5 rounded-full ${todo.displayStatus === "in_progress" ? "bg-fg" : "bg-muted"}`} />}</span><span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{todo.content}</span><span className="shrink-0 text-muted">{label}</span></li>;
    })}</ul>}
  </section>;
}

export type WorkspaceTask = {
  id: string; title: string; status: string; turn?: number | string; summary?: string; mode?: "fork" | "independent"; contextCount?: number; contextSnapshot?: TaskContextSnapshot;
  botId?: string; profile?: string; error?: string; todoState?: SessionTodoState;
  createdAt?: string | number; updatedAt?: string | number; terminalAt?: string; interruptRequested?: boolean;
  messages?: { id?: string; role: string; content?: string; text?: string; attachments?: AttachmentDescriptor[] }[];
  queuedTurns?: { id: string; text: string; createdAt: string; attachments?: { id: string; name: string }[] }[];
  pendingApproval?: { kind?: string; command?: string; description?: string; summary?: string; receivedAt?: string; timeoutSeconds?: number | null; expiresAt?: string | null; choices?: string[] };
};
type TaskCreateOptions = { mode: "fork" | "independent"; context: TaskContextMessage[] };
export type TaskWorkspaceHandle = { create: (text: string, attachments?: AttachmentDescriptor[], options?: TaskCreateOptions) => Promise<boolean>; openManager: () => void; close: () => boolean };
export type TaskWorkspaceProps = {
  bot: { id: string; name: string; profile: string; swatch: string; conversation: string };
  connection: { origin: string; apiKey: string };
  locale: Locale;
  onCompleted?: (tasks: WorkspaceTask[]) => void;
};
type Panel = "manager" | "login" | "detail" | "new" | null;
type Payload = { authenticated?: boolean; dashboardOrigin?: string; authorizeURL?: string; tasks?: WorkspaceTask[]; task?: WorkspaceTask; deletedIds?: string[]; failedIds?: string[] };
const headerButton = "icon-toggle grid size-11 shrink-0 place-items-center rounded-lg hover:bg-bg-elevated focus-visible:outline-2 focus-visible:outline-accent";
const button = "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm hover:bg-bg-hover disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
const attachmentErrors: Record<string, [string, string]> = {
  task_session_missing: ["這個任務已從 Hermes 刪除，保留的對話仍可查看。", "This task was deleted from Hermes. Its saved conversation is still available."],
  session_heic_unsupported: ["Hermes 任務目前不接受 HEIC／HEIF，請先轉成 JPG 或 PNG。附件已保留。", "Hermes tasks do not currently accept HEIC/HEIF. Convert to JPG or PNG; your attachments are preserved."],
  attachment_too_large: ["單一任務附件不能超過 10 MB，請縮小檔案後再傳送。", "Each task attachment must be no larger than 10 MB. Reduce the file size and try again."],
  attachment_unavailable: ["無法取得附件，請確認連線，或重新選取檔案。", "The attachment could not be retrieved. Check your connection or select the file again."],
  task_attachment_rejected: ["Hermes 尚未接收完整附件，因此沒有送出任務。附件已保留，可重試。", "Hermes did not accept all attachments, so the task was not sent. Your files are preserved for retry."],
  task_queue_full: ["佇列已滿，請等待前面的訊息完成。", "The queue is full. Wait for an earlier message to finish."],
  task_queued_attachments_unsupported: ["任務執行中只能先佇列文字；附件請在目前回合結束後傳送。", "While a task is running, only text can be queued. Send attachments after the current turn finishes."],
  unsupported_attachment_type: ["Hermes 不支援這個附件格式，請改用圖片或文件。", "Hermes does not support this attachment format. Use a supported image or document."],
};

export const TaskWorkspace = forwardRef<TaskWorkspaceHandle, TaskWorkspaceProps>(function TaskWorkspace(props, ref) {
  const scope = JSON.stringify([props.bot.id, props.bot.profile, props.bot.conversation, props.connection.origin, props.connection.apiKey]);
  return <ScopedTaskWorkspace key={scope} {...props} ref={ref} />;
});

const ScopedTaskWorkspace = forwardRef<TaskWorkspaceHandle, TaskWorkspaceProps>(function ScopedTaskWorkspace({ bot, connection, locale, onCompleted }, ref) {
  const en = locale === "en";
  const [panel, setPanel] = useState<Panel>(null);
  const panelRef = useRef<Panel>(null);
  const [managerOverDetail, setManagerOverDetail] = useState(false);
  const [animateEntry, setAnimateEntry] = useState(false);
  const [cardMotion, setCardMotion] = useState<"preparing" | "entering" | "idle" | "exiting">("idle");
  const sessionPanel = useRef<HTMLDivElement | null>(null);
  const cancelPendingMotion = useRef<(() => void) | null>(null);
  const marker = useRef(taskWorkspaceMarker(bot.id, bot.profile, bot.conversation));
  const [finding, setFinding] = useState(false);
  const findingRef = useRef(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [selected, setSelected] = useState<WorkspaceTask | null>(null);
  const matches = findMessageMatches((selected?.messages || []).map((message, index) => ({ id: String(index), content: message.content ?? message.text ?? "" })), findQuery);
  const matchIndex = matches.length ? findIndex % matches.length : 0;
  const currentMatch = matches[matchIndex];
  useEffect(() => {
    setFindQuery(""); setFindIndex(0);
  }, [selected?.id]);
  useEffect(() => {
    if (!finding || currentMatch === undefined) return;
    followTail.current = false;
    messageLog.current?.querySelector(`[data-task-message="${currentMatch}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [finding, currentMatch]);
  function closeFinding() {
    if (!findingRef.current) return;
    blurTextInput();
    if (window.history.state?.aiotTaskSearch) window.history.back();
    else { findingRef.current = false; setFinding(false); setFindQuery(""); }
  }
  function toggleFinding() {
    if (findingRef.current) { closeFinding(); return; }
    window.history.pushState({ ...window.history.state, aiotTaskSearch: true }, "");
    findingRef.current = true; setFinding(true);
  }
  const selectedId = useRef<string | null>(null);
  const deletedTaskIds = useRef(new Set<string>());
  const messageLog = useRef<HTMLDivElement | null>(null);
  const followTail = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const sentScroll = useRef<string | null>(null);
  function measureTaskScroll() {
    const el = messageLog.current;
    if (el) setAwayFromLatest(el.scrollHeight - el.scrollTop - el.clientHeight > 64);
  }
  function jumpTaskLatest() {
    const el = messageLog.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followTail.current = true;
    setAwayFromLatest(false);
  }
  useEffect(() => {
    const el = messageLog.current;
    if (!el) return;
    const resize = new ResizeObserver(measureTaskScroll);
    const mutations = new MutationObserver(measureTaskScroll);
    resize.observe(el);
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
    measureTaskScroll();
    return () => { resize.disconnect(); mutations.disconnect(); };
  }, [panel]);
  const viewedTask = useRef<string | null>(null);
  const suspendedScroll = useRef<{ id: string; top: number; follow: boolean } | null>(null);
  const returning = useRef(false);
  const selectionOnReturn = useRef<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const authRef = useRef(false);
  const [dashboardOrigin, setDashboardOrigin] = useState("");
  const [provider, setProvider] = useState("");
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft); draftRef.current = draft;
  const composerScope = useRef("__new");
  const queues = useRef(new Map<string, QueuedAttachment[]>());
  const uploadJobs = useRef(new Map<string, Set<Promise<void>>>());
  const replyRequests = useRef(new Map<string, { signature: string; requestId: string }>());
  const [, redrawQueue] = useState(0);
  const [uploadFeedback, setUploadFeedback] = useState<{ scope: string; id: string; ok: boolean } | null>(null);
  const submitLock = useRef(false);
  const [waitingUploads, setWaitingUploads] = useState(false);
  const taskFileInput = useRef<HTMLInputElement | null>(null);
  const taskTextarea = useRef<HTMLTextAreaElement | null>(null);
  function updateQueue(scope: string, update: (items: QueuedAttachment[]) => QueuedAttachment[]) {
    queues.current.set(scope, update(queues.current.get(scope) || []));
    if (alive.current) redrawQueue((value) => value + 1);
  }
  useEffect(() => () => { for (const items of queues.current.values()) items.forEach(revokeQueuedPreview); }, []);
  useLayoutEffect(() => {
    const area = taskTextarea.current;
    if (!area) return;
    area.style.height = "auto";
    const style = getComputedStyle(area);
    const height = area.scrollHeight + parseFloat(style.borderTopWidth || "0") + parseFloat(style.borderBottomWidth || "0");
    area.style.height = `${Math.min(160, height)}px`;
    area.style.overflowY = height > 160 ? "auto" : "hidden";
  }, [draft, panel]);
  useLayoutEffect(() => {
    if (cardMotion !== "preparing" || panel === null || panel === "manager") return;
    return afterCardStartPaint(() => setCardMotion((current) => current === "preparing" ? "entering" : current));
  }, [cardMotion, panel]);
  const [error, setError] = useState(false);
  const [errorCode, setErrorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const pendingCreate = useRef<{ signature: string; requestId: string } | null>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const completed = useRef(new Set<string>());
  const completedRef = useRef(onCompleted);
  completedRef.current = onCompleted;
  const focusReturn = useRef<HTMLElement | null>(null);
  const localSetup = typeof window !== "undefined" && ["127.0.0.1", "[::1]"].includes(window.location.hostname);

  useEffect(() => {
    if (panel !== "detail") { if (panel !== "manager") viewedTask.current = null; return; }
    const saved = suspendedScroll.current;
    if (saved && saved.id === selected?.id) {
      viewedTask.current = selected?.id ?? null;
      followTail.current = saved.follow;
      const frame = requestAnimationFrame(() => {
        if (messageLog.current) messageLog.current.scrollTop = saved.top;
        suspendedScroll.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
    suspendedScroll.current = null;
    const firstOpen = viewedTask.current !== selected?.id;
    const userSent = sentScroll.current === selected?.id;
    sentScroll.current = null;
    if (firstOpen) {
      viewedTask.current = selected?.id ?? null;
      followTail.current = true;
    }
    if (!firstOpen && !(userSent && followTail.current)) { measureTaskScroll(); return; }
    const frame = requestAnimationFrame(() => {
      const el = messageLog.current;
      if (el) { el.scrollTop = el.scrollHeight; setAwayFromLatest(false); }
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, selected?.id, selected?.messages?.length]);

  function show(next: Panel) {
    if (returning.current || next === panelRef.current) return;
    const current = panelRef.current;
    if (next === "manager" || current === "manager") blurTextInput();
    setAnimateEntry(next !== "manager" && current !== "detail");
    if (next !== "manager" && current !== "detail") setCardMotion("preparing");
    setManagerOverDetail(current === "detail" && next === "manager");
    const state = window.history.state || {};
    if (current === "detail" && next === "manager" && selectedId.current && messageLog.current) {
      suspendedScroll.current = { id: selectedId.current, top: messageLog.current.scrollTop, follow: followTail.current };
    }
    // Choosing from a temporary list replaces its underlying detail, not a new layer.
    if (current === "manager" && next === "detail" && state.aiotTaskReturn === "detail") {
      selectionOnReturn.current = selectedId.current;
      returning.current = true;
      window.history.back();
      return;
    }
    const entry = { ...state, aiotView: "chat", aiotTaskWorkspace: marker.current,
      aiotTaskPanel: next, aiotTaskId: selectedId.current,
      aiotTaskReturn: current === "detail" && next === "manager" ? "detail" : current ? state.aiotTaskReturn ?? null : null };
    if (next && (!current || (current === "detail" && next === "manager"))) window.history.pushState(entry, "");
    else if (next) window.history.replaceState(entry, "");
    panelRef.current = next;
    setPanel(next);
  }
  function close() {
    if (!panelRef.current) return false;
    blurTextInput();
    if (panelRef.current === "detail" && findingRef.current) { closeFinding(); return true; }
    if (returning.current) return true;
    if (panelRef.current === "manager") {
      if (window.history.state?.aiotTaskWorkspace === marker.current) {
        returning.current = true;
        window.history.back();
      } else { panelRef.current = null; setPanel(null); }
      return true;
    }
    const finishClose = () => {
      if (window.history.state?.aiotTaskWorkspace === marker.current) {
        window.history.back();
      } else { returning.current = false; panelRef.current = null; setPanel(null); }
    };
    returning.current = true;
    setCardMotion("exiting");
    cancelPendingMotion.current = waitForCardAnimation(sessionPanel.current, "task-session-exit", finishClose);
    return true;
  }
  const request = useCallback(async (route: string, body?: Record<string, unknown>, id?: string): Promise<Payload> => {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const requestOrigin = localSetup ? window.location.origin : connection.origin.replace(/\/$/, "");
      const url = new URL(`${requestOrigin}/api/bot/sessions/${route}`);
      if (!body) {
        url.searchParams.set("botId", bot.id);
        url.searchParams.set("profile", bot.profile);
        if (id) url.searchParams.set("id", id);
      }
      const response = await hermesFetch(url.href, {
        apiKey: connection.apiKey, timeoutMs: ["create", "reply"].includes(route) ? 120_000 : 15_000, signal: controller.signal,
        method: body ? "POST" : "GET",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, botId: bot.id, profile: bot.profile }) } : {}),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        if (alive.current) setErrorCode(typeof failure.error === "string" && attachmentErrors[failure.error] ? failure.error : "");
        throw new Error("Task request failed");
      }
      const data: Payload = await response.json();
      if (!alive.current) throw new Error("Workspace changed");
      return data;
    } finally { controllers.current.delete(controller); }
  }, [bot.id, bot.profile, connection.apiKey, connection.origin, localSetup]);
  function report(tasks: WorkspaceTask[]) {
    const unseen = collectUnseenCompletedTasks(tasks, completed.current);
    if (unseen.length) completedRef.current?.(unseen);
  }
  function acceptTask(task: WorkspaceTask) {
    setTasks((items) => [task, ...items.filter((item) => item.id !== task.id)]);
    report([task]);
    if (selectedId.current === task.id) setSelected(task);
  }
  async function create(text: string, attachments: AttachmentDescriptor[] = [], options: TaskCreateOptions = { mode: "independent", context: [] }) {
    if (!text.trim() || busyRef.current) return false;
    busyRef.current = true; revision.current += 1; setBusy(true); setError(false); setErrorCode("");
    try {
      const status = await request("status");
      authRef.current = status.authenticated === true;
      setAuthenticated(authRef.current);
      if (status.dashboardOrigin) setDashboardOrigin(status.dashboardOrigin);
      if (!authRef.current) { show("login"); return false; }
      const signature = JSON.stringify([text.trim(), attachments.map((attachment) => attachment.id), options.mode, options.context]);
      if (pendingCreate.current?.signature !== signature) pendingCreate.current = { signature, requestId: crypto.randomUUID() };
      const result = await request("create", { text: text.trim(), parentConversation: bot.conversation, attachments, ...options, requestId: pendingCreate.current.requestId });
      if (!result.task?.id) throw new Error("Missing task");
      pendingCreate.current = null;
      selectedId.current = result.task.id;
      acceptTask(result.task);
      show("detail");
      return true;
    } catch { if (alive.current) { setError(true); if (!panelRef.current) show("new"); } return false; }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  useImperativeHandle(ref, () => ({ create, openManager: () => show(authRef.current ? "manager" : "login"), close }));

  useEffect(() => {
    alive.current = true;
    const activeControllers = controllers.current;
    const workspaceMarker = marker.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        if (busyRef.current) return;
        const version = revision.current;
        const status = await request("status");
        if (version !== revision.current) return;
        authRef.current = status.authenticated === true;
        setAuthenticated(authRef.current);
        if (status.dashboardOrigin) setDashboardOrigin((value) => value || status.dashboardOrigin!);
        if (!authRef.current) { setTasks([]); return; }
        const list = await request("list");
        if (version !== revision.current) return;
        const items = Array.isArray(list.tasks) ? list.tasks : [];
        setTasks(previous => JSON.stringify(previous) === JSON.stringify(items) ? previous : items);
        setStoppingTaskId((id) => id && items.some((task) => task.id === id && !["completed", "done", "failed", "interrupted", "cancelled", "canceled"].includes(task.status)) ? id : null);
        // The initial status check may finish after the user opens Tasks.
        // Once authenticated, leave the sign-in panel without another click.
        if (panelRef.current === "login") show("manager");
        report(items);
        const id = selectedId.current;
        if (id) {
          const detail = await request("detail", undefined, id);
          if (version === revision.current && selectedId.current === id && detail.task) { setSelected(previous => JSON.stringify(previous) === JSON.stringify(detail.task) ? previous : detail.task!); report([detail.task]); }
        }
      } catch {
        // Polling is background synchronization. iOS pauses network requests
        // while Quick Look is open; that transient failure must not replace a
        // still-valid task with a false connection error. User actions keep
        // their explicit error handling below.
      }
      finally { if (alive.current) timer = setTimeout(() => void poll(), 4000); }
    };
    void poll();
    const pop = () => {
      cancelPendingMotion.current?.();
      cancelPendingMotion.current = null;
      setAnimateEntry(false);
      returning.current = false;
      const currentState = window.history.state;
      const state = reconcileTaskWorkspaceHistory(currentState, workspaceMarker);
      if (state !== currentState) window.history.replaceState(state, "");
      if (findingRef.current && !state?.aiotTaskSearch) blurTextInput();
      findingRef.current = state?.aiotTaskWorkspace === workspaceMarker && !!state.aiotTaskSearch;
      setFinding(findingRef.current);
      if (!findingRef.current) { setFindQuery(""); setFindIndex(0); }
      const panelValue = state.aiotTaskPanel;
      let next: Panel = state.aiotTaskWorkspace === workspaceMarker && (panelValue === "manager" || panelValue === "detail" || panelValue === "new" || panelValue === "login") ? panelValue : null;
      if (next === "detail" && typeof state.aiotTaskId === "string" && deletedTaskIds.current.has(state.aiotTaskId)) {
        next = "manager";
        window.history.replaceState({ ...state, aiotTaskPanel: "manager", aiotTaskId: null, aiotTaskReturn: null }, "");
      }
      if (next === "detail" && selectionOnReturn.current) {
        window.history.replaceState({ ...state, aiotTaskId: selectionOnReturn.current }, "");
      } else if (next === "detail" && state.aiotTaskId && state.aiotTaskId !== selectedId.current) {
        selectedId.current = state.aiotTaskId;
        setSelected(null);
        setDraft("");
      }
      selectionOnReturn.current = null;
      setManagerOverDetail(next === "manager" && state?.aiotTaskReturn === "detail");
      panelRef.current = next;
      setPanel(next);
    };
    window.addEventListener("popstate", pop);
    pop();
    return () => {
      cancelPendingMotion.current?.();
      alive.current = false; clearTimeout(timer);
      activeControllers.forEach((controller) => controller.abort());
      window.removeEventListener("popstate", pop);
      if (window.history.state?.aiotTaskWorkspace === workspaceMarker) {
        const state = { ...window.history.state }; delete state.aiotTaskWorkspace; delete state.aiotTaskPanel; delete state.aiotTaskId; delete state.aiotTaskReturn; delete state.aiotTaskSearch;
        window.history.replaceState(state, "");
      }
    };
  }, [request]);

  useEffect(() => {
    const openPendingTask = async () => {
      if (!authenticated) return;
      const pending = takeTaskDeepLink(bot.profile, bot.conversation);
      if (!pending) return;
      try {
        const result = await request("detail", undefined, pending.taskId);
        const task = result.task;
        if (!task || task.id !== pending.taskId || (task.botId && task.botId !== bot.id) || (task.profile && task.profile !== bot.profile)) throw new Error("Task does not match connection");
        selectedId.current = task.id;
        setSelected(task); setDraft(""); setError(false);
        show("detail");
      } catch { if (alive.current) setError(true); }
    };
    const unsubscribe = subscribeTaskDeepLink(() => { void openPendingTask(); });
    void openPendingTask();
    return unsubscribe;
  }, [authenticated, bot.id, bot.profile, bot.conversation, request]);

  async function login() {
    if (!localSetup || busyRef.current) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) { setError(true); return; }
    popup.opener = null;
    busyRef.current = true; revision.current += 1; setBusy(true); setError(false);
    try {
      const result = await request("login", { dashboardOrigin: dashboardOrigin.trim(), ...(provider.trim() ? { provider: provider.trim() } : {}) });
      const target = new URL(result.authorizeURL || "");
      if (target.protocol !== "https:" || target.origin !== new URL(dashboardOrigin.trim()).origin || target.pathname !== "/auth/native/authorize") throw new Error("Invalid login URL");
      popup.location.href = target.href;
    } catch { popup.close(); if (alive.current) setError(true); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function taskAction(route: "reply" | "clarify" | "approval" | "interrupt", extra: Record<string, unknown> = {}) {
    if (!selectedId.current || busyRef.current) return false;
    const id = selectedId.current;
    busyRef.current = true; revision.current += 1; setBusy(true); setError(false);
    try {
      const result = await request(route, { ...extra, id });
      if (route === "reply" || route === "clarify") sentScroll.current = id;
      if (route === "interrupt") setStoppingTaskId(id);
      if (result.task) acceptTask(result.task);
      if ((route === "reply" || route === "clarify") && selectedId.current === id) setDraft("");
      return true;
    } catch { if (alive.current) setError(true); return false; }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function stopTask(id: string) {
    if (busyRef.current) return;
    busyRef.current = true; revision.current += 1; setBusy(true); setError(false);
    setStoppingTaskId(id);
    try {
      const result = await request("interrupt", { id });
      if (result.task) acceptTask(result.task);
    } catch { if (alive.current) { setStoppingTaskId(null); setError(true); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function deleteTasks(ids: string[]) {
    if (busyRef.current) return false;
    busyRef.current = true; revision.current += 1; setBusy(true); setError(false);
    try {
      const result = await request("delete", { ids });
      const deleted = new Set(result.deletedIds || []);
      deleted.forEach(id => { deletedTaskIds.current.add(id); (queues.current.get(id) || []).forEach(revokeQueuedPreview); queues.current.delete(id); replyRequests.current.delete(id); });
      setTasks(items => items.filter(task => !deleted.has(task.id)));
      if (selectedId.current && deleted.has(selectedId.current)) {
        selectedId.current = null; setSelected(null); setDraft(""); setManagerOverDetail(false);
        window.history.replaceState({ ...window.history.state, aiotTaskReturn: null, aiotTaskId: null }, "");
      }
      if (result.failedIds?.length) { setError(true); return false; }
      return true;
    } catch { setError(true); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  const inDetail = panel === "detail" || (panel === "manager" && managerOverDetail);
  if (panel === "new") composerScope.current = "__new";
  else if (inDetail && selectedId.current) composerScope.current = selectedId.current;
  const queuedFiles = queues.current.get(composerScope.current) || [];
  function pickTaskFiles(files: FileList | null) {
    if (!files || submitLock.current || busyRef.current) return;
    const scope = composerScope.current;
    const picked = Array.from(files).slice(0, Math.max(0, MAX_ATTACHMENTS - (queues.current.get(scope)?.length || 0)));
    if (!picked.length) return;
    const finish = createUploadBatch(picked.length);
    const batchId = crypto.randomUUID();
    const report = (ok: boolean) => { const result = finish(ok); if (result && alive.current) setUploadFeedback({ scope, id: batchId, ok: result === "success" }); };
    const pendingFiles = picked.map((file) => {
      const item = queueFromFile(file, crypto.randomUUID(), createPreviewUrl(file, { name: file.name, type: file.type }));
      const kind = fileKindError(file);
      if (kind || file.size > DEFAULT_MAX_BYTES) { item.status = "error"; item.error = kind || "error.fileTooBig"; }
      return { file, item };
    });
    updateQueue(scope, (items) => [...items, ...pendingFiles.map(({ item }) => item)]);
    const job = (async () => {
      for (const { file, item } of pendingFiles) {
        if (!alive.current) break;
        if (item.status === "error") { report(false); continue; }
        try {
          const attachment = await postBotUpload({ origin: connection.origin, apiKey: connection.apiKey, file, profile: bot.profile, conversation: bot.conversation });
          if (!alive.current) break;
          updateQueue(scope, (items) => items.map((entry) => entry.localId === item.localId ? { ...entry, status: "ready", attachment } : entry));
          report(true);
        } catch {
          if (!alive.current) break;
          updateQueue(scope, (items) => items.map((entry) => entry.localId === item.localId ? { ...entry, status: "error", error: "error.uploadFail" } : entry));
          report(false);
        }
      }
    })();
    const jobs = uploadJobs.current.get(scope) || new Set<Promise<void>>();
    jobs.add(job); uploadJobs.current.set(scope, jobs);
    void job.finally(() => jobs.delete(job));
  }
  async function submitTaskMessage() {
    if (submitLock.current || busyRef.current) return;
    const scope = composerScope.current;
    const newTask = panelRef.current === "new";
    submitLock.current = true; setWaitingUploads(true);
    try {
      const jobs = uploadJobs.current.get(scope);
      while (jobs?.size) await Promise.all([...jobs]);
      if (!alive.current || composerScope.current !== scope) return;
      const queued = queues.current.get(scope) || [];
      if (queued.some((item) => item.status !== "ready" || !item.attachment)) return;
      const attachments = queued.map((item) => item.attachment!);
      const text = draftRef.current.trim() || (attachments.length ? (en ? "Please process the attached files." : "請處理附加的檔案。") : "");
      if (!text) return;
      if (!newTask && selected?.status === "waiting_input" && attachments.length) { setError(true); return; }
      jumpTaskLatest();
      const signature = JSON.stringify([text, attachments.map((item) => item.id)]);
      if (replyRequests.current.get(scope)?.signature !== signature) replyRequests.current.set(scope, { signature, requestId: crypto.randomUUID() });
      const ok = newTask ? await create(text, attachments) : await taskAction(selected?.status === "waiting_input" ? "clarify" : "reply", { text, attachments, requestId: replyRequests.current.get(scope)!.requestId });
      if (ok) {
        transferQueueToSession(queued);
        updateQueue(scope, () => []);
        replyRequests.current.delete(scope);
        if (newTask || composerScope.current === scope) setDraft("");
      }
    } finally { submitLock.current = false; if (alive.current) setWaitingUploads(false); }
  }
  const title = panel === "login" ? (en ? "Dashboard sign-in" : "Dashboard 登入") : panel === "new" ? (en ? "New task" : "新增任務") : selected?.title || (en ? "Task" : "任務");
  const active = !!selected && ["preparing", "submitting", "running", "waiting_approval", "waiting_input", "disconnected", "unknown"].includes(selected.status);
  const taskMissing = selected?.error === "task_session_missing";
  const statusLabel = selected?.interruptRequested || stoppingTaskId === selected?.id ? (en ? "Stopping…" : "正在停止…") : taskStatusLabel(locale, selected?.status || "unknown");
  return <>
    <TaskManager open={panel === "manager"} name={bot.name} profile={bot.profile} swatch={bot.swatch} tasks={tasks} selectedTaskId={selectedId.current} locale={locale} onDelete={deleteTasks} onStop={(id) => void stopTask(id)} busy={busy} stoppingTaskId={stoppingTaskId} error={error ? (en ? "Unable to complete this request. Please try again." : "目前無法完成操作，請重試。") : undefined}
      onSelect={(id) => { if (selectedId.current !== id) { selectedId.current = id; setSelected(tasks.find((task) => task.id === id) ?? null); setDraft(""); } setError(false); show("detail"); }}
      onCreate={() => { setDraft(""); setError(false); show("new"); }} onClose={() => { if (panelRef.current === "manager") close(); }} />
    <Dialog.Root modal={!managerOverDetail} open={(panel !== null && panel !== "manager") || managerOverDetail} onOpenChange={(open) => { if (!open && panelRef.current !== "manager") close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/65 backdrop-blur-sm" />
        <Dialog.Content ref={sessionPanel} data-enter={animateEntry ? "true" : "false"} data-card-motion={cardMotion} onAnimationEnd={(event) => { if (event.target === event.currentTarget && event.animationName === "task-session-enter") setCardMotion((current) => current === "entering" ? "idle" : current); }} className="task-session-panel fixed inset-y-0 right-0 z-[111] flex w-full max-w-xl flex-col border-l border-border bg-bg text-fg shadow-panel outline-none" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "var(--app-safe-bottom, env(safe-area-inset-bottom))" }}
          onOpenAutoFocus={() => { focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (focusReturn.current?.isConnected && !focusReturn.current.matches("input, textarea, [contenteditable='true']")) focusReturn.current.focus({ preventScroll: true }); }}>
          <header className="chat-status-header chat-divider-bottom flex shrink-0 items-center gap-1 border-b border-border px-2 py-2 pr-2">
            <BotAvatar profile={bot.profile} swatch={bot.swatch} size={36} />
            <div className="min-w-0 flex-1 px-2"><Dialog.Title className="chat-title font-medium">{title}</Dialog.Title><Dialog.Description className="subhead-glyph truncate text-xs text-muted">{bot.name}</Dialog.Description></div>
            {authenticated && <button className={`${headerButton}${managerOverDetail ? " icon-toggle-active" : ""}`} aria-pressed={managerOverDetail} aria-label={en ? "Tasks" : "任務管理"} onClick={() => show("manager")}><ListTodo className="size-4" strokeWidth={1.8} /></button>}
            {inDetail && <button className={`${headerButton}${finding ? " icon-toggle-active text-accent" : " text-fg"}`} aria-label={t(locale, "chat.find")} aria-pressed={finding} onClick={toggleFinding}><Search className="size-4" strokeWidth={1.8} /></button>}
            <button className={headerButton} aria-label={en ? "Close" : "關閉"} onClick={close}><X className="size-4" strokeWidth={1.8} /></button>
          </header>
          {finding && inDetail && <div className="chat-divider-bottom flex shrink-0 items-center gap-1 border-b border-border px-2 py-1" role="search">
            <input type="search" autoComplete="off" autoFocus aria-label={t(locale, "chat.findPlaceholder")} placeholder={t(locale, "chat.findPlaceholder")} value={findQuery} onChange={event => { setFindQuery(event.target.value); setFindIndex(0); }} className="aiot-search-input min-h-11 min-w-0 flex-1 rounded-xl bg-bg-elevated px-3 text-sm outline-none" />
            <span className="min-w-8 text-center text-xs text-muted" role="status">{searchCountLabel(matchIndex, matches.length)}</span>
            <button className={headerButton} disabled={!matches.length} aria-label={t(locale, "chat.findPrev")} onClick={() => setFindIndex(nextMatchIndex(matchIndex, -1, matches.length))}><ChevronUp className="size-4" /></button>
            <button className={headerButton} disabled={!matches.length} aria-label={t(locale, "chat.findNext")} onClick={() => setFindIndex(nextMatchIndex(matchIndex, 1, matches.length))}><ChevronDown className="size-4" /></button>
            <button className={headerButton} aria-label={t(locale, "chat.findClose")} onClick={closeFinding}><X className="size-4" /></button>
          </div>}
          {inDetail && taskMissing && !error ? <p role="status" className="px-4 pt-3 text-sm text-muted">{attachmentErrors.task_session_missing[en ? 1 : 0]}</p> : null}
          {error && <p role="alert" className="px-4 pt-3 text-sm text-danger">{attachmentErrors[errorCode]?.[en ? 1 : 0] || (en ? "Unable to complete this request. Check your connection and try again." : "目前無法完成操作，請確認連線後重試。")}</p>}
          {panel === "login" ? <div className="space-y-4 overflow-y-auto p-5">
            <p className="text-sm leading-relaxed text-muted">{en ? "Sign in through the official Hermes Dashboard. AIOT does not collect your password." : "透過 Hermes 官方 Dashboard 登入，AIOT 不收取你的密碼。"}</p>
            {!localSetup ? <p className="text-sm">{en ? "Complete the first sign-in on the computer running AIOT, using its 127.0.0.1 address." : "首次登入請在部署 AIOT 的電腦上，以 127.0.0.1 網址開啟 AIOT 完成設定。"}</p> : <>
              <label className="block text-xs text-muted">{en ? "Dashboard HTTPS URL" : "Dashboard HTTPS 網址"}<input autoComplete="off" className="mt-2 w-full rounded-xl border border-border bg-bg-elevated p-3 text-sm text-fg" type="url" placeholder="https://dashboard.example.com" value={dashboardOrigin} onChange={(event) => setDashboardOrigin(event.target.value)} /></label>
              <label className="block text-xs text-muted">{en ? "Provider (optional)" : "登入提供者（選填）"}<input autoComplete="off" className="mt-2 w-full rounded-xl border border-border bg-bg-elevated p-3 text-sm text-fg" value={provider} onChange={(event) => setProvider(event.target.value)} /></label>
              <button className={`${button} w-full`} disabled={busy || !dashboardOrigin.trim()} onClick={() => void login()}>{en ? "Open official sign-in" : "開啟官方登入"}</button>
            </>}
            {authenticated && <><p role="status" className="text-sm text-ok">{en ? "Signed in. Your original message is still in the chat draft." : "已登入，原本的訊息仍保留在主對話草稿中。"}</p><button className={`${button} w-full`} onClick={() => show("manager")}>{en ? "Open tasks" : "開啟任務管理"}</button></>}
          </div> : <>
            <div className="relative min-h-0 flex-1">
            <div ref={messageLog} onClick={event => { if (findingRef.current && !(event.target as HTMLElement).closest("button,a,input,textarea")) closeFinding(); }} onScroll={(event) => { const el = event.currentTarget; followTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; measureTaskScroll(); }} className="h-full min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4" role="log" aria-label={en ? "Task messages" : "任務訊息"}>
              {inDetail && !(selected?.messages?.length) && <p className="py-8 text-center text-sm text-muted">{en ? "No messages yet." : "目前沒有訊息。"}</p>}
              {inDetail && selected?.messages?.map((message, index) => {
                const text = typeof message.content === "string" ? message.content : typeof message.text === "string" ? message.text : "";
                if ((!text && !message.attachments?.length) || !["user", "assistant"].includes(message.role)) return null;
                return <div data-task-message={index} key={message.id || index} className={`flex items-start gap-2 ${message.role === "user" ? "justify-end" : ""}`}>
                  {message.role === "assistant" && <BotAvatar profile={bot.profile} swatch={bot.swatch} size={28} />}
                  <div className={`relative min-w-0 max-w-[88%] rounded-2xl pl-4 pr-10 py-3 text-sm ${message.role === "user" ? "bg-user-bubble" : "bg-bg-elevated"}`}><Markdown query={finding ? findQuery : ""} text={text} locale={locale} />{!!message.attachments?.length && <div className="mt-2"><MessageAttachments attachments={message.attachments} origin={connection.origin} apiKey={connection.apiKey} locale={locale} align={message.role === "user" ? "end" : "start"} session={{ botId: bot.id, profile: bot.profile }} /></div>}<BubbleCopy text={text} locale={locale} /></div>
                </div>;
              })}
            </div>
            {inDetail && awayFromLatest && <button type="button" className="jump-latest" style={{ bottom: 12 }} aria-label={t(locale, "chat.jumpLatest")} onClick={jumpTaskLatest}><ChevronDown className="size-5" /></button>}
            </div>
            {inDetail && selected?.queuedTurns?.length ? <details className="mx-4 mb-2 rounded-xl border border-border bg-bg-elevated/80 px-3 py-2"><summary className="cursor-pointer text-xs text-muted">{en ? `Queue (${selected.queuedTurns.length})` : `佇列（${selected.queuedTurns.length}）`}</summary><ol className="mt-2 space-y-2">{selected.queuedTurns.map((item,index)=><li key={item.id} className="flex gap-2 text-xs"><span className="text-subtle">{index+1}</span><span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.text}{item.attachments?.length ? <span className="mt-1 block text-muted">{item.attachments.map(file=>file.name).join(" · ")}</span> : null}</span></li>)}</ol></details> : null}
            {inDetail && selected?.pendingApproval?.kind === "approval" ? <div className="space-y-2 border-t border-border p-4"><p className="text-sm">{en ? "This task needs approval." : "此任務需要你的批准。"}</p>{selected.pendingApproval.description || selected.pendingApproval.summary ? <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-sm text-muted">{localizeTaskNotice(locale, selected.pendingApproval.description || selected.pendingApproval.summary)}</p> : null}{selected.pendingApproval.command ? <>{localizeTaskNotice(locale, selected.pendingApproval.command) !== selected.pendingApproval.command ? <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-sm text-muted">{localizeTaskNotice(locale, selected.pendingApproval.command)}</p> : null}<div className="max-h-52 overflow-y-auto [&_.md-code]:m-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:font-mono [&_code]:text-xs"><CodeBlock text={selected.pendingApproval.command} lang="text" label={en ? "Original operation" : "原始操作內容"} locale={locale} /></div></> : null}{selected.pendingApproval.receivedAt && Number.isFinite(Date.parse(selected.pendingApproval.receivedAt)) ? <p className="text-xs text-muted">{en ? "Received: " : "收到時間："}{new Date(selected.pendingApproval.receivedAt).toLocaleString(en ? "en" : "zh-TW")}</p> : null}{approvalDeadlineLabels(locale, selected.pendingApproval).map((label) => <p key={label} className="text-xs text-muted">{label}</p>)}<div className="flex gap-2"><button className={`${button.replace("hover:bg-bg-hover", "hover:bg-[#829d90]")} bg-[#718d80] text-[#edf2ee]`} disabled={busy || (!!selected.pendingApproval.choices?.length && !selected.pendingApproval.choices.includes("once"))} onClick={() => void taskAction("approval", { decision: "once" })}>{en ? "Allow once" : "允許一次"}</button><button className={`${button} stop-btn`} disabled={busy || (!!selected.pendingApproval.choices?.length && !selected.pendingApproval.choices.includes("deny"))} onClick={() => void taskAction("approval", { decision: "deny" })}>{en ? "Deny" : "拒絕"}</button></div></div> : null}
            {selected?.pendingApproval?.kind === "clarify" && <p role="status" className="px-4 py-3 text-sm whitespace-pre-wrap">{localizeTaskNotice(locale, selected.pendingApproval.summary) || (en ? "Please answer the question to continue." : "請回答問題以繼續。")}</p>}
            {inDetail && selected?.todoState?.todos?.length ? <SessionPlan key={selected.id} task={selected} state={selected.todoState} locale={locale} /> : null}
            {inDetail && active && statusLabel ? <div className="roster-work-status flex items-center gap-2 border-t border-border px-4 py-2" role="status"><BotAvatar profile={bot.profile} swatch={bot.swatch} size={26} state={["preparing", "submitting", "running"].includes(selected?.status || "") ? "working" : "waiting"} /><span className="work-label text-xs text-muted"><span>{statusLabel}</span><span aria-hidden="true" className="work-label-glow">{statusLabel}</span></span></div> : null}
            <form className="chat-divider-top space-y-2 border-t border-border p-4" onSubmit={(event) => { event.preventDefault(); void submitTaskMessage(); }}>
              {uploadFeedback?.scope === composerScope.current && <UploadFeedback key={uploadFeedback.id} ok={uploadFeedback.ok} locale={locale} onDismiss={() => setUploadFeedback(null)} />}
              {!!queuedFiles.length && <ul className="flex flex-wrap gap-1.5">{queuedFiles.map((item) => <QueuePreview key={item.localId} item={{ ...item, error: localizeNotice(locale, item.error) }} locale={locale} onRemove={() => { if (submitLock.current) return; revokeQueuedPreview(item); updateQueue(composerScope.current, (items) => items.filter((entry) => entry.localId !== item.localId)); }} />)}</ul>}
              <textarea autoComplete="off" ref={taskTextarea} disabled={busy || waitingUploads || (inDetail && taskMissing)} aria-label={en ? "Task message" : "任務訊息"} placeholder={en ? "Write a task message…" : "輸入任務訊息…"} rows={1} className="block max-h-40 w-full resize-none overflow-y-auto rounded-xl border border-border bg-bg-elevated p-3 text-sm outline-none focus:border-border-strong" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <input ref={taskFileInput} type="file" hidden multiple accept="image/*,.pdf,.txt,.md,.doc,.docx" onChange={(event) => { pickTaskFiles(event.target.files); event.target.value = ""; }} />
              <div className="task-composer-actions flex items-center gap-2"><ComposerAttachmentButton disabled={busy || waitingUploads || (inDetail && taskMissing) || queuedFiles.length >= MAX_ATTACHMENTS} aria-label={en ? "Attach files" : "附加檔案"} onClick={() => taskFileInput.current?.click()} /><div className="task-context-slot">{selected?.mode === "fork" && inDetail ? <TaskContextCard key={selected.id} count={selected.contextCount || 0} snapshot={selected.contextSnapshot} locale={locale} name={bot.name} profile={bot.profile} swatch={bot.swatch} /> : <span className="task-context-badge">{en ? "Independent task" : "獨立任務"}</span>}</div>{inDetail && active && !draft.trim() && !queuedFiles.length ? <button type="button" className="stop-btn grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-xl disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent" disabled={busy || selected?.interruptRequested || stoppingTaskId === selected?.id} aria-label={selected?.interruptRequested || stoppingTaskId === selected?.id ? (en ? "Stopping task" : "正在停止任務") : (en ? "Stop task" : "停止任務")} onClick={() => void taskAction("interrupt")}><Square className="size-3.5 fill-current" aria-hidden="true" /></button> : <ComposerSendButton loading={waitingUploads} disabled={busy || waitingUploads || (inDetail && taskMissing) || (!draft.trim() && !queuedFiles.length) || (inDetail && !selected)} aria-label={waitingUploads ? (en ? "Waiting for uploads" : "等待附件上傳完成") : (en ? "Send" : "傳送")} />}</div>
            </form>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
});
