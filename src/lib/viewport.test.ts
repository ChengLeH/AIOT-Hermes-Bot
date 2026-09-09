import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  appLayoutFromState,
  isDeskLayout,
  resolveAppViewport,
  SETUP_TOOLBAR_SPACER,
  usedBlockSize,
  usedViewportRootSize,
  viewportRootBox,
} from "./viewport.ts";

test("visual viewport wins over larger layout height", () => {
  const next = resolveAppViewport({
    visualHeight: 744.67,
    visualOffsetTop: 0,
    innerHeight: 800.67,
  });
  assert.equal(next.height, 744.67);
  assert.equal(next.top, 0);
});

test("svh min-height floors the shell above the keyboard viewport", () => {
  const visual = 744.67;
  const svh = 800.67;
  assert.equal(usedBlockSize(visual, svh), svh);
  assert.equal(usedBlockSize(visual, 0, visual), visual);
});

test("viewport-sized chat root uses visual height without transient iOS offset", () => {
  const keyboard = viewportRootBox({
    visualHeight: 744.67,
    visualOffsetTop: 56,
    innerHeight: 844,
  });
  assert.equal(keyboard.height, 744.67);
  assert.equal(keyboard.top, 0);
  assert.equal(keyboard.minHeight, 0);
  assert.equal(keyboard.maxHeight, 744.67);
  assert.equal(usedViewportRootSize({ visualHeight: 744.67, visualOffsetTop: 56, innerHeight: 844 }), 744.67);

  const iphone = viewportRootBox({
    visualHeight: 844,
    visualOffsetTop: 0,
    innerHeight: 844,
  });
  assert.equal(iphone.height, 844);
  assert.equal(iphone.top, 0);
  assert.equal(usedViewportRootSize({ visualHeight: 844, innerHeight: 844 }), 844);
});

test("standalone PWA ignores small iOS viewport settling gaps but still follows the keyboard", () => {
  assert.equal(resolveAppViewport({ visualHeight: 633, innerHeight: 667, standalone: true }).height, 667);
  assert.equal(resolveAppViewport({ visualHeight: 360, innerHeight: 667, standalone: true }).height, 360);
  assert.equal(resolveAppViewport({ visualHeight: 633, innerHeight: 667, standalone: false }).height, 633);
});

test("setup stays a document layout until the chat desk hydrates", () => {
  assert.equal(appLayoutFromState(false, true), "setup");
  assert.equal(appLayoutFromState(false, false), "setup");
  assert.equal(appLayoutFromState(true, false), "setup");
  assert.equal(appLayoutFromState(true, true), "desk");
  assert.equal(isDeskLayout("setup"), false);
  assert.equal(isDeskLayout(""), false);
  assert.equal(isDeskLayout(undefined), false);
  assert.equal(isDeskLayout("desk"), true);
  assert.equal(SETUP_TOOLBAR_SPACER, "clamp(5rem, 12dvh, 7rem)");
});

test("visualViewport sizing never forces document scrolling", () => {
  const src = readFileSync(new URL("./viewport.ts", import.meta.url), "utf8");
  assert.equal(src.includes('if (!isDeskLayout(root.dataset.appLayout))'), true);
  assert.equal(src.includes("clearViewportBox(document.body)"), true);
  assert.equal(src.includes('attributeFilter: ["data-app-layout"]'), true);
  const deskApply = src.slice(src.indexOf("if (!isDeskLayout"), src.indexOf("window.addEventListener(\"focusin\""));
  const setupBranch = deskApply.slice(0, deskApply.indexOf("const vv = window.visualViewport"));
  assert.equal(setupBranch.includes("scrollTo"), false);
  assert.equal(setupBranch.includes("applyViewportBox"), false);
  assert.equal(deskApply.includes("window.scrollTo(0, 0)"), false);
  assert.equal(src.includes('addEventListener("gesturestart"'), true);
  assert.equal(src.includes('addEventListener("gesturechange"'), true);
  assert.equal(src.includes('addEventListener("gestureend"'), true);
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.equal(css.includes("overflow-x: visible"), false);
  assert.match(css, /touch-action:\s*pan-y/);
  assert.doesNotMatch(css, /touch-action:\s*pan-x/);
});
