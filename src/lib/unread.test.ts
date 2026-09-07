import { test } from "node:test";
import assert from "node:assert/strict";
import { isReadingBot, assistantSnapshot } from "./unread.ts";

test("roster, another bot and background chat retain unread; visible matching chat reads it", () => {
  assert.equal(isReadingBot("a", "a", "chat", true), true);
  assert.equal(isReadingBot("a", "a", "roster", true), false);
  assert.equal(isReadingBot("a", "b", "chat", true), false);
  assert.equal(isReadingBot("a", "a", "chat", false), false);
});
test("history replay stays read unless assistant identity, content or attachments change", () => {
  const old = [{ id: "a1", botId: "a", role: "assistant", content: "hello" }];
  const key = assistantSnapshot(old).get("a");
  assert.equal(assistantSnapshot([...old, { id: "u1", botId: "a", role: "user", content: "hello" }]).get("a"), key);
  assert.notEqual(assistantSnapshot([{ ...old[0], content: "hello world" }]).get("a"), key);
  assert.notEqual(assistantSnapshot([{ ...old[0], attachments: [{ id: "file1" }] }]).get("a"), key);
  assert.equal(assistantSnapshot(old).get("a"), key);
});
