import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { vapidToBytes } from "./vapid.ts";
import { pushSubscribePayload, sanitizeVisiblePush } from "./push-payload.ts";
import { approvalDeepLink, genericApprovalNotice } from "./approvals.ts";
import { applicationServerKeyMatches } from "./push-key.ts";

test("vapid public key decodes from url-safe base64", () => {
  const bytes = vapidToBytes("AQID");
  assert.deepEqual([...bytes], [1, 2, 3]);
});

test("push subscription keys must match byte-for-byte before reuse", () => {
  const expected = new Uint8Array([1, 2, 3]);
  assert.equal(applicationServerKeyMatches(expected.buffer, expected), true);
  assert.equal(applicationServerKeyMatches(new Uint8Array([1, 2, 4]).buffer, expected), false);
  assert.equal(applicationServerKeyMatches(null, expected), false);
});

test("bot messages payload is only profile, conversation, text", () => {
  const body = JSON.parse(
    JSON.stringify({ profile: "alpha", conversation: "c1", text: "hi" }),
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["conversation", "profile", "text"]);
  assert.equal("model" in body, false);
  assert.equal("owner" in body, false);
  assert.equal("user_id" in body, false);
  assert.equal("chat_id" in body, false);
});

test("subscribe payload is preview false and has no chat text", () => {
  const body = pushSubscribePayload({ endpoint: "https://push.example/sub" });
  assert.equal(body.preview, false);
  assert.deepEqual(Object.keys(body).sort(), ["preview", "subscription"]);
  assert.equal("text" in body, false);
  assert.equal("title" in body, false);
  assert.equal("body" in body, false);
});

test("approval push is generic, has no command, and deep-links profile plus conversation", () => {
  const visible = sanitizeVisiblePush({
    title: "Run this",
    body: "rm -rf /tmp",
    kind: "approval_request",
    command: "rm -rf /tmp",
    request_id: "req-1",
    profile: "alpha",
    conversation: "c1",
  });
  assert.equal(visible.title, "aiot");
  assert.equal(visible.body, "Approval requested");
  assert.equal(visible.body.includes("rm"), false);
  assert.equal(visible.profile, "alpha");
  assert.equal(visible.sessionId, "c1");
  assert.equal(genericApprovalNotice().title, "aiot");
  assert.equal(approvalDeepLink("https://machine.example.ts.net", visible.profile, visible.sessionId), "/?profile=alpha&session=c1");

  const normal = sanitizeVisiblePush({ title: "Done", body: "turn finished", profile: "alpha", sessionId: "c1" });
  assert.equal(normal.title, "Done");
  assert.equal(normal.body, "turn finished");
});

test("service worker defaults to aiot and sanitizes approval payloads", () => {
  const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /title: "aiot"/);
  assert.equal(sw.includes('title: "Hermes"'), false);
  assert.match(sw, /sanitizeVisiblePush/);
  assert.match(sw, /approval/);
  assert.match(sw, /request_id/);
  assert.match(sw, /searchParams.set\("profile"/);
  assert.match(sw, /searchParams.set\("session"/);
});

test("push text identifies Bot and task modes while stripping unsafe previews", () => {
  const taskId = "2aaace91-a893-4ffd-b652-1c445c4ded45";
  const card = sanitizeVisiblePush({ kind: "approval_request", taskId, locale: "zh-Hant", body: "secret command" });
  assert.equal(card.taskId, taskId);
  assert.equal(card.body, "需要你批准");
  assert.equal(sanitizeVisiblePush({kind:"complete",locale:"zh-Hant",body:"secret"}).body,"有新的回覆");
  assert.equal(sanitizeVisiblePush({kind:"complete",taskId,taskMode:"independent",preview:"Done"}).body,"Independent task complete：Done");
  assert.equal(sanitizeVisiblePush({kind:"complete",taskId,taskMode:"fork",locale:"zh-Hant",preview:"完成"}).body,"分支任務已完成：完成");
  assert.equal(sanitizeVisiblePush({kind:"approval_request",taskId,taskMode:"fork",locale:"zh-Hant",command:"secret"}).body,"分支任務需要你批准");
  const privatePreview = sanitizeVisiblePush({kind:"complete",preview:"tool call\nreply\nBearer token /etc/hosts C:\\work\\secret ./private/file sk-proj-1234567890123456 ghp_abcdefghijklmnopqrstuvwxyz1234567890 secret answer"});
  assert.equal(privatePreview.body,"New reply：reply");
  assert.doesNotMatch(JSON.stringify(privatePreview), /token|private|etc|work|sk-proj|ghp_|secret/i);
  assert.equal(sanitizeVisiblePush({kind:"approval_request",taskId:"../../secret"}).taskId,undefined);
});
