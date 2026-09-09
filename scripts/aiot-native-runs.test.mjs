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
      assert.deepEqual(JSON.parse(options.body), { input: "hello", session_id: "bot-chat", conversation_history: [{role:"user",content:"previous question"},{role:"assistant",content:"previous answer"}] });
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
  const service = createNativeRunsService({ dataDir: join(root, "state"), hermesHome: root, fetchImpl });
  try {
    assert.equal((await call(service, "GET", "/api/bot/native/capabilities?profile=demo")).status, 200);
    const skills = await call(service, "GET", "/api/bot/native/skills?profile=demo&query=h3");
    assert.equal(skills.status, 200);
    assert.deepEqual(skills.body.items.map((item) => item.insert), ["/h3-prompt"]);

    const started = await call(service, "POST", "/api/bot/native/runs", { profile: "demo", conversation: "bot-chat", text: "hello" });
    assert.equal(started.status, 202);
    assert.equal(started.body.run_id, "run-one");
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
    assert.equal((await call(service, "POST", "/api/bot/native/runs", { profile: "demo", conversation: "c", text: "hi" })).status, 409);
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
