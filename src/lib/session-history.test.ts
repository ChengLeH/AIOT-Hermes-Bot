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


test("undated old backfill stays before a just-sent live context marker", () => {
  const live = { id: "live", messageId: "live", botId: "b", role: "user", content: "CTX-new", createdAt: 2000 } as ChatMessage;
  const rows = missingSessionMessages([live], [
    { messageId: "old-1", role: "user", text: "old question" },
    { messageId: "old-2", role: "assistant", text: "old answer" },
  ]);
  assert.deepEqual(rows.map(row => row.createdAt), [1998, 1999]);
  assert.ok(rows.every(row => row.createdAt! < live.createdAt));
});

test("undated rows use surrounding matched occurrences and do not cross newer live data", () => {
  const existing = [
    { id: "a", messageId: "a", botId: "b", role: "user", content: "old question", createdAt: 1000 },
    { id: "ctx", messageId: "ctx", botId: "b", role: "user", content: "CTX-new", createdAt: 2000 },
  ] as ChatMessage[];
  const rows = missingSessionMessages(existing, [
    { messageId: "older", role: "assistant", text: "earlier" },
    { messageId: "a", role: "user", text: "old question" },
    { messageId: "answer", role: "assistant", text: "old answer" },
  ]);
  assert.deepEqual(rows.map(row => row.createdAt), [999, 1500]);
});

test("fresh undated history is deterministic in API order and real timestamps stay intact", () => {
  const rows = [
    { messageId: "a", role: "user" as const, text: "a" },
    { messageId: "b", role: "assistant" as const, text: "b" },
  ];
  assert.deepEqual(missingSessionMessages([], rows).map(row => row.createdAt), [0, 1]);
  assert.equal(missingSessionMessages([], [{ ...rows[0], createdAt: 12345 }])[0].createdAt, 12345);
});


test("existing corrupted imported timestamps repair before live CTX without losing edited content", () => {
  const existing = [
    { id: "ctx", messageId: "native-ctx", botId: "b", role: "user", content: "CTX-new", createdAt: 2000 },
    { id: "h1", messageId: "hermes-worker:chat:1", botId: "b", role: "user", content: "old question edited", createdAt: 2001 },
    { id: "h2", messageId: "hermes-worker:chat:2", botId: "b", role: "assistant", content: "old answer", createdAt: 2002 },
    { id: "ack", messageId: "native-ack", botId: "b", role: "assistant", content: "ACK-new", createdAt: 2003 },
  ] as ChatMessage[];
  const corrections = missingSessionMessages(existing, [
    { messageId: "hermes-worker:chat:1", role: "user", text: "old question" },
    { messageId: "hermes-worker:chat:2", role: "assistant", text: "old answer" },
  ]);
  assert.deepEqual(corrections.map(row => row.createdAt), [1998, 1999]);
  assert.equal(corrections[0].text, "old question edited");
  const corrected = existing.map(message => {
    const correction = corrections.find(row => row.messageId === message.messageId);
    return correction ? { ...message, createdAt: correction.createdAt! } : message;
  }).sort((a, b) => a.createdAt - b.createdAt);
  assert.deepEqual(corrected.slice(-2).map(row => row.content), ["CTX-new", "ACK-new"]);
  assert.equal(corrected.length, existing.length);
  assert.deepEqual(missingSessionMessages(corrected, [
    { messageId: "hermes-worker:chat:1", role: "user", text: "old question" },
    { messageId: "hermes-worker:chat:2", role: "assistant", text: "old answer" },
  ]), []);
});
