import assert from "node:assert/strict";
import test from "node:test";
import {
  backToRoster,
  closeSearchHistory,
  historySearchOpen,
  historyView,
  overlayHistoryAction,
  pushChatHistory,
  pushSearchHistory,
  reconcileTaskWorkspaceHistory,
  seedAppHistory,
  taskWorkspaceMarker,
} from "./app-history.ts";

test("task workspace marker survives a PWA reload without storing the connection key", () => {
  const first = taskWorkspaceMarker("bot-grok", "grok", "conversation-42");
  const afterReload = taskWorkspaceMarker("bot-grok", "grok", "conversation-42");
  assert.equal(first, afterReload);
  assert.match(first, /^tasks-v1-/);
  assert.equal(first.includes("secret"), false);
  assert.notEqual(first, taskWorkspaceMarker("bot-grok", "grok", "conversation-43"));
});

test("closed overlay history entries are skipped instead of reopening the same Bot", () => {
  const state = { aiotView: "chat", aiotScheduleDock: "grok" };
  assert.equal(overlayHistoryAction(state, "aiotScheduleDock", "grok", false), "skip");
  assert.equal(overlayHistoryAction(state, "aiotScheduleDock", "grok", true), "keep");
  assert.equal(overlayHistoryAction({ aiotView: "chat" }, "aiotScheduleDock", "grok", true), "close");
});

test("a task entry from another Bot is neutralized in place instead of navigating again", () => {
  const stale = { aiotView: "chat", aiotTaskWorkspace: "old", aiotTaskPanel: "detail", aiotTaskId: "task-1", keep: 7 };
  const repaired = reconcileTaskWorkspaceHistory(stale, "current");
  assert.deepEqual(repaired, { aiotView: "chat", keep: 7 });
  assert.equal(reconcileTaskWorkspaceHistory({ aiotView: "chat", aiotTaskWorkspace: "current" }, "current").aiotTaskWorkspace, "current");
});

test("Android back unwinds search then chat to the roster", () => {
  const stack: Record<string, unknown>[] = [{}];
  let index = 0;
  const history = {
    get state() {
      return stack[index];
    },
    replaceState(state: Record<string, unknown>) {
      stack[index] = state;
    },
    pushState(state: Record<string, unknown>) {
      stack.splice(index + 1);
      stack.push(state);
      index += 1;
    },
    back() {
      index = Math.max(0, index - 1);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { history } });

  seedAppHistory("roster");
  pushChatHistory();
  pushSearchHistory();
  assert.equal(historySearchOpen(history.state), true);
  closeSearchHistory();
  assert.equal(historyView(history.state), "chat");
  let fallback = false;
  backToRoster(() => {
    fallback = true;
  });
  assert.equal(historyView(history.state), "roster");
  assert.equal(fallback, false);

  Reflect.deleteProperty(globalThis, "window");
});

test("leaving settings for roster makes Android chat back return to roster", () => {
  const stack: Record<string, unknown>[] = [{}]; let index = 0;
  const history = {
    get state() { return stack[index]; },
    replaceState(state: Record<string, unknown>) { stack[index] = state; },
    pushState(state: Record<string, unknown>) { stack.splice(++index); stack.push(state); },
    back() { index = Math.max(0, index - 1); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { history } });
  try {
    seedAppHistory("settings");
    seedAppHistory("roster");
    assert.equal(historyView(history.state), "roster");
    pushChatHistory();
    backToRoster(() => assert.fail("chat must have a roster entry"));
    assert.equal(historyView(history.state), "roster");
    // A direct chat entry from settings must have the same parent.
    seedAppHistory("settings");
    pushChatHistory(); history.back();
    assert.equal(historyView(history.state), "roster");
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("opening a Bot drops stale task and schedule overlays from both history entries", () => {
  const stack: Record<string, unknown>[] = [{
    aiotView: "chat",
    aiotScheduleDock: "old-profile",
    aiotTaskWorkspace: "old-workspace",
    aiotTaskPanel: "detail",
    aiotTaskId: "old-task",
    aiotTaskReturn: "detail",
    aiotTaskSearch: true,
  }];
  let index = 0;
  const history = {
    get state() { return stack[index]; },
    replaceState(state: Record<string, unknown>) { stack[index] = state; },
    pushState(state: Record<string, unknown>) { stack.splice(index + 1); stack.push(state); index += 1; },
    back() { index = Math.max(0, index - 1); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { history } });
  try {
    pushChatHistory();
    assert.equal(stack.length, 2);
    assert.deepEqual(stack.map((entry) => entry.aiotView), ["roster", "chat"]);
    for (const entry of stack) {
      assert.equal(entry.aiotScheduleDock, undefined);
      assert.equal(entry.aiotTaskWorkspace, undefined);
      assert.equal(entry.aiotTaskPanel, undefined);
      assert.equal(entry.aiotTaskId, undefined);
      assert.equal(entry.aiotTaskReturn, undefined);
      assert.equal(entry.aiotTaskSearch, undefined);
    }
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("contact and chat history use distinct URLs for Android system Back", () => {
  let state: Record<string, unknown> = { aiotView: "settings", aiotTaskPanel: "detail" };
  const urls: (string | undefined)[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { pathname: "/", search: "" },
    history: {
      get state() { return state; },
      replaceState(next: Record<string, unknown>, _title: string, url?: string) { state = next; urls.push(url); },
      pushState(next: Record<string, unknown>, _title: string, url?: string) { state = next; urls.push(url); },
    },
  } });
  try {
    seedAppHistory("roster");
    assert.equal(state.aiotTaskPanel, undefined);
    pushChatHistory();
    assert.deepEqual(urls, ["/", "/", "/#aiot-chat"]);
    assert.equal(state.aiotView, "chat");
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});
