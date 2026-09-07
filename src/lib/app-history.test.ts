import assert from "node:assert/strict";
import test from "node:test";
import {
  backToRoster,
  closeSearchHistory,
  historySearchOpen,
  historyView,
  pushChatHistory,
  pushSearchHistory,
  seedAppHistory,
} from "./app-history.ts";

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
