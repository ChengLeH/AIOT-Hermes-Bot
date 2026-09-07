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
});

test("svh min-height floors the shell above the keyboard viewport", () => {
  const visual = 744.67;
  const svh = 800.67;
  assert.equal(usedBlockSize(visual, svh), svh);
  assert.equal(usedBlockSize(visual, 0, visual), visual);
});

test("viewport-sized chat root uses visual height and offsetTop with min-height 0", () => {
  const keyboard = viewportRootBox({
    visualHeight: 744.67,
    visualOffsetTop: 56,
    innerHeight: 844,
  });
  assert.equal(keyboard.height, 744.67);
  assert.equal(keyboard.top, 56);
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

test("visualViewport lock is desk-only and setup does not scrollTo", () => {
  const src = readFileSync(new URL("./viewport.ts", import.meta.url), "utf8");
  assert.equal(src.includes('if (!isDeskLayout(root.dataset.appLayout))'), true);
  assert.equal(src.includes("clearViewportBox(document.body)"), true);
  assert.equal(src.includes('attributeFilter: ["data-app-layout"]'), true);
  const deskApply = src.slice(src.indexOf("if (!isDeskLayout"), src.indexOf("window.addEventListener(\"focusin\""));
  const setupBranch = deskApply.slice(0, deskApply.indexOf("const vv = window.visualViewport"));
  assert.equal(setupBranch.includes("scrollTo"), false);
  assert.equal(setupBranch.includes("applyViewportBox"), false);
  assert.equal(deskApply.includes("window.scrollTo(0, 0)"), true);
});
