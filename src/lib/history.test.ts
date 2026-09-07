import assert from "node:assert/strict";
import { test } from "node:test";
import {
  replayIntoHistory,
  sameConversation,
  sanitizeStoredMessages,
} from "./history.ts";
import { containsUnsafePayload } from "./attachment-preview.ts";
import { applyEventBatch, type EventSink, type TurnMap } from "./events.ts";
import type { BotWireEvent } from "./native-bot.ts";
import { restoreAfterProfiles, captureDeskSession } from "./session.ts";
import type { ChatMessage } from "./types.ts";

const CONV = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://machine.example.ts.net";

test("send user+assistant image conversation, reload, re-enter credential, same conversation no duplicates", () => {
  const user = {
    id: "u1",
    botId: "hp:alpha",
    role: "user" as const,
    content: "look",
    createdAt: 1,
    messageId: "u1",
    attachments: [
      {
        id: "img-1",
        name: "cat.png",
        mime: "image/png",
        size: 80,
        url: "blob:local-secret",
        path: "/home/user/cat.png",
      },
    ],
  } as unknown as ChatMessage;
  const assistant: ChatMessage = {
    id: "a1",
    botId: "hp:alpha",
    role: "assistant",
    content: "nice cat",
    createdAt: 2,
    messageId: "a1",
    attachments: [{ id: "img-2", name: "reply.png", mime: "image/png", size: 40 }],
  };
  const stored = sanitizeStoredMessages([user, assistant]);
  assert.equal(stored.length, 2);
  assert.deepEqual(Object.keys(stored[0]?.attachments?.[0] ?? {}).sort(), ["id", "mime", "name", "size"]);
  assert.equal(containsUnsafePayload(stored), false);

  const session = captureDeskSession({
    origin: ORIGIN,
    view: "chat",
    profile: "alpha",
    conversation: CONV,
    conversations: { alpha: CONV },
    drafts: { alpha: "still here" },
  });
  const afterReload = restoreAfterProfiles({
    profiles: [{ name: "alpha" }],
    stored: session,
  });
  assert.equal(afterReload.conversation, null);
  assert.equal(afterReload.profile, "alpha");
  assert.equal(afterReload.view, "chat");
  assert.equal(sameConversation(CONV, CONV), true);

  const missingKey = restoreAfterProfiles({
    profiles: [{ name: "alpha" }],
    stored: session,
  });
  assert.equal(missingKey.profile, "alpha");
  assert.equal(missingKey.conversation, null);

  const upserts: ChatMessage[] = [];
  const sink: EventSink = {
    upsert: (input) => {
      upserts.push({
        id: input.messageId,
        botId: "hp:alpha",
        role: input.role,
        content: input.text,
        createdAt: 3,
        messageId: input.messageId,
        attachments: input.attachments,
      });
    },
    setWorking: () => {},
    activity: () => {},
    notice: () => {},
  };
  const replay: BotWireEvent[] = [
    {
      seq: 1,
      profile: "alpha",
      conversation: CONV,
      kind: "user_message",
      payload: {
        text: "look",
        message_id: "u1",
        attachments: [{ id: "img-1", name: "cat.png", mime: "image/png", size: 80 }],
      },
    },
    {
      seq: 2,
      profile: "alpha",
      conversation: CONV,
      kind: "turn_start",
      payload: {},
    },
    {
      seq: 3,
      profile: "alpha",
      conversation: CONV,
      kind: "message",
      payload: {
        text: "nice cat",
        message_id: "a1",
        attachments: [{ id: "img-2", name: "reply.png", mime: "image/png", size: 40 }],
      },
    },
    {
      seq: 4,
      profile: "alpha",
      conversation: CONV,
      kind: "turn_complete",
      payload: { outcome: "success" },
    },
  ];
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  applyEventBatch(replay, state, sink);
  applyEventBatch(replay, state, sink);
  const merged = replayIntoHistory(stored, upserts);
  assert.equal(merged.length, 2);
  assert.equal(merged.filter((m) => m.messageId === "u1").length, 1);
  assert.equal(merged.filter((m) => m.messageId === "a1").length, 1);
  assert.equal(merged[0]?.attachments?.[0]?.id, "img-1");
  assert.equal(afterReload.profile, "alpha");
});
