import { createUploadBatch } from "@/lib/upload-batch";
import { UploadFeedback } from "./upload-feedback";
import { localizeSystemNotice } from "@/lib/system-notice";
import { usePullRefresh } from "@/lib/pull-refresh";
import { ScheduleDock, type ScheduleDockHandle } from "./schedule-dock";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, LoaderCircle, Paperclip, Pin, Search, SendHorizontal, Square, X } from "lucide-react";
import { BotAvatar, WorkTicker } from "./bot-avatar";
import { MessageAttachments, QueuePreview } from "./attachment-media";
import { CompletionMenu } from "./completion-menu";
import { ApprovalCardView } from "./approval-card";
import { ApprovalDock, type ApprovalDockHandle } from "./approval-dock";
import { BubbleCopy } from "./bubble-copy";
import {
  canUploadAttachments,
  fileKindError,
  maxAttachmentBytes,
  MAX_ATTACHMENTS,
  postBotUpload,
} from "@/lib/attachments";
import {
  createPreviewUrl,
  queueFromFile,
  revokeQueuedPreview,
  transferQueueToSession,
  type QueuedAttachment,
} from "@/lib/attachment-preview";
import {
  applyCompletionInsert,
  canUseDynamicCompletions,
  COMPLETION_DEBOUNCE_MS,
  completionCaretPosition,
  createCompletionCache,
  detectCompletionToken,
  filterCompletionItems,
  moveCompletionIndex,
  type CompletionItem,
  type CompletionToken,
} from "@/lib/completions";
import { completionMenuAction, isComposingKey, isTurnBusy, shouldSendOnEnter } from "@/lib/composer";
import { canInterrupt, interruptAccepted } from "@/lib/interrupt";
import { postBotCompletions, postBotInterrupt } from "@/lib/native-bot";
import { sendTask } from "@/lib/send-task";
import { sentenceBubbles } from "@/lib/sentence-bubbles";
import { Markdown } from "@/lib/markdown";
import { useDesk } from "@/lib/store";
import { botPresenceOnline, connectionLive, isUnauthorizedError, isUnauthorizedStatus, OFFLINE_STATUS_CLASS, resolveCredentialGate } from "@/lib/credential-gate";
import { localizeNotice, resolveLocale, t } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { findMessageMatches, nextMatchIndex, searchCountLabel } from "@/lib/chat-search";
import { jumpLatestBottomPx, transcriptAwayFromBottom } from "@/lib/jump-latest";
import { backToRoster, closeSearchHistory, historySearchOpen, pushSearchHistory } from "@/lib/app-history";

export function ChatView() {
  const activeBotId = useDesk((s) => s.activeBotId);
  const currentView = useDesk((s) => s.view);
  useEffect(() => {
    const read = () => {
      const state = useDesk.getState();
      if (activeBotId && state.view === "chat" && document.visibilityState === "visible") state.markRead(activeBotId);
    };
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [activeBotId, currentView]);
  const bots = useDesk((s) => s.bots);
  const messages = useDesk((s) => s.messages);
  const botState = useDesk((s) => s.botState);
  const drafts = useDesk((s) => s.composerDrafts);
  const setDraft = useDesk((s) => s.setDraft);
  const setView = useDesk((s) => s.setView);
  const pinBot = useDesk((s) => s.pinBot);
  const sendingMap = useDesk((s) => s.sending);
  const connection = useDesk((s) => s.connection);
  const locale = resolveLocale(useDesk((s) => s.locale));
  const pull = usePullRefresh();
  const approvals = useDesk((s) => s.approvals);
  const scheduleDockRef = useRef<ScheduleDockHandle>(null);
  const approvalDockRef = useRef<ApprovalDockHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const lastScrollTop = useRef(0);
  const searchingRef = useRef(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const chipsRef = useRef<QueuedAttachment[]>([]);
  const cacheRef = useRef(createCompletionCache());
  const abortRef = useRef<AbortController | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const tokenRef = useRef<CompletionToken | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<{ id: string; ok: boolean } | null>(null);
  const [chips, setChipsState] = useState<QueuedAttachment[]>([]);
  const uploadJobs = useRef(new Set<Promise<void>>());
  const submitLock = useRef(false);
  const [waitingUploads, setWaitingUploads] = useState(false);
  function setChips(update: QueuedAttachment[] | ((previous: QueuedAttachment[]) => QueuedAttachment[])) {
    const next = typeof update === "function" ? update(chipsRef.current) : update;
    chipsRef.current = next;
    setChipsState(next);
  }
  const [cursor, setCursor] = useState(0);
  const [suggest, setSuggest] = useState<CompletionItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [finding, setFinding] = useState(false);
  searchingRef.current = finding;
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [away, setAway] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);

  const bot = bots.find((b) => b.id === activeBotId);
  const thread = messages.filter((m) => m.botId === activeBotId);
  const state = bot ? (botState[bot.id] ?? "idle") : "idle";
  const draft = bot ? (drafts[bot.id] ?? "") : "";
  const working = state === "working";
  const sending = bot ? Boolean(sendingMap[bot.id]) : false;
  const blocked = bot ? isTurnBusy(state, sending) : true;
  const live = connectionLive(connection);
  const gate = resolveCredentialGate(connection);
  const presenceOnline = bot ? botPresenceOnline({ live, available: bot.available }) : false;
  const caps = live ? connection.lastProbe?.capabilities : undefined;
  const uploadsOn = canUploadAttachments(caps);
  const uploadError = chips.some((c) => c.status === "error");
  const completionsOn = live && (canUseDynamicCompletions(caps) || bot?.nativeCapabilities?.skills === true) && Boolean(bot?.conversation);
  const interruptsOn = live && (canInterrupt(caps) || bot?.nativeCapabilities?.run_stop === true);
  const liveToken = completionsOn && bot ? detectCompletionToken(draft, cursor) : null;
  const threadApprovals = bot
    ? approvals.filter((card) => card.profile === bot.profile && card.conversation === bot.conversation)
    : [];
  const menuOpen = Boolean(liveToken && suggest.length > 0);
  const matches = findMessageMatches(
    thread.map((m) => ({ id: m.messageId || m.id, content: m.content })),
    finding ? findQuery : "",
  );
  const matchId = matches[findIndex] ?? "";
  const searchQuery = finding ? findQuery : "";

  useEffect(() => {
    for (const item of chipsRef.current) revokeQueuedPreview(item);
    setChips([]);
    setFinding(false);
    setFindQuery("");
    setFindIndex(0);
    setAway(false);
  }, [bot?.id]);

  useEffect(() => {
    return () => {
      for (const item of chipsRef.current) revokeQueuedPreview(item);
    };
  }, []);

  // Preserve the user's pre-update position; measuring after an append mistakes
  // new content height for the user having scrolled away from the bottom.
  useLayoutEffect(() => {
    followLatest.current = true;
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTop.current = el.scrollTop;
    setAway(false);
  }, [bot?.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !followLatest.current || finding) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTop.current = el.scrollTop;
    setAway(false);
  }, [bot?.id, thread.length, thread.at(-1)?.content, working, chips.length, threadApprovals.length, finding]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const isAway = transcriptAwayFromBottom(el);
      if (searchingRef.current || el.scrollTop < lastScrollTop.current - 1) {
        followLatest.current = !isAway && !searchingRef.current;
      } else if (!isAway) followLatest.current = !searchingRef.current;
      lastScrollTop.current = el.scrollTop;
      setAway(isAway);
    };
    // Images, fonts, approval cards and the mobile keyboard can resize after
    // React's render. Follow only while the user was already reading latest.
    const resized = () => {
      if (followLatest.current && !searchingRef.current) {
        el.scrollTop = el.scrollHeight;
        lastScrollTop.current = el.scrollTop;
        setAway(false);
      } else setAway(transcriptAwayFromBottom(el));
    };
    const observer = new ResizeObserver(resized);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [bot?.id, thread.length === 0 && threadApprovals.length === 0]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const measure = () => setComposerHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro.disconnect();
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [bot?.id, working, chips.length, menuOpen, finding]);

  useEffect(() => {
    if (!finding || !matchId) return;
    const root = scroller.current;
    if (!root) return;
    const node = root.querySelector(`[data-msg-id="${CSS.escape(matchId)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [finding, matchId]);

  useEffect(() => {
    cacheRef.current.clear();
    abortRef.current?.abort();
    setSuggest([]);
    tokenRef.current = null;
  }, [bot?.profile, bot?.conversation, connection.origin]);

  useEffect(() => {
    if (!working) setStopping(false);
  }, [working]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (finding && !historySearchOpen(event.state)) {
        setFinding(false);
        setFindQuery("");
        setFindIndex(0);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [finding]);

  useEffect(() => {
    if (!completionsOn || !bot) {
      setSuggest([]);
      tokenRef.current = null;
      return;
    }
    const token = detectCompletionToken(draft, cursor);
    tokenRef.current = token;
    if (!token) {
      setSuggest([]);
      return;
    }
    const key = {
      origin: connection.origin,
      profile: bot.profile,
      conversation: bot.conversation,
      trigger: token.trigger,
      query: token.query,
    };
    const cached = cacheRef.current.read(key);
    if (cached) {
      const items = filterCompletionItems(cached, token.trigger, token.query);
      setSuggest(items);
      setActiveIndex((i) => (i < items.length ? i : 0));
      return;
    }
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      void postBotCompletions({
        origin: connection.origin,
        apiKey: connection.apiKey,
        profile: bot.profile,
        conversation: bot.conversation,
        trigger: token.trigger,
        query: token.query,
        signal: abort.signal,
      })
        .then((items) => {
          if (abort.signal.aborted) return;
          cacheRef.current.write(key, items);
          setSuggest(filterCompletionItems(items, token.trigger, token.query));
          setActiveIndex(0);
        })
        .catch(() => {
          if (!abort.signal.aborted) setSuggest([]);
        });
    }, COMPLETION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [completionsOn, draft, cursor, bot?.profile, bot?.conversation, connection.origin, connection.apiKey]);

  if (!bot) {
    return <div className="grid h-full min-h-0 place-items-center text-sm text-muted">{t(locale, "chat.pick")}</div>;
  }

  const botId = bot.id;
  const placeholder = bot.available
    ? t(locale, "chat.placeholder", { name: bot.name })
    : t(locale, "chat.offlinePlaceholder");

  function applySuggestion(item: CompletionItem) {
    const token = detectCompletionToken(draft, cursor) ?? tokenRef.current;
    if (!token) return;
    const next = applyCompletionInsert(draft, token, item);
    setDraft(botId, next.text);
    setCursor(next.cursor);
    setSuggest([]);
    const place = () => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
    };
    requestAnimationFrame(() => requestAnimationFrame(place));
  }

  function syncCursor(el: HTMLTextAreaElement | null) {
    if (!el) return;
    setCursor(completionCaretPosition(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0));
  }

  function stepMatch(delta: number) {
    setFindIndex((i) => nextMatchIndex(i, delta, matches.length));
  }

  function jumpLatest() {
    const el = scroller.current;
    if (!el) return;
    followLatest.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function closeFinding() {
    setFinding(false);
    setFindQuery("");
    setFindIndex(0);
    closeSearchHistory();
  }

  function leaveChat() {
    if (finding) { closeFinding(); return; }
    if (scheduleDockRef.current?.collapse()) return;
    if (approvalDockRef.current?.collapse()) return;
    backToRoster(() => setView("roster"));
  }

  async function interruptTurn() {
    if (!interruptsOn || stopping) return;
    const latest = useDesk.getState();
    const current = latest.bots.find((b) => b.id === botId);
    if (!current?.profile || !current.conversation) return;
    if (!connectionLive(latest.connection)) return;
    if (latest.botState[botId] !== "working") return;
    setStopping(true);
    try {
      const res = await postBotInterrupt({
        origin: latest.connection.origin,
        apiKey: latest.connection.apiKey,
        profile: current.profile,
        conversation: current.conversation,
      });
      if (isUnauthorizedStatus(res.status)) {
        useDesk.getState().markDisconnected();
        return;
      }
      if (!interruptAccepted(res.status)) setStopping(false);
    } catch (err) {
      if (isUnauthorizedError(err)) useDesk.getState().markDisconnected();
      setStopping(false);
    }
  }

  async function submit() {
    if (submitLock.current) return;
    submitLock.current = true;
    const started = useDesk.getState().connection;
    try {
      if (uploadJobs.current.size) {
        setWaitingUploads(true);
        while (uploadJobs.current.size) await Promise.all([...uploadJobs.current]);
      }
      const afterUpload = useDesk.getState();
      if (afterUpload.activeBotId !== botId || afterUpload.view !== "chat" ||
          afterUpload.connection.origin !== started.origin || afterUpload.connection.apiKey !== started.apiKey) return;
      const latest = useDesk.getState();
      const current = latest.bots.find((b) => b.id === botId);
      if (!current?.available || !current.conversation) return;
      if (!connectionLive(latest.connection)) return;
      if (isTurnBusy(latest.botState[botId], Boolean(latest.sending[botId]))) return;
      if (chipsRef.current.some((item) => item.status !== "ready" || !item.attachment)) return;
      const value = (latest.composerDrafts[botId] ?? "").trim();
      const queued = chipsRef.current;
      const ids = queued.filter((c) => c.status === "ready" && c.attachment).map((c) => c.attachment!.id);
      const meta = queued.filter((c) => c.status === "ready" && c.attachment).map((c) => c.attachment!);
      if (!value && ids.length === 0) return;
      // Sending is the user's explicit navigation action. Apply it now, not when
      // a slow acknowledgement arrives after they may have scrolled elsewhere.
      followLatest.current = true;
      closeFinding();
      const pinSendStart = () => {
        if (useDesk.getState().activeBotId !== botId) return;
        const el = scroller.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        lastScrollTop.current = el.scrollTop;
        setAway(false);
      };
      pinSendStart();
      requestAnimationFrame(pinSendStart);
      const ok = await sendTask(botId, value, ids, meta);
      if (ok) {
        transferQueueToSession(queued);
        setChips([]);
        setSuggest([]);
      }
    } finally {
      submitLock.current = false;
      setWaitingUploads(false);
    }
  }

  function onPick(files: FileList | null) {
    if (submitLock.current) return;
    const job = uploadPickedFiles(files);
    uploadJobs.current.add(job);
    void job.finally(() => uploadJobs.current.delete(job));
  }

  async function uploadPickedFiles(files: FileList | null) {
    if (!uploadsOn || !files || !bot) return;
    const latest = useDesk.getState();
    const current = latest.bots.find((b) => b.id === botId);
    const conversation = current?.conversation ?? "";
    if (!conversation) return;
    const origin = latest.connection.origin;
    const apiKey = latest.connection.apiKey;
    const limit = maxAttachmentBytes(caps);
    const room = MAX_ATTACHMENTS - chipsRef.current.length;
    const picked = [...files].slice(0, Math.max(0, room));
    const finish = createUploadBatch(picked.length);
    const batchId = crypto.randomUUID();
    const report = (ok: boolean) => {
      const result = finish(ok);
      if (result) setUploadFeedback({ id: batchId, ok: result === "success" });
    };
    for (const file of picked) {
      const localId = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
      const kind = fileKindError(file);
      const previewUrl = createPreviewUrl(file, { name: file.name, type: file.type });
      if (kind) {
        report(false);
        setChips((prev) => [
          ...prev,
          { ...queueFromFile(file, localId, previewUrl), status: "error", error: localizeNotice(locale, kind) },
        ]);
        continue;
      }
      if (file.size > limit) {
        report(false);
        setChips((prev) => [
          ...prev,
          { ...queueFromFile(file, localId, previewUrl), status: "error", error: t(locale, "error.fileTooBig") },
        ]);
        continue;
      }
      setChips((prev) => [...prev, queueFromFile(file, localId, previewUrl)]);
      try {
        const attachment = await postBotUpload({
          origin,
          apiKey,
          file,
          profile: bot.profile,
          conversation,
        });
        report(true);
        setChips((prev) =>
          prev.map((c) => (c.localId === localId ? { ...c, status: "ready", attachment } : c)),
        );
      } catch {
        report(false);
        setChips((prev) =>
          prev.map((c) => (c.localId === localId ? { ...c, status: "error", error: t(locale, "error.uploadFail") } : c)),
        );
      }
    }
  }

  const canSend =
    (draft.trim().length > 0 || chips.length > 0) &&
    !blocked &&
    !waitingUploads &&
    !uploadError &&
    bot.available &&
    live &&
    Boolean(bot.conversation);
  const showStop = interruptsOn && working;
  const token = liveToken;

  return (
    <section
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg"
      onTouchStart={(event) => {
        const touch = event.touches[0];
        swipeStart.current = touch && touch.clientX <= 28 ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const start = swipeStart.current;
        swipeStart.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) return;
        if (touch.clientX - start.x >= 72 && Math.abs(touch.clientY - start.y) <= 64) leaveChat();
      }}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2 pr-2">
        <button
          type="button"
          onClick={leaveChat}
          className="grid size-11 place-items-center rounded-lg text-fg hover:bg-bg-elevated md:hidden"
          aria-label={t(locale, "chat.back")}
        >
          <ChevronLeft className="size-5" />
        </button>
        <BotAvatar swatch={bot.swatch} profile={bot.profile} state={state} size={36} />
        <div className="min-w-0 flex-1 px-2">
          <p className="chat-title font-medium">{bot.name}</p>
          <p className={cn("subhead-glyph truncate text-xs", presenceOnline ? "status-online" : OFFLINE_STATUS_CLASS)}>
            {presenceOnline ? <span className="presence-dot" aria-hidden="true" /> : null}
            {working ? t(locale, "chat.workingBar", { name: bot.name }) : presenceOnline ? t(locale, "status.online") : t(locale, "status.offline")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (finding) closeFinding();
            else {
              pushSearchHistory();
              setFinding(true);
            }
          }}
          className={cn(
            "icon-toggle grid size-11 place-items-center rounded-lg hover:bg-bg-elevated",
            finding ? "icon-toggle-active text-accent" : "text-fg",
          )}
          aria-label={t(locale, "chat.find")}
          aria-pressed={finding}
        >
          <Search className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => pinBot(bot.id)}
          className={cn(
            "icon-toggle grid size-11 place-items-center rounded-lg hover:bg-bg-elevated",
            bot.pinned ? "icon-toggle-active text-accent" : "text-fg",
          )}
          aria-label={t(locale, "chat.pin")}
          aria-pressed={bot.pinned}
        >
          <Pin className="size-4" strokeWidth={1.8} />
        </button>
      </header>

      {finding ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          <input
            value={findQuery}
            autoFocus
            onChange={(e) => {
              setFindQuery(e.target.value);
              setFindIndex(0);
            }}
            placeholder={t(locale, "chat.findPlaceholder")}
            className="min-h-11 flex-1 rounded-xl bg-bg-elevated px-3 text-sm text-fg outline-none placeholder:text-subtle"
          />
          <span className="min-w-10 px-1 text-center text-xs text-muted">{searchCountLabel(findIndex, matches.length)}</span>
          <button
            type="button"
            onClick={() => stepMatch(-1)}
            disabled={matches.length === 0}
            className="grid size-11 place-items-center rounded-lg text-fg hover:bg-bg-elevated disabled:opacity-40"
            aria-label={t(locale, "chat.findPrev")}
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => stepMatch(1)}
            disabled={matches.length === 0}
            className="grid size-11 place-items-center rounded-lg text-fg hover:bg-bg-elevated disabled:opacity-40"
            aria-label={t(locale, "chat.findNext")}
          >
            <ChevronDown className="size-4" />
          </button>
          <button
            type="button"
            onClick={closeFinding}
            className="grid size-11 place-items-center rounded-lg text-fg hover:bg-bg-elevated"
            aria-label={t(locale, "chat.findClose")}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {gate.missingKey ? (
        <button
          type="button"
          onClick={() => setView("settings")}
          className="shrink-0 border-b border-border bg-bg-elevated px-4 py-2 text-left text-xs text-danger"
        >
          {t(locale, "error.missingKey")}
        </button>
      ) : null}

      <div ref={scroller} {...pull.handlers} onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
        if (finding) closeFinding();
        else if (!scheduleDockRef.current?.collapse()) approvalDockRef.current?.collapse();
      }} className="chat-transcript min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {pull.distance > 20 && <div role="status" className="text-center text-xs text-subtle py-2">{locale === "en" ? (pull.distance >= 90 ? "Release to refresh" : "Pull to refresh") : (pull.distance >= 90 ? "放開即可重新整理" : "下拉重新整理")}</div>}
        {thread.length === 0 && threadApprovals.length === 0 ? (
          <div className="mx-auto max-w-md pt-8">
            <p className="title-glyph font-display text-2xl font-semibold">
              {t(locale, "chat.emptyTitle", { name: bot.name })}
            </p>
            <p className="hermes-copy mt-2 text-sm text-muted">{t(locale, "chat.emptyBody")}</p>
          </div>
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-3">
            {thread.map((m) => (
              <li
                key={m.messageId || m.id}
                data-msg-id={m.messageId || m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start", m.role === "assistant" && !sentenceBubbles(m.content, m.streaming === true).length && !m.attachments?.length && "hidden")}
              >
                {m.role === "assistant" ? (
                  <div className="assistant-bubble sentence-bubble relative min-w-0 max-w-[92%] rounded-[20px] rounded-bl-sm bg-bg-elevated pl-4 pr-10 py-2.5 text-[0.95rem] leading-relaxed text-fg">
                    <Markdown text={localizeSystemNotice(sentenceBubbles(m.content, m.streaming === true).join(""), locale)} query={searchQuery} locale={locale} />
                    <BubbleCopy text={localizeSystemNotice(sentenceBubbles(m.content, m.streaming === true).join(""), locale)} locale={locale} />
                    {m.attachments && m.attachments.length > 0 ? (
                      <div className="mt-2">
                        <MessageAttachments
                          attachments={m.attachments}
                          origin={connection.origin}
                          apiKey={connection.apiKey}
                          locale={locale}
                          align="start"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="relative min-w-0 max-w-[78%] rounded-[20px] rounded-br-sm bg-user-bubble pl-4 pr-10 py-2.5 text-[0.95rem] leading-relaxed">
                    {m.content ? <Markdown text={m.content} query={searchQuery} locale={locale} /> : null}
                    {m.attachments && m.attachments.length > 0 ? (
                      <div className={m.content ? "mt-2" : ""}>
                        <MessageAttachments
                          attachments={m.attachments}
                          origin={connection.origin}
                          apiKey={connection.apiKey}
                          locale={locale}
                          align="end"
                        />
                      </div>
                    ) : null}
                    <BubbleCopy text={m.content} locale={locale} />
                  </div>
                )}
              </li>
            ))}
            {threadApprovals.filter((card) => !card.hidden && !["pending", "submitting", "error"].includes(card.status)).map((card) => (
              <li key={card.requestId}>
                <ApprovalCardView card={card} locale={locale} swatch={bot.swatch} profile={bot.profile} />
              </li>
            ))}
          </ol>
        )}
      </div>

      {away ? (
        <button
          type="button"
          className="jump-latest"
          style={{ bottom: jumpLatestBottomPx(composerHeight) }}
          aria-label={t(locale, "chat.jumpLatest")}
          onClick={jumpLatest}
        >
          <ChevronDown className="size-5" />
        </button>
      ) : null}

      <div ref={composerRef} className="composer-dock shrink-0">
        {working && !threadApprovals.some((card) => ["pending", "submitting", "error"].includes(card.status)) ? (
          <div className="mx-auto w-full max-w-2xl px-3 pt-3 pb-1" role="status">
            <WorkTicker swatch={bot.swatch} label={t(locale, "chat.workingBar", { name: bot.name })} className="w-full" />
          </div>
        ) : null}
        {live && <ScheduleDock key={`schedule-${connection.origin}-${bot.profile}-${bot.id}`} ref={scheduleDockRef} profile={bot.profile} name={bot.name} swatch={bot.swatch} origin={connection.origin} apiKey={connection.apiKey} locale={locale} />}
        <ApprovalDock
          key={bot.id}
          ref={approvalDockRef}
          name={bot.name}
          profile={bot.profile}
          swatch={bot.swatch}
          working={working}
          approvals={threadApprovals}
          locale={locale}
          canStop={interruptsOn}
          stopping={stopping}
          onStop={() => void interruptTurn()}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={cn("shrink-0 px-3 pt-2 pb-2", working ? "" : "border-t border-border")}
        >
          {uploadFeedback && <UploadFeedback key={uploadFeedback.id} ok={uploadFeedback.ok} locale={locale} onDismiss={() => setUploadFeedback(null)} />}
          {chips.length > 0 ? (
            <ul className="mx-auto mb-2 flex max-w-2xl flex-wrap gap-1.5">
              {chips.map((c) => (
                <QueuePreview
                  key={c.localId}
                  item={c}
                  locale={locale}
                  onRemove={() => {
                    revokeQueuedPreview(c);
                    setChips((prev) => prev.filter((x) => x.localId !== c.localId));
                  }}
                />
              ))}
            </ul>
          ) : null}
          {menuOpen && token ? (
            <CompletionMenu
              items={suggest}
              index={activeIndex}
              trigger={token.trigger}
              locale={locale}
              onHover={setActiveIndex}
              onSelect={applySuggestion}
            />
          ) : null}
          <div className="mx-auto flex max-w-2xl items-end gap-2 py-2">
            {uploadsOn ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  accept="image/*,.pdf,.txt,.md,.doc,.docx"
                  onChange={(e) => {
                    void onPick(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={!live || !bot.available || !bot.conversation || chips.length >= MAX_ATTACHMENTS || blocked || waitingUploads}
                  onClick={() => fileRef.current?.click()}
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-bg-elevated text-fg disabled:opacity-40"
                  aria-label={t(locale, "chat.attach")}
                >
                  <Paperclip className="size-4" />
                </button>
              </>
            ) : null}
            <textarea
              ref={areaRef}
              key={botId}
              value={draft}
              rows={1}
              disabled={!live || !bot.available || blocked}
              onChange={(e) => {
                const el = e.target;
                setDraft(botId, el.value);
                syncCursor(el);
                requestAnimationFrame(() => syncCursor(el));
              }}
              onClick={(e) => syncCursor(e.currentTarget)}
              onSelect={(e) => syncCursor(e.currentTarget)}
              onKeyUp={(e) => syncCursor(e.currentTarget)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionUpdate={(e) => {
                syncCursor(e.currentTarget);
              }}
              onCompositionEnd={(e) => {
                composing.current = false;
                syncCursor(e.currentTarget);
                requestAnimationFrame(() => syncCursor(e.currentTarget));
              }}
              onKeyDown={(e) => {
                const payload = {
                  key: e.key,
                  shiftKey: e.shiftKey,
                  repeat: e.repeat,
                  isComposing: e.nativeEvent.isComposing,
                  keyCode: e.keyCode,
                  nativeEvent: { isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode },
                };
                if (isComposingKey(payload, composing.current)) return;
                const action = completionMenuAction(payload, composing.current, menuOpen);
                if (action === "next") {
                  e.preventDefault();
                  setActiveIndex((i) => moveCompletionIndex(i, 1, suggest.length));
                  return;
                }
                if (action === "prev") {
                  e.preventDefault();
                  setActiveIndex((i) => moveCompletionIndex(i, -1, suggest.length));
                  return;
                }
                if (action === "close") {
                  e.preventDefault();
                  setSuggest([]);
                  return;
                }
                if (action === "select") {
                  e.preventDefault();
                  const item = suggest[activeIndex];
                  if (item) applySuggestion(item);
                  return;
                }
                if (e.key !== "Enter") return;
                if (e.shiftKey) return;
                if (!shouldSendOnEnter(payload, composing.current, menuOpen)) return;
                e.preventDefault();
                void submit();
              }}
              placeholder={placeholder}
              enterKeyHint="send"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="max-h-32 min-h-11 flex-1 resize-none rounded-xl bg-bg-elevated px-4 py-2.5 text-sm leading-relaxed text-fg outline-none placeholder:text-subtle disabled:opacity-50"
            />
            {showStop ? (
              <button
                type="button"
                disabled={stopping}
                onClick={() => void interruptTurn()}
                className="stop-btn grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-xl disabled:opacity-40"
                aria-label={t(locale, "chat.stop")}
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-xl bg-accent text-accent-fg disabled:opacity-40"
                aria-label={waitingUploads ? (locale === "en" ? "Waiting for uploads" : "等待附件上傳完成") : t(locale, "chat.send")}
              >
                {waitingUploads ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
