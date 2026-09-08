import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canUseNativeRuns,
  mergeCompletionItems,
  parseNativeRunCapabilities,
  type NativeRunCapabilities,
} from "./native-runs.ts";
import { readFileSync } from "node:fs";

const ON: NativeRunCapabilities = {
  available: true,
  run_submission: true,
  run_status: true,
  run_events_sse: true,
  run_approval_response: true,
  run_stop: true,
  skills: true,
};

test("official run support is opt-in per profile and requires submission plus SSE", () => {
  assert.equal(canUseNativeRuns(undefined), false);
  assert.equal(canUseNativeRuns({ ...ON, run_events_sse: false }), false);
  assert.equal(canUseNativeRuns(ON), true);
  assert.deepEqual(parseNativeRunCapabilities({ available: true, features: ON }), ON);
  assert.equal(parseNativeRunCapabilities({ available: false }).available, false);
});

test("official skills merge with Bot completions and deduplicate by inserted token", () => {
  const legacy = [{ label: "h3-prompt", description: "old", insert: "/h3-prompt", group: "Commands", folder: false, mention: "text" as const }];
  const official = [
    { label: "h3-prompt", description: "new", insert: "/h3-prompt", group: "Skills", folder: false, mention: "text" as const },
    { label: "host-bridge", description: "Host", insert: "/host-bridge", group: "Skills", folder: false, mention: "text" as const },
  ];
  assert.deepEqual(mergeCompletionItems(legacy, official).map((item) => item.insert), ["/h3-prompt", "/host-bridge"]);
});

test("plain text uses official runs while attachments keep the proven Bot upload path", () => {
  const source = readFileSync(new URL("./send-task.ts", import.meta.url), "utf8");
  assert.equal(source.includes("postNativeRun"), true);
  assert.equal(source.includes("ids.length === 0"), true);
  assert.equal(source.includes("postBotMessage"), true);
});
