import test from "node:test";
import assert from "node:assert/strict";
import { missingSessionMessages } from "./session-history.ts";
import type { ChatMessage } from "./types";
test("session catch-up reuses event bubbles one occurrence at a time", () => {
  const existing = [
    {
      id: "native-1",
      messageId: "native-1",
      botId: "b",
      role: "assistant",
      content: "Done",
      createdAt: 1,
    },
  ] as ChatMessage[];
  assert.deepEqual(
    missingSessionMessages(existing, [
      { messageId: "hermes-3", role: "assistant", text: "Done" },
      { messageId: "hermes-4", role: "assistant", text: "Done" },
    ]).map((m) => m.messageId),
    ["hermes-4"],
  );
});
test("stable session rows remain deduplicated after content edits", () => {
  const existing = [
    {
      id: "hermes-3",
      messageId: "hermes-3",
      botId: "b",
      role: "assistant",
      content: "New",
      createdAt: 1,
    },
  ] as ChatMessage[];
  assert.equal(
    missingSessionMessages(existing, [{ messageId: "hermes-3", role: "assistant", text: "Old" }])
      .length,
    0,
  );
});

test("late history cannot overwrite a new turn or connection", async () => {
  const { canApplySessionHistory } = await import("./session-history.ts");
  const stamp = {
    generation: 1,
    origin: "https://example.test",
    profile: "demo",
    conversation: "c",
    apiKey: "fixture",
  };
  assert.equal(
    canApplySessionHistory(stamp, { ...stamp, started: true, working: false, sending: false }),
    true,
  );
  for (const changed of [
    { generation: 2 },
    { conversation: "other" },
    { origin: "https://elsewhere.test" },
    { apiKey: "changed" },
    { working: true },
    { sending: true },
    { started: false },
  ]) {
    assert.equal(
      canApplySessionHistory(stamp, {
        ...stamp,
        started: true,
        working: false,
        sending: false,
        ...changed,
      }),
      false,
    );
  }
});
