import { assistantSnapshot } from "./unread";
import { getBotEvents, getBotProfiles } from "./native-bot";
import { PROFILE_REFRESH_SECONDS } from "./bot-catalog";
import { applyEventBatch, replayEventSink, finishEventReplay, type EventSink, type TurnMap } from "./events";
import { useDesk } from "./store";
import {
  applyProfilePoll,
  consumeRestorePending,
  enableSessionWrites,
  markRestorePending,
  readBrowserDeskSession,
  restoreAfterProfiles,
} from "./session";
import {
  browserIsOnline,
  disconnectedCapabilities,
  failedProbe,
  isUnauthorizedError,
  isUnauthorizedStatus,
} from "./credential-gate";
import { isAbortError } from "./hermes-fetch";
import { deepLinkFromPwaSearch } from "./origin";
import { canApplySessionHistory, missingSessionMessages } from "./session-history";
import { getSessionHistory, getNativeRunEvents } from "./native-runs";

let lastHistorySync = 0;
let historySyncGeneration: number | null = null;
let started = false;
let users = 0;
let after = 0;
let nativeAfter = 0;
let replaying = true;
let replayProgress = false;
let replayBaseline: Map<string, string> | null = null;
let generation = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let looping = false;
let polling = false;
const seen = new Set<string>();
const turns: TurnMap = {};
let onVisible: (() => void) | null = null;
let onOffline: (() => void) | null = null;

export function resetEventCursor(): void {
  lastHistorySync = 0;
  after = 0;
  nativeAfter = 0;
  replaying = true;
  replayBaseline = null;
  generation += 1;
  seen.clear();
  for (const key of Object.keys(turns)) delete turns[key];
}

export function startHermesRuntime(): () => void {
  users += 1;
  if (!started) {
    started = true;
    markRestorePending();
    void refreshProfiles();
    timer = setInterval(() => void refreshProfiles(), PROFILE_REFRESH_SECONDS * 1000);
    onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshProfiles();
    };
    onOffline = () => markUnreachable("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("offline", onOffline);
    void eventLoop();
  }
  return () => {
    users = Math.max(0, users - 1);
    if (users > 0) return;
    started = false;
    looping = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (onVisible) {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      onVisible = null;
    }
    if (onOffline) {
      window.removeEventListener("offline", onOffline);
      onOffline = null;
    }
  };
}

function markUnreachable(error: string): void {
  const current = useDesk.getState().connection;
  if (current.lastProbe?.ok === false && current.lastProbe.error === error) return;
  useDesk.getState().setProbe(failedProbe(current.lastProbe, error));
}

async function refreshProfiles(): Promise<void> {
  const { connection } = useDesk.getState();
  const origin = connection.origin;
  const apiKey = connection.apiKey;
  if (!origin) return;
  if (!apiKey) {
    if (connection.lastProbe?.ok !== false) useDesk.getState().markDisconnected();
    return;
  }
  if (!browserIsOnline()) {
    markUnreachable("offline");
    return;
  }
  try {
    const catalog = await getBotProfiles(origin, apiKey);
    const stored = await readBrowserDeskSession(origin);
    useDesk.getState().syncHermesProfiles(catalog.profiles, catalog.capabilities);
    useDesk.getState().setProbe({
      ok: true,
      at: Date.now(),
      transport: "native-bot",
      profiles: catalog.profiles,
      capabilities: catalog.capabilities,
    });
    if (consumeRestorePending()) {
      const restored = restoreAfterProfiles({
        profiles: catalog.profiles,
        stored,
        query: deepLinkFromPwaSearch(typeof window !== "undefined" ? window.location.search : ""),
      });
      enableSessionWrites();
      useDesk.getState().restoreDesk(restored);
    } else {
      const s = useDesk.getState();
      const bot = s.bots.find((b) => b.id === s.activeBotId);
      const next = applyProfilePoll({
        profiles: catalog.profiles,
        currentView: s.view,
        currentProfile: bot?.profile ?? null,
        conversations: Object.fromEntries(s.bots.map((b) => [b.profile, b.conversation])),
        drafts: Object.fromEntries(s.bots.map((b) => [b.profile, s.composerDrafts[b.id] ?? ""])),
      });
      if (next.notice || next.view !== s.view) {
        useDesk.getState().restoreDesk({
          view: next.view,
          profile: next.profile,
          conversation: next.profile ? next.conversations[next.profile] ?? null : null,
          conversations: next.conversations,
          drafts: next.drafts,
          notice: next.notice,
        });
      }
    }
  } catch (err) {
    if (isUnauthorizedError(err)) {
      useDesk.getState().markDisconnected();
      return;
    }
    markUnreachable(isAbortError(err) ? "timeout" : err instanceof Error ? err.message : "profiles 失敗");
  }
}

async function eventLoop(): Promise<void> {
  if (looping) return;
  looping = true;
  while (started) {
    await pollOnce();
    await new Promise((r) => setTimeout(r, replaying && replayProgress ? 0 : 800));
  }
  looping = false;
}

function sink(): EventSink {
  const botOf = (profile: string) => useDesk.getState().bots.find((b) => b.profile === profile);
  return {
    upsert: (input) => {
      const bot = botOf(input.profile);
      const old = bot && useDesk.getState().messages.find((m) => m.botId === bot.id && m.messageId === input.messageId);
      useDesk.getState().upsertEventMessage(input);
      if (!replaying && bot && input.role === "assistant" && (input.text || input.attachments?.length) && (!old || old.content !== input.text || old.attachments?.length !== input.attachments?.length)) {
        useDesk.getState().markUnread(bot.id);
      }
    },
    setWorking: (profile, conversation, working) => {
      const bot = botOf(profile);
      if (!bot || bot.conversation !== conversation) return;
      useDesk.getState().setBotState(bot.id, working ? "working" : "idle");
    },
    activity: (profile, _conversation, label, kind) => {
      const bot = botOf(profile);
      if (!bot) return;
      useDesk.getState().pushActivity(bot.id, { label, kind });
    },
    notice: (label) => useDesk.getState().pushNotice(label),
    upsertApproval: (card) => useDesk.getState().upsertApproval(card),
  };
}

async function pollOnce(): Promise<void> {
  replayProgress = false;
  if (polling) return;
  const { connection } = useDesk.getState();
  const origin = connection.origin;
  const apiKey = connection.apiKey;
  if (!origin || !apiKey) return;
  if (!browserIsOnline()) {
    markUnreachable("offline");
    return;
  }
  polling = true;
  const gen = generation;
  try {
    const [page, nativePage] = await Promise.all([
      getBotEvents(origin, apiKey, after),
      getNativeRunEvents(origin, apiKey, nativeAfter),
    ]);
    if (gen !== generation) return;
    if (isUnauthorizedStatus(page.status)) {
      useDesk.getState().markDisconnected();
      return;
    }
    if (page.status >= 400 && page.status < 500) return;
    if (page.status >= 500) {
      markUnreachable(`events ${page.status}`);
      return;
    }
    const current = useDesk.getState().connection.lastProbe;
    if (!current?.ok) {
      useDesk.getState().setProbe({
        ok: true,
        at: Date.now(),
        transport: "native-bot",
        profiles: current?.profiles ?? [],
        capabilities: current?.capabilities ?? disconnectedCapabilities(),
      });
    }
    if (replaying && !replayBaseline) replayBaseline = assistantSnapshot(useDesk.getState().messages);
    const state = { cursor: after, turns, seen };
    replayProgress = page.events.length > 0 || nativePage.events.length > 0;
    const target = sink();
    applyEventBatch(page.events, state, replaying ? replayEventSink(target) : target);
    const nativeState = { cursor: nativeAfter, turns, seen };
    applyEventBatch(nativePage.events, nativeState, replaying ? replayEventSink(target) : target);
    // The API supplies no total/high-water mark. An empty page establishes catch-up,
    // regardless of the server's page size; never expose historical starts in between.
    if (replaying && page.events.length === 0 && nativePage.events.length === 0) {
      replaying = false;
      const latest = assistantSnapshot(useDesk.getState().messages);
      for (const [id, previous] of replayBaseline ?? []) {
        if (latest.get(id) !== previous) useDesk.getState().markUnread(id);
      }
      replayBaseline = null;
      finishEventReplay(turns, useDesk.getState().bots.filter((bot) => !useDesk.getState().sending[bot.id]), target);
    }
    // Session reads repair missed/expired event history after reconnect and
    // across devices. Keep historical reads out of unread/working indicators.
    if (!replaying && historySyncGeneration !== gen && Date.now() - lastHistorySync > 10_000) {
      lastHistorySync = Date.now();
      historySyncGeneration = gen;
      // Supplementary history never blocks the 800ms live event loop.
      void Promise.all(useDesk.getState().bots.filter((bot) => bot.available && bot.nativeCapabilities?.available && !useDesk.getState().sending[bot.id] && useDesk.getState().botState[bot.id] !== "working").map(async (bot) => {
        const identity = { generation: gen, origin, apiKey, profile: bot.profile, conversation: bot.conversation };
        try {
          const rows = await getSessionHistory(origin, apiKey, bot.profile, bot.conversation);
          const current = useDesk.getState();
          const currentBot = current.bots.find((item) => item.id === bot.id);
          if (!currentBot || !canApplySessionHistory(identity, {
            generation, origin: current.connection.origin, apiKey: current.connection.apiKey,
            profile: currentBot.profile, conversation: currentBot.conversation, started,
            working: current.botState[bot.id] === "working", sending: Boolean(current.sending[bot.id]),
          })) return;
          for (const row of missingSessionMessages(current.messages.filter((m) => m.botId === bot.id), rows)) {
            current.upsertEventMessage({ profile: bot.profile, conversation: bot.conversation, ...row });
          }
        } catch { /* Session API is supplementary; preserve Bot event history. */ }
      })).finally(() => { if (historySyncGeneration === gen) historySyncGeneration = null; });
    }
    after = state.cursor;
    nativeAfter = nativeState.cursor;
  } catch (err) {
    if (isUnauthorizedError(err)) {
      useDesk.getState().markDisconnected();
      return;
    }
    markUnreachable(isAbortError(err) ? "timeout" : err instanceof Error ? err.message : "events 失敗");
  } finally {
    polling = false;
  }
}
