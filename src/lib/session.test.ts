import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyProfilePoll,
  captureDeskSession,
  MISSING_BOT_NOTICE,
  memoryStorage,
  readDeskSession,
  restoreAfterProfiles,
  writeDeskSession,
} from "./session.ts";

const ORIGIN = "https://machine.example.ts.net";
const CONV_A = "11111111-1111-4111-8111-111111111111";
const CONV_B = "22222222-2222-4222-8222-222222222222";

test("reloading selected contact ignores old device-local conversation ids", () => {
  const storage = memoryStorage();
  const stored = captureDeskSession({
    origin: ORIGIN,
    view: "chat",
    profile: "alpha",
    conversation: CONV_A,
    conversations: { alpha: CONV_A, beta: CONV_B },
    drafts: { alpha: "還沒送出" },
  });
  writeDeskSession(stored, storage);
  const roundtrip = readDeskSession(ORIGIN, storage);
  const restored = restoreAfterProfiles({
    profiles: [{ name: "alpha" }, { name: "beta" }],
    stored: roundtrip,
  });
  assert.equal(restored.view, "chat");
  assert.equal(restored.profile, "alpha");
  assert.equal(restored.conversation, null);
  assert.deepEqual(restored.conversations, {});
  assert.equal(restored.drafts.alpha, "還沒送出");
});

test("query profile opens chat without applying query or stored session id", () => {
  const restored = restoreAfterProfiles({
    profiles: [{ name: "alpha" }, { name: "beta" }],
    stored: captureDeskSession({
      origin: ORIGIN,
      view: "chat",
      profile: "alpha",
      conversation: CONV_A,
      conversations: { alpha: CONV_A, beta: CONV_B },
      drafts: {},
    }),
    query: { profile: "beta", session: CONV_B },
  });
  assert.equal(restored.view, "chat");
  assert.equal(restored.profile, "beta");
  assert.equal(restored.conversation, null);
  assert.deepEqual(restored.conversations, {});
});

test("deleted profile returns roster with plain notice", () => {
  const restored = restoreAfterProfiles({
    profiles: [{ name: "beta" }],
    stored: captureDeskSession({
      origin: ORIGIN,
      view: "chat",
      profile: "alpha",
      conversation: CONV_A,
      conversations: { alpha: CONV_A, beta: CONV_B },
      drafts: { alpha: "gone", beta: "keep" },
    }),
  });
  assert.equal(restored.view, "roster");
  assert.equal(restored.profile, null);
  assert.equal(restored.notice, MISSING_BOT_NOTICE);
  assert.equal(restored.drafts.alpha, undefined);
  assert.equal(restored.drafts.beta, "keep");
  assert.deepEqual(restored.conversations, {});
});

test("polling can add and remove profiles without minting new conversations", () => {
  let conversations: Record<string, string> = { alpha: CONV_A, beta: CONV_B };
  let drafts: Record<string, string> = { alpha: "a", beta: "b" };
  const first = applyProfilePoll({
    profiles: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }],
    currentView: "chat",
    currentProfile: "alpha",
    conversations,
    drafts,
  });
  assert.equal(first.view, "chat");
  assert.equal(first.profile, "alpha");
  assert.equal(first.conversations.alpha, CONV_A);
  assert.equal(first.conversations.beta, CONV_B);
  assert.equal(first.conversations.gamma, undefined);
  conversations = first.conversations;
  drafts = first.drafts;

  const removed = applyProfilePoll({
    profiles: [{ name: "beta" }, { name: "gamma" }],
    currentView: "chat",
    currentProfile: "alpha",
    conversations,
    drafts,
  });
  assert.equal(removed.view, "roster");
  assert.equal(removed.profile, null);
  assert.equal(removed.notice, MISSING_BOT_NOTICE);
  assert.equal(removed.conversations.alpha, undefined);
  assert.equal(removed.conversations.beta, CONV_B);
  assert.equal(removed.drafts.alpha, undefined);
  assert.equal(removed.drafts.beta, "b");
});

test("session is origin-scoped", () => {
  const storage = memoryStorage();
  writeDeskSession(
    captureDeskSession({
      origin: ORIGIN,
      view: "chat",
      profile: "alpha",
      conversation: CONV_A,
      conversations: { alpha: CONV_A },
      drafts: {},
    }),
    storage,
  );
  assert.equal(readDeskSession("https://other.example.ts.net", storage), null);
  assert.equal(readDeskSession(ORIGIN, storage)?.profile, "alpha");
});

test("desk no longer mints browser conversation UUIDs", () => {
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const send = readFileSync(new URL("./send-task.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
  const session = readFileSync(new URL("./session.ts", import.meta.url), "utf8");
  for (const src of [store, send, runtime, session]) {
    assert.equal(src.includes("conversationUuid"), false);
  }
  assert.equal(store.includes("p.canonicalSessionId"), true);
  assert.equal(send.includes("ack.conversation"), false);
});
