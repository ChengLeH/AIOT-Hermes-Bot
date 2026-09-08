import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_BRAND,
  APP_SLOGAN,
  CONNECT_HEADING_CLASS,
  CONNECT_HEADING_LINE_CLASS,
  EYE_RX,
  EYE_RY,
  EYE_SWATCHES,
  eyeGapIncrease,
  eyeSwatchForProfile,
  eyeSwatchesForProfiles,
  eyeHex,
  hermesAgentUncropped,
  launchDuration,
  launchShouldShow,
  resolveEyeSwatch,
  splitConnectHeading,
} from "./brand.ts";
import { botFromProfile } from "./bots.ts";
import { t } from "./locale.ts";
import { readFileSync } from "node:fs";

test("brand is exact lowercase aiot with the pocket slogan", () => {
  assert.equal(APP_BRAND, "aiot");
  assert.equal(APP_BRAND.toLowerCase(), APP_BRAND);
  assert.equal(APP_SLOGAN, "your agent, in your pocket");
});

test("eye colors are deterministic muted swatches", () => {
  const a = eyeSwatchForProfile("Grok");
  const b = eyeSwatchForProfile("Grok");
  const c = eyeSwatchForProfile("Codex");
  assert.equal(a, b);
  const ids = EYE_SWATCHES.map((item) => item.id);
  assert.equal(ids.includes(a), true);
  assert.equal(ids.includes(c), true);
  assert.equal(resolveEyeSwatch("coral", "Grok"), a);
  assert.equal(botFromProfile("Grok", true, "c1").swatch, a);
  assert.equal(botFromProfile("Grok", false, "c1").swatch, a);
  for (const item of EYE_SWATCHES) {
    const hex = item.hex.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const bch = parseInt(hex.slice(4, 6), 16);
    const max = Math.max(r, g, bch);
    const min = Math.min(r, g, bch);
    assert.equal(max - min < 80, true, item.id);
    assert.equal(max < 160, true, item.id);
  }
});

test("launch overlay dismisses after the hold and is shorter without motion", () => {
  assert.equal(launchDuration(false) >= 2200, true);
  assert.equal(launchDuration(false) <= 2500, true);
  assert.equal(launchDuration(true) < 600, true);
  assert.equal(launchShouldShow(0, launchDuration(false)), true);
  assert.equal(launchShouldShow(launchDuration(false), launchDuration(false)), false);
  assert.equal(launchShouldShow(launchDuration(true), launchDuration(true)), false);
});

test("connection headlines split Hermes Bot onto independent glyph-safe lines", () => {
  const zh = t("zh-Hant", "onboard.headline");
  const en = t("en", "onboard.headline");
  assert.equal(zh.includes("Hermes Bot"), true);
  assert.equal(en.includes("Hermes Bot"), true);
  assert.equal(zh.includes("Hermes Agent"), false);
  assert.equal(en.includes("Hermes Agent"), false);
  assert.deepEqual(splitConnectHeading(en), ["Connect to your", "Hermes Bot."]);
  assert.deepEqual(splitConnectHeading(zh), ["直連你的", "Hermes Bot。"]);
  assert.deepEqual(splitConnectHeading("Hello"), ["Hello"]);
  assert.equal(hermesAgentUncropped(zh), true);
  assert.equal(hermesAgentUncropped(en), true);
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const heading = css.slice(css.indexOf(".connect-heading {"), css.indexOf(".connect-heading-line"));
  const line = css.slice(css.indexOf(".connect-heading-line"), css.indexOf(".title-glyph"));
  assert.equal(heading.includes("overflow: visible"), true);
  assert.equal(heading.includes("letter-spacing: 0.012em"), true);
  assert.equal(heading.includes("text-wrap: unset"), true);
  assert.equal(heading.includes("nowrap"), false);
  assert.equal(/overflow:\s*hidden/.test(heading), false);
  assert.equal(line.includes("display: block"), true);
  assert.equal(line.includes("overflow: visible"), true);
  assert.equal(line.includes("line-height: 1.25"), true);
  assert.equal(line.includes("padding-bottom: 0.16em"), true);
  assert.equal(/overflow:\s*(hidden|clip)/.test(line), false);
  assert.equal(CONNECT_HEADING_CLASS, "connect-heading");
  assert.equal(CONNECT_HEADING_LINE_CLASS, "connect-heading-line");
  const onboard = readFileSync(new URL("../components/onboarding.tsx", import.meta.url), "utf8");
  assert.equal(onboard.includes("splitConnectHeading"), true);
  assert.equal(onboard.includes("CONNECT_HEADING_LINE_CLASS"), true);
  assert.equal(onboard.includes("app-shell"), false);
  assert.equal(onboard.includes("viewport-root"), false);
  assert.equal(onboard.includes("setup-page"), true);
});

test("Grok Codex and Big get distinct muted eye colors", () => {
  const grok = eyeSwatchForProfile("Grok");
  const codex = eyeSwatchForProfile("Codex");
  const big = eyeSwatchForProfile("Big");
  assert.equal(grok, "clay");
  assert.equal(codex, "plum");
  assert.equal(big, "olive");
  assert.notEqual(grok, codex);
  assert.notEqual(grok, big);
  assert.notEqual(codex, big);
});

test("aiot eyes are 30-40% farther apart with the same oval size", () => {
  const increase = eyeGapIncrease();
  assert.equal(increase >= 1.3, true);
  assert.equal(increase <= 1.4, true);
  assert.equal(EYE_RX, 6.4);
  assert.equal(EYE_RY, 3.55);
  const avatar = readFileSync(new URL("../components/bot-avatar.tsx", import.meta.url), "utf8");
  assert.equal(avatar.includes("EYE_CX_LEFT"), true);
  assert.equal(avatar.includes("EYE_CX_RIGHT"), true);
  const mark = readFileSync(new URL("../../public/favicon.svg", import.meta.url), "utf8");
  assert.equal(mark.includes('cx="21.4"'), true);
  assert.equal(mark.includes('cx="42.6"'), true);
  assert.equal(mark.includes("cx=\"24.2\""), false);
});

test("chat title keeps a glyph gutter so leading G is not clipped", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const start = css.indexOf(".chat-title");
  assert.equal(start >= 0, true);
  const next = css.indexOf("\n.", start + 1);
  const block = css.slice(start, next === -1 ? undefined : next);
  assert.equal(block.includes("padding-inline"), true);
  assert.equal(block.includes("margin-inline"), true);
  assert.equal(block.includes("text-overflow: ellipsis"), true);
  assert.equal(block.includes("padding-bottom: 0.22em"), true);
  assert.equal(block.includes("overflow: hidden"), true);
  const view = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
  assert.equal(view.includes("chat-title"), true);
  assert.match(view, /className="chat-title font-medium"/);
  assert.equal(view.includes('className="subhead-glyph truncate font-medium"'), false);
});

 test("catalog allocation avoids lowercase hash collisions and remains order independent", () => {
 const names = ["grok", "codex", "big", "codex-cli", ...Array.from({length: 30}, (_, i) => `profile-${i}`)];
 const colors = eyeSwatchesForProfiles(names);
 assert.equal(new Set([...colors.values()].map(eyeHex)).size, names.length);
 assert.deepEqual(colors, eyeSwatchesForProfiles([...names].reverse()));
 });
