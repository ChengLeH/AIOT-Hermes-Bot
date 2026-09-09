import assert from "node:assert/strict";
import test from "node:test";
import { formatAge } from "./utils.ts";

test("formatAge accepts Unix seconds and milliseconds", () => {
  const now = Date.UTC(2026, 8, 9, 8, 0, 0);
  assert.equal(formatAge((now - 5 * 60_000) / 1000, now, "zh-Hant"), "5 分鐘前");
  assert.equal(formatAge(now - 5 * 60_000, now, "zh-Hant"), "5 分鐘前");
});

test("formatAge hides ordering-only timestamps instead of showing January 1", () => {
  assert.equal(formatAge(1, Date.UTC(2026, 8, 9), "zh-Hant"), "");
  assert.equal(formatAge(0, Date.UTC(2026, 8, 9), "en"), "");
});
