import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyApprovalEvent,
  approvalBody,
  approvalDeepLink,
  genericApprovalNotice,
  mergeApproval,
  parseApprovalCard,
  sanitizeStoredApprovals,
  statusAfterApprovalHttp,
  stripApprovalSecrets,
  type ApprovalChoice,
} from "./approvals.ts";

const BASE = {
  requestId: "req-1",
  profile: "alpha",
  conversation: "c1",
  command: "git status",
  description: "Show git status",
  choices: ["once", "session", "always", "deny"] as ApprovalChoice[],
  createdAt: 1,
  status: "pending" as const,
};

test("approval POST body is only profile conversation choice", () => {
  const body = approvalBody({ profile: "alpha", conversation: "c1", choice: "once" });
  assert.deepEqual(Object.keys(body).sort(), ["choice", "conversation", "profile"]);
  assert.equal("session_key" in body, false);
  assert.equal("command" in body, false);
});

test("409 never looks approved", () => {
  assert.equal(statusAfterApprovalHttp(409, "once"), "error");
  assert.equal(statusAfterApprovalHttp(409, "always"), "error");
  assert.equal(statusAfterApprovalHttp(409, "deny"), "error");
  assert.notEqual(statusAfterApprovalHttp(409, "once"), "approved");
  assert.equal(statusAfterApprovalHttp(200, "once"), "approved");
  assert.equal(statusAfterApprovalHttp(202, "session"), "approved");
  assert.equal(statusAfterApprovalHttp(200, "deny"), "rejected");
  assert.equal(statusAfterApprovalHttp(500, "once"), "error");
});

test("parse keeps supplied choices and strips secrets from command", () => {
  const card = parseApprovalCard({
    profile: "alpha",
    conversation: "c1",
    payload: {
      request_id: "req-1",
      command: "curl Bearer SECRET /Users/me/file session_key=abc",
      description: "run it",
      choices: ["once", "always", "deny", "nope"],
      created_at: 12,
    },
  });
  assert.ok(card);
  assert.equal(card.command.includes("SECRET"), false);
  assert.equal(card.command.includes("session_key"), false);
  assert.equal(card.command.includes("/Users/me"), false);
  assert.deepEqual(card.choices, ["once", "always", "deny"]);
});

test("merge by request_id keeps command on resolved replay and does not duplicate", () => {
  const pending = applyApprovalEvent("approval_request", { ...BASE }, undefined)!;
  let list = mergeApproval([], pending);
  const resolved = applyApprovalEvent("approval_resolved", { ...pending, command: "", lastChoice: "once" }, undefined)!;
  list = mergeApproval(list, resolved);
  list = mergeApproval(list, resolved);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.status, "approved");
  assert.equal(list[0]?.command, "git status");
});

test("replayed request does not reopen an approved or expired card", () => {
  const pending = applyApprovalEvent("approval_request", { ...BASE }, undefined)!;
  let list = mergeApproval([], { ...pending, status: "approved" });
  list = mergeApproval(list, pending);
  assert.equal(list[0]?.status, "approved");
  list = mergeApproval([], { ...pending, status: "expired" });
  list = mergeApproval(list, pending);
  assert.equal(list[0]?.status, "expired");
});

test("submitting survives a request replay until HTTP or a resolved event", () => {
  let list = mergeApproval([], { ...BASE, status: "submitting" });
  list = mergeApproval(list, { ...BASE, status: "pending" });
  assert.equal(list[0]?.status, "submitting");
  list = mergeApproval(list, { ...BASE, status: "error", errorKind: "conflict" });
  assert.equal(list[0]?.status, "error");
  assert.notEqual(list[0]?.status, "approved");
});

test("sanitize drops credentials private urls and duplicate request ids", () => {
  const stored = sanitizeStoredApprovals([
    {
      ...BASE,
      command: "token session_key=shh file:///tmp/x https://h.ts.net/?session_key=z",
      extra: { session_key: "nope", apiKey: "k" },
    },
    { ...BASE, requestId: "req-1", command: "dup" },
  ]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.command.includes("session_key"), false);
  assert.equal(stored[0]?.command.includes("file://"), false);
  assert.equal("extra" in stored[0]!, false);
  assert.equal("session_key" in stored[0]!, false);
  assert.equal("apiKey" in stored[0]!, false);
});

test("generic approval notice has no command and deep-links profile plus conversation", () => {
  const notice = genericApprovalNotice();
  assert.equal(notice.title, "aiot");
  assert.equal(notice.body, "");
  assert.equal(notice.body.includes("git"), false);
  const link = approvalDeepLink("https://machine.example.ts.net", "alpha", "c1");
  assert.equal(link, "/?profile=alpha&session=c1");
  assert.equal(link.includes("key"), false);
});

test("stripApprovalSecrets removes bearer and home paths", () => {
  const cleaned = stripApprovalSecrets("run Bearer abc.def /home/me/secret");
  assert.equal(cleaned.includes("abc.def"), false);
  assert.equal(cleaned.includes("/home/me"), false);
});
