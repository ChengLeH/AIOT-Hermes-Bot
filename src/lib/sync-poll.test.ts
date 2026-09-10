import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_POLL_MS, HISTORY_SYNC_MS, NATIVE_QUEUE_POLL_MS, eventPollDelayMs, shouldPollNativeQueue } from "./sync-poll.ts";

test("event poll is 2s in the foreground and waits while hidden", () => {
  assert.equal(EVENT_POLL_MS, 2000);
  assert.equal(eventPollDelayMs("visible", false), 2000);
  assert.equal(eventPollDelayMs("hidden", false), "wait-visible");
  assert.equal(eventPollDelayMs("hidden", true), 0);
});

test("history catch-up is 60s and queue poll is 5s only while sending or queued", () => {
  assert.equal(HISTORY_SYNC_MS, 60_000);
  assert.equal(NATIVE_QUEUE_POLL_MS, 5_000);
  assert.equal(shouldPollNativeQueue(false, 0), false);
  assert.equal(shouldPollNativeQueue(true, 0), true);
  assert.equal(shouldPollNativeQueue(false, 1), true);
});
