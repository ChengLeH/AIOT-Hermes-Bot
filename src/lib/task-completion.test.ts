import assert from "node:assert/strict";
import { test } from "node:test";
import { botFromProfile } from "./bots.ts";
import { collectUnseenCompletedTasks, mergeTaskCompletionMessages } from "./task-completion.ts";
import type { ChatMessage } from "./types.ts";

test("task completions append a batch once and preserve existing unread state", () => {
  const bot = botFromProfile("alpha", true, "conversation");
  let state: { bots: typeof bot[]; messages: ChatMessage[]; unreadBots: Record<string, boolean> } = { bots: [bot], messages: [], unreadBots: { other: true } };
  const batch = [
    { botId: bot.id, messageId: "aiot-task:one:0", text: "one" },
    { botId: bot.id, messageId: "aiot-task:two:0", text: "two" },
  ];
  state = { ...state, ...mergeTaskCompletionMessages(state, batch)! };
  assert.deepEqual(state.messages.map((message) => message.messageId), ["aiot-task:one:0", "aiot-task:two:0"]);
  assert.deepEqual(state.unreadBots, { other: true, [bot.id]: true });
  assert.equal(mergeTaskCompletionMessages(state, batch), null);
  state = { ...state, ...mergeTaskCompletionMessages(state, [{ botId: bot.id, messageId: "aiot-task:three:1", text: "three" }])! };
  assert.equal(state.messages.length, 3);
});

test("completion polling reports historical and new transitions exactly once", () => {
  const completed = new Set<string>();
  const historical = [{ id: "old-one", status: "completed" }, { id: "old-two", status: "done", turn: 2 }];
  assert.deepEqual(collectUnseenCompletedTasks(historical, completed).map((task) => task.id), ["old-one", "old-two"]);
  assert.deepEqual(collectUnseenCompletedTasks(historical, completed), []);
  assert.deepEqual(collectUnseenCompletedTasks([{ id: "live", status: "running" }], completed), []);
  assert.deepEqual(collectUnseenCompletedTasks([{ id: "live", status: "completed" }], completed).map((task) => task.id), ["live"]);
  assert.deepEqual(collectUnseenCompletedTasks([{ id: "live", status: "completed" }], completed), []);
});
