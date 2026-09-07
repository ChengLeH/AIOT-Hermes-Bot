import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JUMP_LATEST_PX, jumpLatestBottomPx, transcriptAwayFromBottom } from "./jump-latest.ts";

test("jump control appears after about 96px from the transcript bottom", () => {
  assert.equal(JUMP_LATEST_PX, 96);
  assert.equal(transcriptAwayFromBottom({ scrollHeight: 800, scrollTop: 700, clientHeight: 100 }), false);
  assert.equal(transcriptAwayFromBottom({ scrollHeight: 800, scrollTop: 600, clientHeight: 100 }), true);
  assert.equal(jumpLatestBottomPx(120), 132);
  assert.equal(jumpLatestBottomPx(0), 12);
});

test("chat view wires search, jump-latest and composer ResizeObserver", () => {
  const view = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const md = readFileSync(new URL("./markdown.tsx", import.meta.url), "utf8");
  assert.equal(view.includes("findMessageMatches"), true);
  assert.equal(view.includes("chat.find"), true);
  assert.equal(view.includes("jump-latest"), true);
  assert.equal(view.includes("ResizeObserver"), true);
  assert.equal(view.includes("visualViewport"), true);
  assert.equal(view.includes("JUMP_LATEST_PX") || view.includes("transcriptAwayFromBottom"), true);
  assert.equal(css.includes(".jump-latest"), true);
  assert.equal(css.includes(".md-code"), true);
  assert.equal(css.includes(".chat-hit"), true);
  assert.equal(md.includes("md-code"), true);
  assert.equal(md.includes("chat.copy"), true);
});
