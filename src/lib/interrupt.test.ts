import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBotCatalog } from "./bot-catalog.ts";
import {
  assertInterruptBodySafe,
  canInterrupt,
  interruptAccepted,
  interruptBody,
} from "./interrupt.ts";

test("interrupts stay off unless the server sets the flag", () => {
  assert.equal(canInterrupt(undefined), false);
  assert.equal(canInterrupt({}), false);
  assert.equal(canInterrupt({ interrupts: false }), false);
  assert.equal(canInterrupt({ interrupts: true }), true);
  assert.equal(parseBotCatalog({ profiles: [] }).capabilities.interrupts, false);
  assert.equal(parseBotCatalog({ profiles: [], capabilities: { interrupts: false } }).capabilities.interrupts, false);
  assert.equal(parseBotCatalog({ profiles: [], capabilities: { interrupts: true } }).capabilities.interrupts, true);
});

test("interrupt POST body is only profile conversation", () => {
  const body = interruptBody({ profile: "alpha", conversation: "c1" });
  assert.deepEqual(body, { profile: "alpha", conversation: "c1" });
  assert.deepEqual(Object.keys(body).sort(), ["conversation", "profile"]);
  assert.equal(assertInterruptBodySafe(body), true);
  assert.equal("text" in body, false);
  assert.equal("reason" in body, false);
  assert.equal("cwd" in body, false);
  assert.equal("session" in body, false);
  assert.equal(assertInterruptBodySafe({ ...body, cwd: "/home/me" }), false);
  assert.equal(assertInterruptBodySafe({ ...body, text: "stop" }), false);
  assert.equal(interruptAccepted(202), true);
  assert.equal(interruptAccepted(200), true);
  assert.equal(interruptAccepted(204), true);
  assert.equal(interruptAccepted(409), false);
  assert.equal(interruptAccepted(500), false);
});

test("Stop control is 44px, working-only, muted gray-red, and posts /api/bot/interrupts", () => {
  const view = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
  assert.equal(view.includes("canInterrupt"), true);
  assert.equal(view.includes("postBotInterrupt"), true);
  assert.equal(view.includes('t(locale, "chat.stop")'), true);
  assert.equal(view.includes("min-h-[44px]"), true);
  assert.equal(view.includes("min-w-[44px]"), true);
  assert.equal(view.includes("size-11"), true);
  assert.equal(view.includes("stop-btn"), true);
  assert.equal(view.includes("interruptsOn && working"), true);
  assert.equal(view.includes("state === \"waiting\""), false);
  const native = readFileSync(new URL("./native-bot.ts", import.meta.url), "utf8");
  assert.equal(native.includes("/api/bot/interrupts"), true);
  assert.equal(native.includes("interruptBody(input)"), true);
  assert.equal(native.replaceAll("/api/bot/interrupts", "").includes("/api/bot/interrupt"), false);
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.equal(css.includes(".stop-btn"), true);
  assert.equal(css.includes(".status-offline"), true);
  assert.equal(css.includes("--color-offline"), true);
  assert.equal(css.includes("--color-stop-bg"), true);
  const roster = readFileSync(new URL("../components/roster.tsx", import.meta.url), "utf8");
  assert.equal(view.includes("OFFLINE_STATUS_CLASS"), true);
  assert.equal(view.includes("botPresenceOnline"), true);
  assert.equal(view.includes("gate.missingKey"), true);
  assert.equal(view.includes("sessionNotice || MISSING_KEY_NOTICE"), false);
  assert.equal(roster.includes("OFFLINE_STATUS_CLASS"), true);
  assert.equal(roster.includes("botPresenceOnline"), true);
});
