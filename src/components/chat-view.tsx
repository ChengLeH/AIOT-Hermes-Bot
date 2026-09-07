import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, Paperclip, Pin, Search, SendHorizontal, Square, X } from "lucide-react";
import { BotAvatar } from "./bot-avatar";
import { MessageAttachments, QueuePreview } from "./attachment-media";
import { CompletionMenu } from "./completion-menu";
import { ApprovalCardView } from "./approval-card";
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
import { Markdown } from "@/lib/markdown";
import { useDesk } from "@/lib/store";
import { botPresenceOnline, connectionLive, isUnauthorizedError, isUnauthorizedStatus, OFFLINE_STATUS_CLASS, resolveCredentialGate } from "@/lib/credential-gate";
import { localizeNotice, resolveLocale, t } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { findMessageMatches, nextMatchIndex, searchCountLabel } from "@/lib/chat-search";
import { jumpLatestBottomPx, transcriptAwayFromBottom } from "@/lib/jump-latest";

export function ChatView() {
  const activeBotId = useDesk((s) => s.activeBotId);
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
  const approvals = useDesk((s) => s.approvals);
  const scroller = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const chipsRef = useRef<QueuedAttachment[]>([]);
  const cacheRef = useRef(createCompletionCache());
  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef<CompletionToken | null>(null);
  const [chips, setChips] = useState<QueuedAttachment[]>([]);
  const [cursor, setCursor] = useState(0);
  const [suggest, setSuggest] = useState<CompletionItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [finding, setFinding] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [away, setAway] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  chipsRef.current = chips;

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
  const uploading = chips.some((c) => c.status === "uploading");
  const uploadError = chips.some((c) => c.status === "error");
  const readyIds = chips.filter((c) => c.status === "ready" && c.attachment).map((c) => c.attachment!.id);
  const completionsOn = live && canUseDynamicCompletions(caps) && Boolean(bot?.conversation);
  const interruptsOn = live && canInterrupt(caps);
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

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (transcriptAwayFromBottom(el)) {
      setAway(true);
      return;
    }
    el.scrollTop = el.scrollHeight;
    setAway(false);
  }, [thread.length, thread.at(-1)?.content, working, chips.length, threadApprovals.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setAway(transcriptAwayFromBottom(el));
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [bot?.id]);

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
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
    const latest = useDesk.getState();
    const current = latest.bots.find((b) => b.id === botId);
    if (!current?.available || !current.conversation) return;
    if (!connectionLive(latest.connection)) return;
    if (isTurnBusy(latest.botState[botId], Boolean(latest.sending[botId]))) return;
    if (uploading || uploadError) return;
    const value = (latest.composerDrafts[botId] ?? "").trim();
    const queued = chipsRef.current;
    const ids = queued.filter((c) => c.status === "ready" && c.attachment).map((c) => c.attachment!.id);
    const meta = queued.filter((c) => c.status === "ready" && c.attachment).map((c) => c.attachment!);
    if (!value && ids.length === 0) return;
    const ok = await sendTask(botId, value, ids, meta);
    if (ok) {
      transferQueueToSession(queued);
      setChips([]);
      setSuggest([]);
    }
  }

  async function onPick(files: FileList | null) {
    if (!uploadsOn || !files || !bot) return;
    const latest = useDesk.getState();
    const current = latest.bots.find((b) => b.id === botId);
    const conversation = current?.conversation ?? "";
    if (!conversation) return;
    const origin = latest.connection.origin;
    const apiKey = latest.connection.apiKey;
    const limit = maxAttachmentBytes(caps);
    const room = MAX_ATTACHMENTS - chips.length;
    const picked = [...files].slice(0, Math.max(0, room));
    for (const file of picked) {
      const localId = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
      const kind = fileKindError(file);
      const previewUrl = createPreviewUrl(file, { name: file.name, type: file.type });
      if (kind) {
        setChips((prev) => [
          ...prev,
          { ...queueFromFile(file, localId, previewUrl), status: "error", error: localizeNotice(locale, kind) },
        ]);
        continue;
      }
      if (file.size > limit) {
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
        setChips((prev) =>
          prev.map((c) => (c.localId === localId ? { ...c, status: "ready", attachment } : c)),
        );
      } catch {
        setChips((prev) =>
          prev.map((c) => (c.localId === localId ? { ...c, status: "error", error: t(locale, "error.uploadFail") } : c)),
        );
      }
    }
  }

  const canSend =
    (draft.trim().length > 0 || readyIds.length > 0) &&
    !blocked &&
    !uploading &&
    !uploadError &&
    bot.available &&
    live &&
    Boolean(bot.conversation);
  const showStop = interruptsOn && working;
  const token = liveToken;

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2 pr-2">
        <button
          type="button"
          onClick={() => setView("roster")}
          className="grid size-11 place-items-center rounded-lg text-fg hover:bg-bg-elevated md:hidden"
          aria-label={t(locale, "chat.back")}
        >
          <ChevronLeft className="size-5" />
        </button>
        <BotAvatar swatch={bot.swatch} profile={bot.profile} state={state} size={36} />
        <div className="min-w-0 flex-1 px-2">
          <p className="chat-title font-medium">{bot.name}</p>
          <p className={cn("subhead-glyph truncate text-xs", presenceOnline || working ? "text-muted" : OFFLINE_STATUS_CLASS)}>
            {working ? t(locale, "chat.workingBar", { name: bot.name }) : presenceOnline ? t(locale, "status.online") : t(locale, "status.offline")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFinding((open) => {
              if (open) {
                setFindQuery("");
                setFindIndex(0);
              }
              return !open;
            });
          }}
          className={cn(
            "grid size-11 place-items-center rounded-lg hover:bg-bg-elevated",
            finding ? "text-accent" : "text-fg",
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
            "grid size-11 place-items-center rounded-lg hover:bg-bg-elevated",
            bot.pinned ? "text-accent" : "text-fg",
          )}
          aria-label={t(locale, "chat.pin")}
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
            onClick={() => {
              setFinding(false);
              setFindQuery("");
              setFindIndex(0);
            }}
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

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                {m.role === "assistant" ? (
                  <div className="max-w-[92%] text-[0.95rem] leading-relaxed text-fg">
                    {m.content ? <Markdown text={m.content} query={searchQuery} locale={locale} /> : null}
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
                  <div className="max-w-[78%] rounded-[20px] rounded-br-sm bg-user-bubble px-4 py-2.5 text-[0.95rem] leading-relaxed">
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
                  </div>
                )}
              </li>
            ))}
            {threadApprovals.map((card) => (
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
        {working ? (
          <div data-swatch={bot.swatch} className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
            <BotAvatar swatch={bot.swatch} profile={bot.profile} state="working" size={22} />
            <span className="work-track w-14" aria-hidden>
              <i />
            </span>
            <p className="text-xs tracking-wide text-muted">{t(locale, "chat.workingBar", { name: bot.name })}</p>
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={cn("shrink-0 px-3 pt-2 pb-2", working ? "" : "border-t border-border")}
        >
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
                  disabled={!live || !bot.available || !bot.conversation || chips.length >= MAX_ATTACHMENTS || blocked}
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
                aria-label={t(locale, "chat.send")}
              >
                <SendHorizontal className="size-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
