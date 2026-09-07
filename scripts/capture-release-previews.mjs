import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl = process.env.AIOT_PREVIEW_URL || "http://127.0.0.1:8888/";
const output = resolve(process.cwd(), "docs/images");
mkdirSync(output, { recursive: true });

const profiles = [
  { name: "orion", display_name: "Orion", available: true, canonical_session_id: "demo-orion" },
  { name: "studio", display_name: "Studio", available: true, canonical_session_id: "demo-studio" },
  { name: "sage", display_name: "Sage", available: true, canonical_session_id: "demo-sage" },
];

const catalog = {
  profiles,
  transport: "native-bot",
  capabilities: {
    attachments: true,
    attachment_uploads: true,
    attachment_downloads: true,
    max_attachment_bytes: 10485760,
    durable_events: true,
    completion_events: true,
    dynamic_completions: true,
    interrupts: true,
  },
};

const events = [
  { seq: 1, profile: "studio", conversation: "demo-studio", kind: "user_message", payload: { message_id: "m1", text: "整理今天的產品更新。" } },
  { seq: 2, profile: "studio", conversation: "demo-studio", kind: "message", payload: { message_id: "m2", text: "正在整理三項更新與下一步。" } },
  { seq: 3, profile: "studio", conversation: "demo-studio", event_id: "turn-studio", kind: "turn_start", payload: {} },
  { seq: 4, profile: "sage", conversation: "demo-sage", kind: "message", payload: { message_id: "m3", text: "研究摘要已經準備好。" } },
  { seq: 5, profile: "orion", conversation: "demo-orion", kind: "user_message", payload: { message_id: "m4", text: "幫我做一個安全的資料匯出工具。" } },
  { seq: 6, profile: "orion", conversation: "demo-orion", kind: "message", payload: { message_id: "m5", text: "我先建立匯出流程，檔案會保留清楚的欄位名稱：\n\n```ts\nexport const format = \"jsonl\";\nexport const includeAttachments = true;\n```\n\n執行前需要你確認一次。" } },
  { seq: 7, profile: "orion", conversation: "demo-orion", kind: "approval_request", payload: { request_id: "approval-demo", command: "node scripts/export-data.mjs --format jsonl", description: "允許 Orion 在這台電腦建立一份對話匯出檔。", choices: ["once", "session", "deny"], created_at: "2026-09-08T00:00:00Z" } },
];

function storedState(locale, view) {
  return JSON.stringify({
    state: {
      onboarded: true,
      locale,
      view,
      activeBotId: view === "chat" ? "hp:orion" : null,
      composerDrafts: {},
      messages: [],
      approvals: [],
      bots: profiles.map((profile, index) => ({
        id: `hp:${profile.name}`,
        name: profile.display_name,
        title: profile.display_name,
        bio: profile.name,
        swatch: ["steel", "moss", "clay"][index],
        pinned: index === 0,
        createdAt: Date.now() - index * 1000,
        profile: profile.name,
        available: true,
        conversation: profile.canonical_session_id,
      })),
      connection: {
        origin: "https://preview.invalid",
        lastProbe: { ok: true, at: Date.now(), transport: "native-bot", profiles, capabilities: catalog.capabilities },
      },
    },
    version: 0,
  });
}

async function pageFor(browser, { locale, view, viewport }) {
  const context = await browser.newContext({ viewport, colorScheme: "dark", locale: locale === "en" ? "en-US" : "zh-TW" });
  await context.addInitScript(({ state }) => {
    localStorage.setItem("hermes-bot-desk-v4", state);
    localStorage.setItem("hermes.gate.password:https://preview.invalid", "preview-only-connection-key-000000000000");
  }, { state: storedState(locale, view) });
  await context.route("**/__aiot/hermes?*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") || "";
    if (path.startsWith("/api/bot/profiles")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) });
    if (path.startsWith("/api/bot/events")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events, durable: true }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2300);
  if (view === "chat") {
    await page.getByText("Orion", { exact: true }).click();
    await page.waitForTimeout(300);
  }
  return { context, page };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const shot of [
  { name: "mobile-roster-zh.png", locale: "zh-Hant", view: "roster", viewport: { width: 390, height: 844 } },
  { name: "mobile-chat-en.png", locale: "en", view: "roster", openChat: true, viewport: { width: 390, height: 844 } },
  { name: "desktop-chat-zh.png", locale: "zh-Hant", view: "roster", openChat: true, viewport: { width: 1440, height: 960 } },
]) {
  const { context, page } = await pageFor(browser, shot);
  if (shot.openChat) {
    await page.getByText("Orion", { exact: true }).click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: resolve(output, shot.name), fullPage: false });
  await context.close();
}
await browser.close();
console.log(output);
