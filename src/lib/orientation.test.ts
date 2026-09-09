import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldShowPortraitFallback } from "./orientation.ts";

test("portrait fallback is limited to unsupported landscape mobile PWAs", () => {
  assert.equal(shouldShowPortraitFallback({ standalone: true, touch: true, landscape: true, lockUnavailable: true }), true);
  assert.equal(shouldShowPortraitFallback({ standalone: false, touch: true, landscape: true, lockUnavailable: true }), false);
  assert.equal(shouldShowPortraitFallback({ standalone: true, touch: false, landscape: true, lockUnavailable: true }), false);
  assert.equal(shouldShowPortraitFallback({ standalone: true, touch: true, landscape: false, lockUnavailable: true }), false);
  assert.equal(shouldShowPortraitFallback({ standalone: true, touch: true, landscape: true, lockUnavailable: false }), false);
});
