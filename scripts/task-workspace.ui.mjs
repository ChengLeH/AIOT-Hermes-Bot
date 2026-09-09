import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { chromium, webkit } from "playwright";

const now = Date.now();
const profile = {
  name: "orion",
  display_name: "Orion",
  available: true,
  canonical_session_id: "ui-test-orion",
};
const capabilities = {
  attachments: true,
  attachment_uploads: true,
  attachment_downloads: true,
  durable_events: true,
  completion_events: true,
  dynamic_completions: true,
  interrupts: true,
};
const tasks = [
  {
    id: "task-first",
    title: "First session",
    status: "running",
    mode: "fork",
    botId: "hp:orion",
    profile: "orion",
    createdAt: now - 1_000,
    updatedAt: now,
  },
  {
    id: "task-second",
    title: "Second session",
    status: "completed",
    mode: "independent",
    botId: "hp:orion",
    profile: "orion",
    createdAt: now - 2_000,
    updatedAt: now - 500,
  },
];
const details = Object.fromEntries(tasks.map((task) => [
  task.id,
  {
    ...task,
    messages: [
      { id: `${task.id}-user`, role: "user", content: `Open ${task.title}` },
      { id: `${task.id}-assistant`, role: "assistant", content: `${task.title} detail` },
    ],
  },
]));

async function waitForPanel(page, panel, taskId = null) {
  await page.waitForFunction(
    ({ expectedPanel, expectedTaskId }) => {
      const state = window.history.state;
      return state?.aiotTaskPanel === expectedPanel &&
        (expectedTaskId === null || state?.aiotTaskId === expectedTaskId);
    },
    { expectedPanel: panel, expectedTaskId: taskId },
  );
  assert.equal(await page.locator('head link[rel="stylesheet"][href*="/assets/styles-"]').count(), 1, 'Session navigation must retain the document stylesheet');
  assert.equal(await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(7, 7, 8)', 'Session navigation must retain the styled app background');
}

async function freePort() {
  const socket = createNetServer();
  await new Promise((resolve, reject) => socket.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = socket.address();
  assert(address && typeof address === "object");
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

const port = await freePort();
const devServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
devServer.stdout.on("data", (chunk) => { serverOutput += chunk; });
devServer.stderr.on("data", (chunk) => { serverOutput += chunk; });
let browser;
try {
  const baseUrl = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) break;
    } catch { /* server is still starting */ }
    if (Date.now() >= deadline) throw new Error(`Vite did not start:\n${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // A channel launch still uses an isolated temporary profile. It never joins
  // or controls the user's interactive Chrome session.
  browser = process.env.AIOT_UI_BROWSER_CHANNEL === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: process.env.AIOT_UI_BROWSER_CHANNEL === "chromium" ? undefined : "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    colorScheme: "dark",
    locale: "en-US",
  });
  let profileProbeFails = false;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/__aiot/setup") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ origin: "https://ui-test.invalid", apiKey: "ui-test-key" }) });
    }
    if (url.pathname === "/api/bot/sessions/status") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true }) });
    }
    if (url.pathname === "/api/bot/sessions/list") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tasks }) });
    }
    if (url.pathname === "/api/bot/sessions/detail") {
      const task = details[url.searchParams.get("id")];
      return route.fulfill({ status: task ? 200 : 404, contentType: "application/json", body: JSON.stringify(task ? { task } : { error: "missing" }) });
    }
    if (url.pathname === "/__aiot/hermes") {
      const path = url.searchParams.get("path") || "";
      if (path.startsWith("/api/bot/profiles")) {
        if (profileProbeFails) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic probe failure" }) });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profiles: [profile], transport: "native-bot", capabilities }) });
      }
      if (path.startsWith("/api/bot/events")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [], durable: true }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return route.abort();
    return route.continue();
  });

  await context.addInitScript(() => {
    window.__cardFrames = [];
    document.addEventListener("animationstart", (event) => {
      if (!/^(chat-card|task-session)-(enter|exit)$/.test(event.animationName)) return;
      const element = event.target;
      const record = { name: event.animationName, positions: [], ended: false };
      window.__cardFrames.push(record);
      const started = performance.now();
      const sample = () => {
        if (!element.isConnected) return;
        record.positions.push(element.getBoundingClientRect().left);
        if (!record.ended && performance.now() - started < 500) requestAnimationFrame(sample);
      };
      const end = (finished) => {
        if (finished.target !== element || finished.animationName !== event.animationName) return;
        record.positions.push(element.getBoundingClientRect().left);
        record.ended = true;
        element.removeEventListener("animationend", end);
      };
      element.addEventListener("animationend", end);
      sample();
    });
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.exposeFunction("__setProfileProbeFailure", (fails) => { profileProbeFails = Boolean(fails); });
  await page.goto(`${baseUrl}?aiot_setup=ui-test`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("button", { name: /Orion/ }).click({ timeout: 10_000 });
  } catch (error) {
    const body = (await page.locator("body").innerText()).slice(0, 1_000);
    throw new Error(`Could not enter the synthetic Bot. url=${page.url()} body=${JSON.stringify(body)} browserErrors=${JSON.stringify(browserErrors)}`, { cause: error });
  }
  await page.waitForFunction(() => window.__cardFrames.some((frame) => frame.name === "chat-card-enter"));
  const tasksButton = () => page.getByRole("button", { name: /^(Tasks|任務管理)$/ });
  const chatTasksButton = () => page.locator(".task-navigation > button");
  await chatTasksButton().click();
  await waitForPanel(page, "manager");

  await page.getByRole("button", { name: /^First session / }).click();
  await waitForPanel(page, "detail", "task-first");
  await page.waitForFunction(() => window.__cardFrames.some((frame) => frame.name === "task-session-enter"));
  await assert.doesNotReject(() => page.getByRole("dialog").getByText("First session", { exact: true }).waitFor());

  await page.evaluate(async () => {
    await window.__setProfileProbeFailure(true);
    window.dispatchEvent(new Event("focus"));
  });
  await chatTasksButton().waitFor({ state: "detached" });
  await waitForPanel(page, "detail", "task-first");
  await assert.doesNotReject(() => page.getByRole("dialog").getByText("First session", { exact: true }).waitFor());
  await page.evaluate(async () => {
    await window.__setProfileProbeFailure(false);
    window.dispatchEvent(new Event("focus"));
  });
  await chatTasksButton().waitFor();

  await tasksButton().click();
  await waitForPanel(page, "manager", "task-first");
  await page.getByRole("button", { name: /^Second session / }).click();
  await waitForPanel(page, "detail", "task-second");
  await assert.doesNotReject(() => page.getByRole("dialog").getByText("Second session", { exact: true }).waitFor());

  await tasksButton().click();
  await waitForPanel(page, "manager", "task-second");
  await page.getByRole("button", { name: /^(Close tasks|關閉任務管理)$/ }).click();
  await waitForPanel(page, "detail", "task-second");
  await assert.doesNotReject(() => page.getByRole("dialog").getByText("Second session", { exact: true }).waitFor());

  await page.getByRole("dialog").getByRole("button", { name: /^(Close|關閉)$/ }).click();
  await page.waitForFunction(() => window.history.state?.aiotTaskPanel === undefined);
  assert.equal(await chatTasksButton().count(), 1, "closing Session should return to the Bot chat");
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
  assert.equal(await page.getByRole("dialog").count(), 0, "closing Session must not reopen or leave another panel behind");

  // A real status transition while the Bot is visible, rather than only
  // loading a fixture that was already completed before entering the chat.
  const completionDocumentId = await page.evaluate(() => window.__completionDocumentId = crypto.randomUUID());
  tasks[0].status = "completed";
  details[tasks[0].id].status = "completed";
  const completionBubble = page.locator(".chat-view-card").getByText(/(?:Task completed: |任務已完成：)First session/);
  try { await completionBubble.waitFor({ timeout: 10_000 }); }
  catch (error) { throw new Error(`Completion sync missing: ${await page.locator("body").innerText()} errors=${JSON.stringify(browserErrors)}`, { cause: error }); }
  for (let poll = 0; poll < 3; poll++) {
    await page.waitForTimeout(2100);
    assert.equal(await completionBubble.count(), 1, "completed Session must sync exactly one Bot summary across polls");
    assert.equal(await page.evaluate(() => window.__completionDocumentId), completionDocumentId, "completion sync must not reload the document");
    assert.equal(await page.locator(".launch-screen").count(), 0, "completion sync must not reintroduce the startup Logo");
    assert.equal(await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(7, 7, 8)', "completion sync must retain CSS");
    assert.equal(await chatTasksButton().count(), 1, "completion sync must preserve the Bot view");
  }

  for (const name of ["chat-card-enter", "task-session-enter", "task-session-exit"]) {
    const moved = await page.evaluate((expected) => window.__cardFrames.some((frame) =>
      frame.name === expected && frame.positions.length >= 2 && Math.max(...frame.positions) - Math.min(...frame.positions) > 20), name);
    assert.equal(moved, true, `${name} must render intermediate horizontal motion, not merely an animation name`);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.history.state?.aiotView === "roster" && window.history.state?.aiotTaskPanel === undefined);
  assert.equal(await page.getByRole("button", { name: /Orion/ }).count(), 1, "a cold reopen should start at the contact roster");
  assert.equal(await chatTasksButton().count(), 0, "a cold reopen must not restore the previous Bot chat");

  await page.getByRole("button", { name: /Orion/ }).click();
  await chatTasksButton().waitFor();
  assert.equal(new URL(page.url()).hash, "#aiot-chat", "opening a Bot should create a distinct chat URL entry");
  await page.waitForFunction(() => document.querySelector(".chat-view-card")?.getAttribute("data-card-motion") === "idle");
  await page.getByRole("button", { name: /^(Back|返回)$/ }).click();
  await page.waitForFunction(() => window.__cardFrames.some((frame) => frame.name === "chat-card-exit"));
  await page.waitForFunction(() => window.history.state?.aiotView === "roster");
  assert.equal(new URL(page.url()).hash, "", "Bot back navigation should restore the roster URL");
  assert.equal(await page.getByRole("button", { name: /Orion/ }).count(), 1, "Bot back navigation should return to the roster");

  assert.equal(await page.evaluate(() => window.__cardFrames.some((frame) =>
    frame.name === "chat-card-exit" && frame.positions.length >= 2 && Math.max(...frame.positions) - Math.min(...frame.positions) > 20)), true, "header Back must render a horizontal card exit");
  // Repeat the exact Contacts -> Bot -> Contacts path: the reported iPhone
  // regression usually occurs on the second visit, not the first one.
  await page.locator(".launch-screen").waitFor({ state: "detached" });
  const documentId = await page.evaluate(() => window.__aiotDocumentId = crypto.randomUUID());
  for (let round = 0; round < 10; round++) {
    await page.getByRole("button", { name: /Orion/ }).click();
    await chatTasksButton().waitFor();
    if (round < 3) {
      // Leave live polling running beyond the reported five-second trigger.
      await page.waitForTimeout(6500);
      assert.equal(await page.locator('.launch-screen').count(), 0, 'idle Bot must not return to startup');
      assert.equal(await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(7, 7, 8)', 'idle Bot must retain CSS');
    }
    await page.waitForFunction(() => document.querySelector(".chat-view-card")?.getAttribute("data-card-motion") === "idle");
  await page.getByRole("button", { name: /^(Back|返回)$/ }).click();
    try {
      await page.waitForFunction(() => window.history.state?.aiotView === "roster", null, { timeout: 5000 });
    } catch (error) {
      throw new Error(JSON.stringify(await page.evaluate((round) => ({ round, state: history.state, css: document.styleSheets.length, motion: document.querySelector('.chat-view-card')?.getAttribute('data-card-motion'), body: document.body.innerText.slice(0, 600), frames: window.__cardFrames.slice(-3) }), round)), { cause: error });
    }
    await page.getByRole("button", { name: /Orion/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__aiotDocumentId), documentId, "panel navigation must not reload the document");
    assert.equal(await page.locator(".launch-screen").count(), 0, "panel navigation must not remount the startup screen");
    assert.equal(await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(7, 7, 8)', "repeated Bot navigation must retain CSS");
  }
  await context.close();
  console.log("task workspace browser regression passed");
} finally {
  await browser?.close();
  devServer.kill("SIGTERM");
}
