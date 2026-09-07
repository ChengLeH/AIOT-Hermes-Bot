import { getBotEvents, getBotProfiles } from "./native-bot";
import { PROFILE_REFRESH_SECONDS } from "./bot-catalog";
import { applyEventBatch, type EventSink, type TurnMap } from "./events";
import { useDesk } from "./store";
import {
  applyProfilePoll,
  browserStorage,
  consumeRestorePending,
  enableSessionWrites,
  markRestorePending,
  readDeskSession,
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

let started = false;
let users = 0;
let after = 0;
let generation = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let looping = false;
let polling = false;
const seen = new Set<string>();
const turns: TurnMap = {};
let onVisible: (() => void) | null = null;
let onOffline: (() => void) | null = null;

export function resetEventCursor(): void {
  after = 0;
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
    const storage = browserStorage();
    const stored = storage ? readDeskSession(origin, storage) : null;
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
    await new Promise((r) => setTimeout(r, 800));
  }
  looping = false;
}

function sink(): EventSink {
  const botOf = (profile: string) => useDesk.getState().bots.find((b) => b.profile === profile);
  return {
    upsert: (input) => useDesk.getState().upsertEventMessage(input),
    setWorking: (profile, _conversation, working) => {
      const bot = botOf(profile);
      if (!bot) return;
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
    const page = await getBotEvents(origin, apiKey, after);
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
    const state = { cursor: after, turns, seen };
    applyEventBatch(page.events, state, sink());
    after = state.cursor;
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
