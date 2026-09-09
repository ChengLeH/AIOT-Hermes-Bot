import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_BRAND,
  approvalDeadlineLabels,
  APP_SLOGAN,
  countLabel,
  detectLocale,
  localizeNotice,
  localizeTaskNotice,
  taskStatusLabel,
  t,
} from "./locale.ts";

test("product brand is lowercase aiot", () => {
  assert.equal(APP_BRAND, "aiot");
  assert.equal(APP_SLOGAN, "your agent, in your pocket");
  assert.equal(t("zh-Hant", "settings.aboutBody").includes("aiot"), true);
  assert.equal(t("en", "settings.aboutBody").includes("aiot"), true);
  assert.equal(t("zh-Hant", "settings.aboutBody").includes("Hermes Bot"), true);
  assert.equal(t("en", "settings.aboutBody").includes("Hermes Bot"), true);
  assert.equal(t("zh-Hant", "settings.aboutBody").includes("Hermes Agent"), false);
  assert.equal(t("en", "settings.aboutBody").includes("Hermes Agent"), false);
  assert.equal(t("zh-Hant", "onboard.headline").includes("Hermes Bot"), true);
  assert.equal(t("en", "onboard.headline").includes("Hermes Bot"), true);
  assert.equal(t("zh-Hant", "onboard.headline").includes("Hermes Agent"), false);
  assert.equal(t("en", "onboard.headline").includes("Hermes Agent"), false);
});

test("navigator language defaults English unless Chinese", () => {
  assert.equal(detectLocale({ language: "en-US" }), "en");
  assert.equal(detectLocale({ language: "zh-TW" }), "zh-Hant");
  assert.equal(detectLocale({ language: "zh-CN" }), "zh-Hant");
  assert.equal(detectLocale({ language: "" }), "zh-Hant");
});

test("current onboarded users fall back to zh-Hant", () => {
  assert.equal(detectLocale({ language: "en-US", onboarded: true }), "zh-Hant");
  assert.equal(detectLocale({ stored: "en", onboarded: true, language: "zh-TW" }), "en");
});

test("Traditional Chinese roster uses 牛馬", () => {
  assert.equal(t("zh-Hant", "roster.heading"), "牛馬");
  assert.equal(countLabel("zh-Hant", 6, "roster.countOne", "roster.count"), "6 位牛馬");
  assert.equal(t("zh-Hant", "chat.emptyBody").includes("牛馬"), true);
});

test("English roster uses Bots", () => {
  assert.equal(t("en", "roster.heading"), "Bots");
  assert.equal(countLabel("en", 6, "roster.countOne", "roster.count"), "6 bots");
  assert.equal(countLabel("en", 1, "roster.countOne", "roster.count"), "1 bot");
  assert.equal(t("en", "roster.search"), "Search bots and chats");
  assert.equal(t("en", "desk.tabRoster"), "Bots");
  assert.equal(t("en", "chat.pick"), "Pick a bot.");
  assert.equal(t("en", "chat.offlinePlaceholder"), "This bot is offline");
  assert.equal(t("en", "error.missingAgent"), "This bot is no longer in the list.");
  assert.equal(t("en", "completions.agent"), "Bot mention");
  assert.equal(t("en", "settings.howOffline"), "Offline bots cannot send messages.");
  assert.equal(t("zh-Hant", "roster.heading"), "牛馬");
});

test("English UI copy uses Bot not Agent", () => {
  const keys = [
    "roster.heading",
    "roster.count",
    "roster.countOne",
    "roster.search",
    "roster.empty",
    "chat.emptyBody",
    "chat.offlinePlaceholder",
    "chat.pick",
    "chat.pickToStart",
    "desk.tabRoster",
    "settings.connected",
    "settings.connectedOne",
    "settings.howOffline",
    "error.missingAgent",
    "completions.agent",
  ] as const;
  for (const key of keys) {
    const value = t("en", key);
    assert.equal(/\bAgents?\b/i.test(value), false, key);
    assert.match(value, /\bbots?\b/i);
  }
  assert.equal(APP_SLOGAN, "your agent, in your pocket");
});

test("Hermes connection labels stay Hermes, profile names are not translated", () => {
  for (const locale of ["zh-Hant", "en"] as const) {
    assert.match(t(locale, "onboard.origin"), /Hermes/);
    assert.match(t(locale, "onboard.connect"), /Hermes/);
    assert.match(t(locale, "settings.origin"), /Hermes/);
    assert.equal(t(locale, "onboard.origin").toLowerCase().includes("aiot"), false);
  }
  assert.equal(localizeNotice("en", "Grok"), "Grok");
  assert.equal(localizeNotice("zh-Hant", "Codex"), "Codex");
});

test("setup copy says the key stays on this device", () => {
  assert.match(t("zh-Hant", "onboard.keyHelp"), /這台裝置/);
  assert.match(t("zh-Hant", "onboard.keyHelp"), /網站資料/);
  assert.match(t("en", "onboard.keyHelp"), /this device/);
  assert.match(t("en", "onboard.keyHelp"), /site data/);
  assert.match(t("zh-Hant", "settings.keyHelp"), /這台裝置/);
  assert.match(t("en", "settings.keyHelp"), /this device/);
});

test("reconnect and attachment copy is localized without touching model text", () => {
  assert.equal(t("zh-Hant", "error.missingKey"), "請重新輸入連線金鑰");
  assert.equal(t("en", "error.missingKey"), "Enter the connection key again");
  assert.equal(t("en", "error.audioVideo").length > 0, true);
  assert.equal(localizeNotice("en", "A model reply about Grok"), "A model reply about Grok");
});

test("approval and completion copy is bilingual and generic", () => {
  assert.equal(t("zh-Hant", "approval.title"), "需要你的批准");
  assert.equal(t("en", "approval.title"), "Approval needed");
  assert.equal(t("zh-Hant", "approval.once"), "批准這一次");
  assert.equal(t("en", "approval.once"), "Run once");
  assert.equal(t("zh-Hant", "approval.session"), "這段對話內批准");
  assert.equal(t("en", "approval.session"), "Allow for this chat");
  assert.equal(t("zh-Hant", "approval.always"), "永久允許");
  assert.equal(t("en", "approval.always"), "Always allow");
  assert.equal(t("zh-Hant", "approval.deny"), "拒絕");
  assert.equal(t("en", "approval.deny"), "Reject");
  assert.equal(t("zh-Hant", "approval.notify").includes("git"), false);
  assert.equal(t("en", "completions.mention"), "Text mention");
  assert.equal(t("zh-Hant", "completions.agent").includes("牛馬"), true);
  assert.equal(t("zh-Hant", "chat.stop"), "停止");
  assert.equal(t("en", "chat.stop"), "Stop");
  assert.equal(t("zh-Hant", "chat.find"), "搜尋");
  assert.equal(t("en", "chat.find"), "Search");
  assert.equal(t("zh-Hant", "chat.jumpLatest"), "跳到最新");
  assert.equal(t("en", "chat.jumpLatest"), "Jump to latest");
  assert.equal(t("zh-Hant", "chat.copy"), "複製");
  assert.equal(t("en", "chat.copied"), "Copied");
  assert.equal(t("zh-Hant", "chat.code"), "程式碼");
});


test("session statuses and exact backend defaults follow the selected locale", () => {
  for (const status of ["preparing", "running", "waiting_approval", "waiting_input", "disconnected", "unknown", "completed", "interrupted"]) {
    assert.doesNotMatch(taskStatusLabel("en", status), /[\u4e00-\u9fff]/);
    assert.match(taskStatusLabel("zh-Hant", status), /[\u4e00-\u9fff]/);
  }
  assert.equal(taskStatusLabel("en", "future_runtime_status"), "Status unconfirmed");
  assert.equal(taskStatusLabel("zh-Hant", "constructor"), "等待確認狀態");
  assert.equal(localizeTaskNotice("en", "Hermes 要求核准以下操作。"), "Hermes requests approval for the following action.");
  assert.equal(localizeTaskNotice("en", "Hermes 等待補充資訊。"), "Hermes is waiting for more information.");
  assert.equal(localizeTaskNotice("zh-Hant", "Hermes is waiting for more information."), "Hermes 等待補充資訊。");
  const actualQuestion = "請選擇 report.csv 或 report.xlsx";
  assert.equal(localizeTaskNotice("en", actualQuestion), actualQuestion);
  const command = "echo 'Hermes 等待補充資訊。'";
  assert.equal(localizeTaskNotice("en", command), command);
});

test("queued upload error keys can change language without reuploading", () => {
  for (const key of ["error.audioVideo", "error.fileKind", "error.fileTooBig", "error.uploadFail"] as const) {
    assert.doesNotMatch(localizeNotice("en", key), /[\u4e00-\u9fff]/);
    assert.match(localizeNotice("zh-Hant", key), /[\u4e00-\u9fff]/);
  }
  assert.equal(t("en", "age.minutes", { n: 5 }), "5 min ago");
});


test("official untrusted MCP approval templates preserve tool names and write warning", () => {
  const description = "Server 'fixture_bridge' is configured 'trust: untrusted'. Approve to run 'fixture_probe' once, or deny to block it.";
  const operation = "MCP tool 'fixture_probe' on UNTRUSTED server 'fixture_bridge' wants to run. This tool is write-capable (no readOnlyHint=true annotation) and may modify external state.";
  assert.equal(localizeTaskNotice("zh-Hant", description), "伺服器「fixture_bridge」設定為「trust: untrusted」。允許一次即可執行「fixture_probe」，或拒絕以阻止執行。");
  assert.equal(localizeTaskNotice("zh-Hant", operation), "不受信任的伺服器「fixture_bridge」上的 MCP 工具「fixture_probe」要求執行。此工具具備寫入能力（未標註 readOnlyHint=true），可能修改外部狀態。");
  assert.equal(localizeTaskNotice("en", description), description);
  assert.equal(localizeTaskNotice("en", operation), operation);
  for (const arbitrary of [`echo "${operation}"`, `The model said: ${description}`, `${operation} Additional instructions.`]) {
    assert.equal(localizeTaskNotice("zh-Hant", arbitrary), arbitrary);
  }
});


test("approval deadlines use only upstream duration or expiry in both languages", () => {
  assert.deepEqual(approvalDeadlineLabels("zh-Hant", { timeoutSeconds: 37 }), ["期限：37 秒"]);
  assert.deepEqual(approvalDeadlineLabels("en", { timeoutSeconds: 37 }), ["Time limit: 37 seconds"]);
  assert.deepEqual(approvalDeadlineLabels("zh-Hant", {}), ["Hermes 未提供期限"]);
  assert.deepEqual(approvalDeadlineLabels("en", {}), ["No deadline provided by Hermes"]);
  assert.deepEqual(approvalDeadlineLabels("en", { timeoutSeconds: -1, expiresAt: "invalid" }), ["No deadline provided by Hermes"]);
  assert.deepEqual(approvalDeadlineLabels("en", { timeoutSeconds: Infinity }), ["No deadline provided by Hermes"]);
  assert.deepEqual(approvalDeadlineLabels("en", { timeoutSeconds: 0 }), ["Time limit: 0 seconds"]);
  const expiresAt = "2026-09-09T00:00:00Z";
  const expiryOnly = approvalDeadlineLabels("zh-Hant", { expiresAt });
  assert.equal(expiryOnly.length, 1);
  assert.match(expiryOnly[0], /^截止時間：/);
  const both = approvalDeadlineLabels("en", { timeoutSeconds: 37, expiresAt });
  assert.equal(both[0], "Time limit: 37 seconds");
  assert.match(both[1], /^Deadline: /);
});
