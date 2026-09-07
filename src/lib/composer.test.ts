import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completionMenuAction,
  isComposingKey,
  isTurnBusy,
  releaseSendLock,
  resetSendLocks,
  shouldSendOnEnter,
  trySendLock,
} from "./composer.ts";

test("IME composition Enter does not send", () => {
  const composingEnter = {
    key: "Enter",
    shiftKey: false,
    repeat: false,
    isComposing: true,
    keyCode: 229,
    nativeEvent: { isComposing: true, keyCode: 229 },
  };
  assert.equal(shouldSendOnEnter(composingEnter, true), false);
  assert.equal(isComposingKey(composingEnter, false), true);
});

test("IME commit then Enter sends once", () => {
  resetSendLocks();
  const commit = {
    key: "Enter",
    shiftKey: false,
    repeat: false,
    isComposing: true,
    keyCode: 229,
    nativeEvent: { isComposing: true, keyCode: 229 },
  };
  assert.equal(shouldSendOnEnter(commit, true), false);
  const send = {
    key: "Enter",
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 13,
    nativeEvent: { isComposing: false, keyCode: 13 },
  };
  assert.equal(shouldSendOnEnter(send, false), true);
  assert.equal(trySendLock("bot-a"), true);
  assert.equal(trySendLock("bot-a"), false);
  releaseSendLock("bot-a");
  assert.equal(trySendLock("bot-a"), true);
  releaseSendLock("bot-a");
});

test("held Enter does not repeat send", () => {
  const held = {
    key: "Enter",
    shiftKey: false,
    repeat: true,
    isComposing: false,
    keyCode: 13,
    nativeEvent: { isComposing: false, keyCode: 13 },
  };
  assert.equal(shouldSendOnEnter(held, false), false);
});

test("Shift+Enter is newline not send", () => {
  const shift = {
    key: "Enter",
    shiftKey: true,
    repeat: false,
    isComposing: false,
    keyCode: 13,
    nativeEvent: { isComposing: false, keyCode: 13 },
  };
  assert.equal(shouldSendOnEnter(shift, false), false);
});

test("active turn blocks another send", () => {
  assert.equal(isTurnBusy("working", false), true);
  assert.equal(isTurnBusy("waiting", false), true);
  assert.equal(isTurnBusy("idle", true), true);
  assert.equal(isTurnBusy("idle", false), false);
});

test("open completion menu captures Enter Tab arrows and Escape", () => {
  const enter = {
    key: "Enter",
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 13,
    nativeEvent: { isComposing: false, keyCode: 13 },
  };
  assert.equal(shouldSendOnEnter(enter, false, true), false);
  assert.equal(completionMenuAction(enter, false, true), "select");
  assert.equal(completionMenuAction({ ...enter, key: "Tab" }, false, true), "select");
  assert.equal(completionMenuAction({ ...enter, key: "ArrowDown" }, false, true), "next");
  assert.equal(completionMenuAction({ ...enter, key: "ArrowUp" }, false, true), "prev");
  assert.equal(completionMenuAction({ ...enter, key: "Escape" }, false, true), "close");
  assert.equal(completionMenuAction(enter, false, false), null);
  assert.equal(completionMenuAction({ ...enter, isComposing: true, keyCode: 229 }, true, true), null);
});
