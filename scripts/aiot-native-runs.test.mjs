import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createNativeRunsService } from "./aiot-native-runs.mjs";

function request(method, url, body, authorization = "Bearer browser-key") {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) };
  return req;
}

async function call(service, method, url, body) {
  let status = 0;
  let raw = "";
  await service.handle(request(method, url, body), {
    writeHead(code) { status = code; },
    setHeader() {},
    end(value = "") { raw += value; },
  }, "http://bot.local/api/bot");
  return { status, body: raw ? JSON.parse(raw) : {} };
}

test("official Hermes runs stay behind the browser Bot key and keep API_SERVER_KEY local", async () => {
  const root = mkdtempSync(join(tmpdir(), "aiot-native-runs-"));
  const profile = join(root, "profiles", "demo");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, ".env"), "API_SERVER_KEY=official-secret-key\nAPI_SERVER_PORT=9864\n");
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === "http://bot.local/api/bot/profiles") {
      return new Response(JSON.stringify({ profiles: [{ name: "demo", available: true }] }), {
        status: options.headers?.Authorization === "Bearer browser-key" ? 200 : 401,
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(options.headers?.Authorization, "Bearer official-secret-key");
    if (String(url).endsWith("/v1/capabilities")) {
      return Response.json({ features: { run_submission: true, run_events_sse: true, run_approval_response: true, run_stop: true, skills_api: true }, endpoints: { skills: { method: "GET", path: "/v1/skills" } } });
    }
    if (String(url).endsWith("/v1/skills")) {
      return Response.json({ data: [{ name: "h3-prompt", description: "H3 prompts" }, { name: "host-bridge", description: "Host access" }] });
    }
    if (String(url).includes("/api/sessions/bot-chat/messages")) return Response.json({ data: [{ role: "user", content: "previous question" }, { role: "assistant", content: "previous answer" }] });
    if (String(url).endsWith("/v1/runs") && options.method === "POST") {
      assert.deepEqual(JSON.parse(options.body), { input: "hello", session_id: "bot-chat", conversation_history: [{role:"user",content:"previous question"},{role:"assistant",content:"previous answer"},{role:"assistant",content:"Completed task reference"}] });
      assert.ok(options.headers["Idempotency-Key"]);
      return Response.json({ run_id: "run-one", status: "started" }, { status: 202 });
    }
    if (String(url).endsWith("/v1/runs/run-one/events")) {
      const frames = [
        { event: "message.delta", run_id: "run-one", delta: "Hello " },
        { event: "tool.started", run_id: "run-one", tool: "terminal", preview: "Working" },
        { event: "approval.request", run_id: "run-one", request_id: "req-12345678", command: "git status", description: "Read status", choices: ["once", "deny"], timeout_seconds: 600 },
        { event: "message.delta", run_id: "run-one", delta: "world." },
        { event: "run.completed", run_id: "run-one", output: "Hello world." },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      return new Response(frames, { headers: { "content-type": "text/event-stream" } });
    }
    if (String(url).endsWith("/v1/runs/run-one/approval")) {
      assert.deepEqual(JSON.parse(options.body), { choice: "once", request_id: "req-12345678" });
      return Response.json({ resolved: 1, choice: "once" });
    }
    if (String(url).endsWith("/v1/runs/run-one/stop")) return Response.json({ status: "stopping" });
    throw new Error(`Unexpected request: ${url}`);
  };
  const resultContextCalls = [];
  const service = createNativeRunsService({ dataDir: join(root, "state"), hermesHome: root, fetchImpl,
    loadTaskResultContext: async (...args) => { resultContextCalls.push(args); return [{ role: "assistant", content: "Completed task reference" }]; } });
  try {
    assert.equal((await call(service, "GET", "/api/bot/native/capabilities?profile=demo")).status, 200);
    const skills = await call(service, "GET", "/api/bot/native/skills?profile=demo&query=h3");
    assert.equal(skills.status, 200);
    assert.deepEqual(skills.body.items.map((item) => item.insert), ["/h3-prompt"]);

    const started = await call(service, "POST", "/api/bot/native/runs", { profile: "demo", conversation: "bot-chat", text: "hello", requestId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(started.status, 202);
    assert.equal(started.body.run_id, "run-one");
    assert.deepEqual(resultContextCalls, [["http://bot.local/api/bot", "Bearer browser-key", "demo", "bot-chat"]]);
    await service.settled("run-one");

    const events = await call(service, "GET", "/api/bot/native/events?after=0");
    assert.equal(events.status, 200);
    assert.ok(events.body.events.some((event) => event.kind === "turn_start"));
    assert.ok(events.body.events.some((event) => event.kind === "tool_started"));
    assert.ok(events.body.events.some((event) => event.kind === "approval_request" && event.payload.request_id === "req-12345678"));
    assert.ok(events.body.events.some((event) => event.kind === "edit" && event.payload.text === "Hello world."));
    assert.ok(events.body.events.some((event) => event.kind === "turn_complete" && event.payload.outcome === "success"));

    assert.equal((await call(service, "POST", "/api/bot/native/runs/run-one/approval", { request_id: "req-12345678", choice: "once" })).status, 200);
    assert.equal((await call(service, "POST", "/api/bot/native/runs/run-one/stop", {})).status, 200);
    assert.equal(JSON.stringify(requests).includes("browser-key"), true);
    assert.equal(JSON.stringify(requests.filter((row) => row.url.includes("9864"))).includes("browser-key"), false);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing or unsupported official API fails closed without breaking legacy Bot transport", async () => {
  const root = mkdtempSync(join(tmpdir(), "aiot-native-missing-"));
  const service = createNativeRunsService({
    dataDir: join(root, "state"),
    hermesHome: root,
    fetchImpl: async (url, options = {}) => String(url).includes("/profiles")
      ? new Response(JSON.stringify({ profiles: [] }), { status: options.headers?.Authorization ? 200 : 401 })
      : new Response("not found", { status: 404 }),
  });
  try {
    const features = await call(service, "GET", "/api/bot/native/capabilities?profile=demo");
    assert.equal(features.status, 404);
    assert.equal(features.body.available, false);
    assert.equal((await call(service, "POST", "/api/bot/native/runs", { profile: "demo", conversation: "c", text: "hi", requestId: "22222222-2222-4222-8222-222222222222" })).status, 409);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("active Bot turns queue in FIFO order and duplicate requests never submit twice", async () => {
  const root = mkdtempSync(join(tmpdir(), "aiot-native-queue-"));
  const profile = join(root, "profiles", "demo");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, ".env"), "API_SERVER_KEY=official-secret-key\nAPI_SERVER_PORT=9864\n");
  let firstEvents;
  const submissions = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target === "http://bot.local/api/bot/profiles") return Response.json({ profiles: [{ name: "demo", available: true }] });
    if (target.endsWith("/v1/capabilities")) return Response.json({ features: { run_submission: true, run_events_sse: true } });
    if (target.includes("/api/sessions/chat/messages")) return Response.json({ data: [] });
    if (target.endsWith("/v1/runs") && options.method === "POST") {
      const body = JSON.parse(options.body);
      submissions.push({ input: body.input, idempotency: options.headers["Idempotency-Key"] });
      return Response.json({ run_id: body.input === "first" ? "run-first" : "run-second" }, { status: 202 });
    }
    if (target.endsWith("/v1/runs/run-first/events")) {
      return new Response(new ReadableStream({ start(controller) { firstEvents = controller; } }), { headers: { "content-type": "text/event-stream" } });
    }
    if (target.endsWith("/v1/runs/run-second/events")) {
      return new Response(`data: ${JSON.stringify({ event: "run.completed", output: "second done" })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createNativeRunsService({ dataDir: join(root, "state"), hermesHome: root, fetchImpl });
  const firstId = "33333333-3333-4333-8333-333333333333";
  const secondId = "44444444-4444-4444-8444-444444444444";
  try {
    const first = await call(service, "POST", "/api/bot/native/runs", { profile: "demo", conversation: "chat", text: "first", requestId: firstId });
    assert.equal(first.body.run_id, "run-first");
    const queued = await call(service, "POST", "/api/bot/native/runs", { profile: "demo", conversation: "chat", text: "second", requestId: secondId });
    assert.equal(queued.body.queue_id, secondId);
    const duplicate = await call(service, "POST", "/api/bot/native/runs", { profile: "demo", conversation: "chat", text: "second", requestId: secondId });
    assert.equal(duplicate.body.queue_id, secondId);
    assert.deepEqual((await call(service, "GET", "/api/bot/native/queue?profile=demo&conversation=chat")).body.items.map((item) => item.text), ["second"]);
    assert.deepEqual(submissions.map((item) => item.input), ["first"]);

    firstEvents.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ event: "run.completed", output: "first done" })}\n\n`));
    firstEvents.close();
    await service.settled("run-first");
    for (let attempt = 0; submissions.length < 2 && attempt < 20; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(submissions.map((item) => item.input), ["first", "second"]);
    assert.equal(new Set(submissions.map((item) => item.idempotency)).size, 2);
    await service.settled("run-second");
    assert.deepEqual((await call(service, "GET", "/api/bot/native/queue?profile=demo&conversation=chat")).body.items, []);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a persisted run resumes from durable status without replaying token deltas", async () => {
  const root = mkdtempSync(join(tmpdir(), "aiot-native-resume-"));
  const profile = join(root, "profiles", "demo");
  const stateDir = join(root, "state");
  mkdirSync(profile, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(profile, ".env"), "API_SERVER_KEY=official-secret-key\nAPI_SERVER_PORT=9864\n");
  writeFileSync(join(stateDir, "native-runs.json"), JSON.stringify({
    nextSeq: 4,
    runs: {
      "run-resume": {
        runId: "run-resume",
        profile: "demo",
        conversation: "bot-chat",
        status: "running",
        output: "Partial sentence",
        published: "",
        createdAt: 1,
      },
    },
    events: [],
  }));
  const fetchImpl = async (url, options = {}) => {
    assert.equal(options.headers?.Authorization, "Bearer official-secret-key");
    if (String(url).endsWith("/v1/capabilities")) {
      return Response.json({ features: { run_submission: true, run_status: true, run_events_sse: true } });
    }
    if (String(url).endsWith("/v1/runs/run-resume")) {
      return Response.json({ run_id: "run-resume", status: "completed", output: "Recovered final answer." });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createNativeRunsService({ dataDir: stateDir, hermesHome: root, fetchImpl });
  try {
    await service.settled("run-resume");
    const page = await service.events(0);
    assert.deepEqual(page.events.map((event) => event.kind), ["edit", "turn_complete"]);
    assert.equal(page.events[0].payload.text, "Recovered final answer.");
    assert.equal(page.events[1].payload.outcome, "success");
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Session reads probe exact conversation despite absent flags and strip private fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "aiot-session-read-"));
  mkdirSync(join(root, 'profiles', 'demo'), { recursive: true });
  writeFileSync(join(root, 'profiles', 'demo', '.env'), 'API_SERVER_KEY=official-secret-key\nAPI_SERVER_PORT=9864\n');
  const paths = [];
  const service = createNativeRunsService({ dataDir: join(root, 'state'), hermesHome: root, fetchImpl: async (url) => {
    paths.push(String(url));
    if (String(url).endsWith('/profiles')) return Response.json({profiles:[]});
    if (String(url).endsWith('/v1/capabilities')) return Response.json({features:{}});
    if (String(url).endsWith('/api/sessions/bot-chat/messages?order=latest&limit=500')) return Response.json({session_id:'continued-chat',data:[{id:5,role:'assistant',content:'Reply',timestamp:1700000000,reasoning:'private'}]});
    return Response.json({}, {status:404});
  }});
  try {
    const result = await call(service,'GET','/api/bot/native/history?profile=demo&conversation=bot-chat');
    assert.equal(result.status,200);
    assert.deepEqual(result.body,{conversation:'bot-chat',messages:[{messageId:'hermes-demo:continued-chat:5',role:'assistant',text:'Reply',createdAt:1700000000000}]});
    assert.equal((await call(service,'GET','/api/bot/native/history?profile=demo&conversation=missing')).status,404);
    assert.equal(paths.some(path => path.endsWith('/api/sessions')),false);
  } finally { service.close(); rmSync(root,{recursive:true,force:true}); }
});

test("legacy undated events recover persisted source run time rather than restart time", async () => {
  const root = mkdtempSync(join(tmpdir(), "aiot-native-event-time-"));
  writeFileSync(join(root, "native-runs.json"), JSON.stringify({
    nextSeq: 2,
    runs: { older: { runId: "older", profile: "demo", conversation: "chat", status: "completed", createdAt: 1700000000123 } },
    events: [{ seq: 1, source: "native-runs", event_id: "older", kind: "message", profile: "demo", conversation: "chat", payload: { message_id: "native-older", text: "Old answer" } }],
  }));
  const service = createNativeRunsService({ dataDir: root, hermesHome: root });
  try {
    const page = await service.events(0);
    assert.equal(page.events[0].payload.created_at, 1700000000123);
  } finally { service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("history reset marker survives encrypted service restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "aiot-reset-marker-"));
  const { createPrivateStateCipher } = await import("./aiot-private-state.mjs");
  const cipher = createPrivateStateCipher({ dataDir: root, fileName: "native-runs.json" });
  cipher.write({ nextSeq: 42, runs: {}, events: [], queues: {}, historyResetAt: 1780000000000 });
  const service = createNativeRunsService({ dataDir: root, hermesHome: root });
  try {
    const page = await service.events(0);
    assert.equal(page.historyResetAt, 1780000000000);
    assert.deepEqual(page.events, []);
    assert.equal(cipher.read(() => null).historyResetAt, 1780000000000);
  } finally { service.close(); rmSync(root, { recursive: true, force: true }); }
});
