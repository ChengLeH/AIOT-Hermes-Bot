import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const catalog = { profiles: [{ name: "alpha" }], capabilities: {} };
const emptyCatalog = { profiles: [], capabilities: {} };
const page = { status: 200, events: [] };

// Execute the real runtime with controlled I/O so delayed responses and React's
// stop/start lifecycle can be exercised without a live Hermes or browser store.
function harness(readSession: () => Promise<unknown> = async () => null) {
  const profiles: ReturnType<typeof deferred<typeof catalog>>[] = [];
  const events: ReturnType<typeof deferred<typeof page>>[] = [];
  const histories: ReturnType<typeof deferred<unknown[]>>[] = [];
  const historyWrites: unknown[][] = [];
  const timeouts: (() => void)[] = [];
  const intervals = new Set<() => void>();
  const window = new EventTarget();
  Object.assign(window, { location: { search: "" } });
  const document = new EventTarget();
  Object.assign(document, { visibilityState: "visible" });
  let applied = 0;
  let disconnected = 0;
  const state = {
    connection: { origin: "https://first.example", apiKey: "first", lastProbe: null as unknown },
    bots: [] as any[], messages: [], sending: {}, botState: {}, historyResetAt: 0,
    syncHermesProfiles: () => { applied++; },
    confirmMessageOrigin: () => {},
    setProbe: (probe: unknown) => { state.connection.lastProbe = probe; },
    markDisconnected: () => { disconnected++; },
    restoreDesk: () => {},
    upsertSessionHistoryMessages: (_profile: string, _conversation: string, rows: unknown[]) => { historyWrites.push(rows); },
  };
  const modules: Record<string, unknown> = {
    "./unread": { assistantSnapshot: () => new Map() },
    "./native-bot": {
      getBotProfiles: () => { const job = deferred<typeof catalog>(); profiles.push(job); return job.promise; },
      getBotEvents: () => { const job = deferred<typeof page>(); events.push(job); return job.promise; },
    },
    "./bot-catalog": { PROFILE_REFRESH_SECONDS: 30 },
    "./events": {
      applyEventBatch: () => {},
      replayEventSink: (sink: unknown) => sink,
      replayWindowSink: (sink: unknown) => sink,
      beginReplayWindow: () => {},
      discardReplayWindow: () => {},
      flushReplayWindow: () => {},
      finishEventReplay: () => {},
    },
    "./bot-window": { BOT_LIVE_WINDOW: 7, latestHistoryWindow: (rows: unknown[]) => rows.slice(-7) },
    "./sync-poll": {
      EVENT_POLL_MS: 2000,
      HISTORY_SYNC_MS: 60_000,
      eventPollDelayMs: (visibility: string, fast: boolean) => (fast ? 0 : visibility === "hidden" ? "wait-visible" : 2000),
    },
    "./store": { useDesk: { getState: () => state } },
    "./session": {
      markRestorePending: () => {}, readBrowserDeskSession: readSession,
      consumeRestorePending: () => true, restoreAfterProfiles: () => ({}), enableSessionWrites: () => {},
    },
    "./credential-gate": {
      browserIsOnline: () => true, failedProbe: (_old: unknown, error: string) => ({ ok: false, error }),
      isUnauthorizedError: (error: Error) => error.message.includes("401"), isUnauthorizedStatus: (status: number) => status === 401,
      disconnectedCapabilities: () => ({}),
    },
    "./hermes-fetch": { isAbortError: () => false },
    "./origin": { deepLinkFromPwaSearch: () => null },
    "./session-history": { canApplySessionHistory: () => true, missingSessionMessages: (_existing: unknown[], rows: unknown[]) => rows },
    "./native-runs": { getNativeRunEvents: async () => page, getSessionHistory: () => { const job = deferred<unknown[]>(); histories.push(job); return job.promise; } },
  };
  const exports = {} as { startHermesRuntime: () => () => void; resetEventCursor: () => void };
  const code = ts.transpileModule(readFileSync(new URL("./runtime.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; },
    document, window, setInterval: (fn: () => void) => { intervals.add(fn); return fn; },
    clearInterval: (fn: () => void) => intervals.delete(fn),
    setTimeout: (fn: () => void) => { timeouts.push(fn); return timeouts.length; },
  });
  return { ...exports, profiles, events, histories, historyWrites, state, window, intervals, timeouts, applied: () => applied, disconnected: () => disconnected };
}

test("focus, online and interval triggers share an in-flight profile refresh", async () => {
  const h = harness();
  const stop = h.startHermesRuntime();
  h.window.dispatchEvent(new Event("focus"));
  h.window.dispatchEvent(new Event("online"));
  for (const tick of h.intervals) tick();
  assert.equal(h.profiles.length, 1);
  h.profiles[0].resolve(catalog);
  await flush();
  h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.profiles.length, 2, "a finished refresh must release its slot");
  stop();
});

test("old profile success and unauthorized failure cannot overwrite a new connection", async () => {
  for (const failure of [false, true]) {
    const h = harness();
    const stop = h.startHermesRuntime();
    h.state.connection.origin = "https://second.example";
    h.state.connection.apiKey = "second";
    h.resetEventCursor();
    h.window.dispatchEvent(new Event("focus"));
    assert.equal(h.profiles.length, 2);
    h.profiles[1].resolve(catalog);
    await flush();
    if (failure) h.profiles[0].reject(new Error("profiles 401"));
    else h.profiles[0].resolve(catalog);
    await flush();
    assert.equal(h.applied(), 1);
    assert.equal(h.disconnected(), 0);
    stop();
  }
});

test("stop/start retires the old loop and ignores its pending event failure", async () => {
  const h = harness();
  const firstStop = h.startHermesRuntime();
  h.profiles[0].resolve(catalog);
  await flush();
  h.timeouts.shift()!(); await flush();
  firstStop();
  const stop = h.startHermesRuntime();
  h.profiles[1].resolve(catalog); await flush();
  h.events[0].reject(new Error("events 401"));
  await flush();
  assert.equal(h.disconnected(), 0);
  assert.equal(h.timeouts.length, 1, "only the current lifecycle may schedule another poll");
  h.timeouts.shift()!();
  await flush();
  assert.equal(h.events.length, 2);
  stop();
});

test("stopped runtime discards pending profile success and event success", async () => {
  const h = harness();
  const stop = h.startHermesRuntime();
  await flush();
  stop();
  h.profiles[0].resolve(catalog);
  await flush();
  assert.equal(h.applied(), 0);
  assert.equal(h.state.connection.lastProbe, null);
  assert.equal(h.events.length, 0);
});

test("each subscriber cleanup is idempotent", async () => {
  const h = harness();
  const stopFirst = h.startHermesRuntime();
  const stopSecond = h.startHermesRuntime();
  stopFirst();
  stopFirst();
  assert.equal(h.intervals.size, 1, "another subscriber still owns the runtime");
  stopSecond();
  assert.equal(h.intervals.size, 0);
});


test("cursor reset during stored-session read prevents stale profile restoration", async () => {
  const stored = deferred<unknown>();
  const h = harness(() => stored.promise);
  const stop = h.startHermesRuntime();
  h.profiles[0].resolve(catalog);
  await flush();
  h.resetEventCursor();
  stored.resolve(null);
  await flush();
  assert.equal(h.applied(), 0);
  assert.equal(h.state.connection.lastProbe, null);
  h.window.dispatchEvent(new Event("focus"));
  assert.equal(h.profiles.length, 2);
  stop();
});

test("current unauthorized event failures still disconnect", async () => {
  const h = harness();
  const stop = h.startHermesRuntime();
  h.profiles[0].resolve(catalog);
  await flush();
  h.timeouts.shift()!(); await flush();
  h.events[0].reject(new Error("events 401"));
  await flush();
  assert.equal(h.disconnected(), 1);
  stop();
});

test("Session history reads one Bot at a time and writes its missing rows as one batch", async () => {
  const h = harness();
  h.state.bots = [
    { id: "hp:first", profile: "first", conversation: "one", available: true, nativeCapabilities: { available: true } },
    { id: "hp:second", profile: "second", conversation: "two", available: true, nativeCapabilities: { available: true } },
  ];
  const stop = h.startHermesRuntime();
  h.profiles[0].resolve(catalog); await flush(); h.timeouts.shift()!(); await flush(); h.events[0].resolve(page);
  await flush();
  assert.equal(h.histories.length, 1);
  h.histories[0].resolve([{ messageId: "one", role: "assistant", text: "first" }, { messageId: "two", role: "assistant", text: "second" }]);
  await flush();
  assert.equal(h.historyWrites.length, 1);
  assert.equal(h.historyWrites[0].length, 2);
  assert.equal(h.histories.length, 2, "the next Bot starts only after the first history result is applied");
  h.histories[1].resolve([]);
  stop();
});

 test("events wait for a non-empty catalog and survive failed startup discovery", async () => {
  const h = harness();
  const stop = h.startHermesRuntime();
  await flush();
  assert.equal(h.events.length, 0);
  h.profiles[0].reject(new Error("profiles 503")); await flush();
  h.timeouts.shift()!(); await flush();
  assert.equal(h.events.length, 0);
  h.window.dispatchEvent(new Event("focus"));
  h.profiles[1].resolve(emptyCatalog); await flush();
  h.timeouts.shift()!(); await flush();
  assert.equal(h.events.length, 0);
  h.window.dispatchEvent(new Event("focus"));
  h.profiles[2].resolve(catalog); await flush();
  h.timeouts.shift()!(); await flush();
  assert.equal(h.events.length, 1);
  stop();
});
