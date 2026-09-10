import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_LIVE_WINDOW, latestHistoryWindow, liveBotMessages, olderHistoryPage, settleOrphanPending } from "./bot-window.ts";

test("live window keeps the latest 7 per Bot and does not mix Bots", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => ({ botId: "a", createdAt: i + 1, text: `a${i + 1}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ botId: "b", createdAt: 100 + i, text: `b${i}` })),
  ];
  const live = liveBotMessages(rows);
  assert.equal(BOT_LIVE_WINDOW, 7);
  assert.deepEqual(live.filter((row) => row.botId === "a").map((row) => row.text), ["a4", "a5", "a6", "a7", "a8", "a9", "a10"]);
  assert.deepEqual(live.filter((row) => row.botId === "b").map((row) => row.text), ["b0", "b1", "b2"]);
});

test("orphan pending bubbles become ended history", () => {
  const settled = settleOrphanPending([
    { id: "1", pending: true, text: "stale" },
    { id: "2", text: "kept" },
  ]);
  assert.equal(settled[0]?.pending, false);
  assert.equal(settled[1]?.pending, undefined);
});

test("scroll page is the 7 messages just older than what is already loaded", () => {
  const loaded = [{ createdAt: 8 }, { createdAt: 9 }];
  const archive = Array.from({ length: 12 }, (_, i) => ({ createdAt: i + 1, text: String(i + 1) }));
  assert.deepEqual(olderHistoryPage(loaded, archive).map((row) => row.text), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.deepEqual(latestHistoryWindow(archive).map((row) => row.text), ["6", "7", "8", "9", "10", "11", "12"]);
});
