import assert from "node:assert/strict";
import { test } from "node:test";
import { findMessageMatches, highlightPieces, nextMatchIndex, searchCountLabel } from "./chat-search.ts";

test("chat search only matches this Bot Chat's rendered messages", () => {
  const thread = [
    { id: "a", content: "hello from Grok" },
    { id: "b", content: "Codex notes" },
    { id: "c", content: "hello again" },
  ];
  assert.deepEqual(findMessageMatches(thread, "hello"), ["a", "c"]);
  assert.deepEqual(findMessageMatches(thread, "  HELLO "), ["a", "c"]);
  assert.deepEqual(findMessageMatches(thread, "zzz"), []);
  assert.deepEqual(findMessageMatches(thread, ""), []);
  assert.equal(nextMatchIndex(0, 1, 2), 1);
  assert.equal(nextMatchIndex(1, 1, 2), 0);
  assert.equal(searchCountLabel(0, 2), "1/2");
  assert.equal(searchCountLabel(0, 0), "0");
});

test("search highlight splits the rendered text without swallowing neighbors", () => {
  assert.deepEqual(highlightPieces("hello from Grok", ""), [{ text: "hello from Grok", hit: false }]);
  assert.deepEqual(highlightPieces("hello from Grok", "GROK"), [
    { text: "hello from ", hit: false },
    { text: "Grok", hit: true },
  ]);
  assert.deepEqual(highlightPieces("aa aa", "aa"), [
    { text: "aa", hit: true },
    { text: " ", hit: false },
    { text: "aa", hit: true },
  ]);
});
