import test from "node:test";
import assert from "node:assert/strict";
import { recentTaskContext } from "./task-context.ts";

test("fork keeps latest seven completed messages, excluding status receipts and unfinished replies", () => {
  const source = Array.from({length: 10}, (_, i) => ({role:"user", content:`message ${i}`, createdAt:i}));
  const result = recentTaskContext([...source, {role:"assistant",content:"stream",createdAt:11,streaming:true}, {role:"assistant",content:"receipt",createdAt:12,messageId:"aiot-task:abc"}]);
  assert.deepEqual(result.map(item => item.text), source.slice(-7).map(item => item.content));
});

test("fork UTF-8 bounds preserve whole characters and cap total context", () => {
  const result = recentTaskContext(Array.from({length:7}, (_, createdAt) => ({role:"assistant",content:"中文字😀".repeat(2000),createdAt})));
  const sizes = result.map(item => new TextEncoder().encode(item.text).length);
  assert.ok(sizes.every(size => size <= 4000));
  assert.ok(sizes.reduce((a,b) => a+b,0) <= 24000);
  assert.ok(result.every(item => !item.text.includes("�")));
});
