import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEventBatch, eventIdentity, isSuppressedAssistantNotice, type EventSink, type TurnMap } from "./events.ts";
import type { ApprovalCard } from "./approvals.ts";
import type { BotWireEvent } from "./native-bot.ts";

function sinkRecorder() {
  const working: boolean[] = [];
  const upserts: { text: string; role: string }[] = [];
  const approvals: ApprovalCard[] = [];
  const notices: string[] = [];
  const sink: EventSink = {
    upsert: (input) => upserts.push({ text: input.text, role: input.role }),
    setWorking: (_p, _c, w) => working.push(w),
    activity: () => {},
    notice: (label) => notices.push(label),
    upsertApproval: (card) => {
      const idx = approvals.findIndex((item) => item.requestId === card.requestId);
      if (idx < 0) approvals.push(card);
      else approvals[idx] = { ...approvals[idx]!, ...card, command: card.command || approvals[idx]!.command };
    },
  };
  return { sink, working, upserts, approvals, notices };
}

test("shared turn event_id must not drop reply or terminal", () => {
  const { sink, working, upserts } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  const turn = "turn-shared";
  const events: BotWireEvent[] = [
    { seq: 1, profile: "alpha", conversation: "c1", event_id: turn, kind: "user_message", payload: { text: "hi", message_id: "u1" } },
    { seq: 2, profile: "alpha", conversation: "c1", event_id: turn, kind: "turn_start", payload: {} },
    { seq: 3, profile: "alpha", conversation: "c1", event_id: turn, kind: "message", payload: { text: "draft", message_id: "a1" } },
    { seq: 4, profile: "alpha", conversation: "c1", event_id: turn, kind: "edit", payload: { text: "edited reply", message_id: "a1" } },
    { seq: 5, profile: "alpha", conversation: "c1", event_id: turn, kind: "turn_complete", payload: { outcome: "success" } },
    { seq: 6, profile: "alpha", conversation: "c1", event_id: turn, kind: "typing", payload: { active: false } },
  ];
  assert.equal(applyEventBatch(events, state, sink), 5);
  assert.deepEqual(
    upserts.map((u) => `${u.role}:${u.text}`),
    ["user:hi", "assistant:draft", "assistant:edited reply"],
  );
  assert.deepEqual(working, [true, false]);
  assert.equal(state.turns["alpha\0c1"]?.active, false);
  assert.equal(state.turns["alpha\0c1"]?.terminal, true);
  assert.equal(state.cursor, 6);
  assert.equal(applyEventBatch(events, state, sink), 0);
  assert.equal(upserts.length, 3);
  assert.deepEqual(working, [true, false]);
});

test("event identity is seq, never event_id alone", () => {
  const turn = "turn-shared";
  const a: BotWireEvent = { seq: 1, event_id: turn, kind: "user_message", payload: { message_id: "u1" } };
  const b: BotWireEvent = { seq: 3, event_id: turn, kind: "message", payload: { message_id: "a1" } };
  assert.equal(eventIdentity(a), "seq:1");
  assert.equal(eventIdentity(b), "seq:3");
  assert.notEqual(eventIdentity(a), eventIdentity(b));
  assert.equal(eventIdentity(a).startsWith("id:"), false);
});

test("turn_complete then typing false stays idle", () => {
  const { sink, working } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  const events: BotWireEvent[] = [
    { seq: 1, profile: "alpha", conversation: "c1", event_id: "s", kind: "turn_start", payload: {} },
    { seq: 2, profile: "alpha", conversation: "c1", event_id: "t1", kind: "typing", payload: { active: true } },
    { seq: 3, profile: "alpha", conversation: "c1", event_id: "done", kind: "turn_complete", payload: { outcome: "success" } },
    { seq: 4, profile: "alpha", conversation: "c1", event_id: "t2", kind: "typing", payload: { active: false } },
  ];
  applyEventBatch(events, state, sink);
  assert.deepEqual(working, [true, false]);
  assert.equal(state.turns["alpha\0c1"]?.active, false);
  assert.equal(state.turns["alpha\0c1"]?.terminal, true);
});

test("working continues through typing pause and message edits until turn_complete", () => {
  const { sink, working, upserts } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  applyEventBatch(
    [
      { seq: 1, profile: "alpha", conversation: "c1", event_id: "t", kind: "turn_start", payload: {} },
      { seq: 2, profile: "alpha", conversation: "c1", event_id: "t", kind: "typing", payload: { active: true } },
      { seq: 3, profile: "alpha", conversation: "c1", event_id: "t", kind: "message", payload: { text: "partial", message_id: "a1" } },
      { seq: 4, profile: "alpha", conversation: "c1", event_id: "t", kind: "typing", payload: { active: false } },
      { seq: 5, profile: "alpha", conversation: "c1", event_id: "t", kind: "edit", payload: { text: "final", message_id: "a1" } },
      { seq: 6, profile: "alpha", conversation: "c1", event_id: "t", kind: "complete", payload: {} },
      { seq: 7, profile: "alpha", conversation: "c1", event_id: "t", kind: "turn_complete", payload: { outcome: "success" } },
    ],
    state,
    sink,
  );
  assert.deepEqual(working, [true, false]);
  assert.equal(state.turns["alpha\0c1"]?.active, false);
  assert.deepEqual(
    upserts.map((u) => u.text),
    ["partial", "final"],
  );
});

test("attachment events merge by message_id without duplicates", () => {
  const attachments: unknown[][] = [];
  const sink: EventSink = {
    upsert: (input) => attachments.push(input.attachments ?? []),
    setWorking: () => {},
    activity: () => {},
    notice: () => {},
  };
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  applyEventBatch(
    [
      {
        seq: 1,
        profile: "alpha",
        conversation: "c1",
        kind: "message",
        payload: {
          text: "img",
          message_id: "a1",
          attachments: [{ id: "f1", name: "a.png", mime: "image/png", size: 3, path: "/tmp/a.png" }],
        },
      },
      {
        seq: 2,
        profile: "alpha",
        conversation: "c1",
        kind: "edit",
        payload: {
          text: "img",
          message_id: "a1",
          attachments: [{ id: "f1", name: "a.png", mime: "image/png", size: 3 }],
        },
      },
    ],
    state,
    sink,
  );
  assert.equal(attachments.length, 2);
  assert.deepEqual(attachments[0], [{ id: "f1", name: "a.png", mime: "image/png", size: 3 }]);
  assert.equal("path" in (attachments[0]?.[0] as object), false);
});

test("typing without turn_start never activates", () => {
  const { sink, working } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  applyEventBatch(
    [{ seq: 1, profile: "alpha", conversation: "c1", kind: "typing", payload: { active: true } }],
    state,
    sink,
  );
  assert.deepEqual(working, []);
});

test("repeated polling does not duplicate", () => {
  const { sink, upserts } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  const batch: BotWireEvent[] = [
    {
      seq: 1,
      profile: "alpha",
      conversation: "c1",
      event_id: "m1",
      kind: "message",
      payload: { text: "hello", message_id: "m1" },
    },
  ];
  assert.equal(applyEventBatch(batch, state, sink), 1);
  assert.equal(applyEventBatch(batch, state, sink), 0);
  assert.equal(applyEventBatch(batch, { cursor: state.cursor, turns: state.turns, seen: state.seen }, sink), 0);
  assert.equal(upserts.length, 1);
});

test("suppresses only listed assistant internal notices on replay", () => {
  assert.equal(isSuppressedAssistantNotice("assistant", "⚡ Interrupting current task — wait"), true);
  assert.equal(isSuppressedAssistantNotice("assistant", "↪ Redirected current run"), true);
  assert.equal(isSuppressedAssistantNotice("assistant", "💡 First-time tip: try /help"), true);
  assert.equal(isSuppressedAssistantNotice("assistant", "📬 No home channel is set for Pwa"), true);
  assert.equal(isSuppressedAssistantNotice("user", "⚡ Interrupting current task"), false);
  assert.equal(isSuppressedAssistantNotice("assistant", "實際回覆內容"), false);

  const { sink, upserts } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  applyEventBatch(
    [
      {
        seq: 1,
        profile: "alpha",
        conversation: "c1",
        kind: "user_message",
        payload: { text: "hi", message_id: "u1" },
      },
      {
        seq: 2,
        profile: "alpha",
        conversation: "c1",
        kind: "message",
        payload: { text: "⚡ Interrupting current task", message_id: "a1" },
      },
      {
        seq: 3,
        profile: "alpha",
        conversation: "c1",
        kind: "message",
        payload: { text: "答案在這裡", message_id: "a2" },
      },
    ],
    state,
    sink,
  );
  assert.deepEqual(
    upserts.map((u) => u.text),
    ["hi", "答案在這裡"],
  );
});

test("approval events isolate by profile and conversation and replay without duplicates", () => {
  const { sink, approvals, notices } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  const request: BotWireEvent = {
    seq: 10,
    profile: "alpha",
    conversation: "c1",
    kind: "approval_request",
    payload: {
      request_id: "req-1",
      command: "git status",
      description: "Show git status",
      choices: ["once", "deny"],
      created_at: 1,
    },
  };
  const other: BotWireEvent = {
    seq: 11,
    profile: "beta",
    conversation: "c2",
    kind: "approval_request",
    payload: {
      request_id: "req-2",
      command: "ls",
      description: "list",
      choices: ["once"],
    },
  };
  assert.equal(applyEventBatch([request, other], state, sink), 2);
  assert.equal(applyEventBatch([request, other], state, sink), 0);
  assert.equal(approvals.length, 2);
  assert.deepEqual(
    approvals.map((c) => `${c.profile}:${c.conversation}:${c.requestId}`),
    ["alpha:c1:req-1", "beta:c2:req-2"],
  );
  assert.deepEqual(notices, ["approval.notify", "approval.notify"]);
  assert.equal(notices.some((n) => n.includes("git")), false);

  applyEventBatch(
    [
      {
        seq: 12,
        profile: "alpha",
        conversation: "c1",
        kind: "approval_resolved",
        payload: { request_id: "req-1", choice: "once" },
      },
    ],
    state,
    sink,
  );
  const alpha = approvals.find((c) => c.requestId === "req-1");
  assert.equal(alpha?.status, "approved");
  assert.equal(alpha?.command, "git status");
});

test("approval_expired marks the card and optional upsertApproval is safe to omit", () => {
  const { sink, approvals } = sinkRecorder();
  const state = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  applyEventBatch(
    [
      {
        seq: 1,
        profile: "alpha",
        conversation: "c1",
        kind: "approval_request",
        payload: { request_id: "req-9", command: "rm", choices: ["deny"] },
      },
      {
        seq: 2,
        profile: "alpha",
        conversation: "c1",
        kind: "approval_expired",
        payload: { request_id: "req-9" },
      },
    ],
    state,
    sink,
  );
  assert.equal(approvals[0]?.status, "expired");

  const silent: EventSink = {
    upsert: () => {},
    setWorking: () => {},
    activity: () => {},
    notice: () => {},
  };
  const next = { cursor: 0, turns: {} as TurnMap, seen: new Set<string>() };
  assert.doesNotThrow(() =>
    applyEventBatch(
      [
        {
          seq: 1,
          profile: "alpha",
          conversation: "c1",
          kind: "approval_request",
          payload: { request_id: "req-8", command: "echo", choices: ["once"] },
        },
      ],
      next,
      silent,
    ),
  );
});
