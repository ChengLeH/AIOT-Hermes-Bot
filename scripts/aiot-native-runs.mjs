import { createPrivateStateCipher } from "./aiot-private-state.mjs";
import { handleJobs } from "./aiot-jobs.mjs";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { sessionMessages } from "./aiot-session-history.mjs";
import { loadRunContext } from "./aiot-run-context.mjs";

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;

function json(res, status, value) {
  const raw = JSON.stringify(value);
  if (typeof res.writeHead === "function") res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  else res.statusCode = status;
  res.end(raw);
}

async function bodyJson(req, limit = 64 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("request_too_large");
  }
  return JSON.parse(raw || "{}");
}

function dotenv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function configPort(path) {
  if (!existsSync(path)) return 0;
  const text = readFileSync(path, "utf8");
  const explicit = text.match(/^\s*API_SERVER_PORT:\s*(\d+)\s*$/m);
  return explicit ? Number(explicit[1]) : 0;
}

function safeLoopbackOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function profilePrefix(profile) {
  return profile === "default" ? "" : `/p/${encodeURIComponent(profile)}`;
}

function featureFlags(raw) {
  const features = raw && typeof raw.features === "object" ? raw.features : {};
  const endpoints = raw && typeof raw.endpoints === "object" ? raw.endpoints : {};
  const on = (...keys) => keys.some((key) => features[key] === true || typeof endpoints[key] === "string" || (endpoints[key] && typeof endpoints[key] === "object"));
  return {
    run_submission: on("run_submission", "runs"),
    run_status: on("run_status"),
    run_events_sse: on("run_events_sse", "run_events"),
    run_approval_response: on("run_approval_response", "run_approval"),
    run_stop: on("run_stop"),
    skills: on("skills_api", "skills"),
  };
}

function skillRows(raw, query) {
  const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const q = String(query || "").replace(/^\/+/, "").toLowerCase();
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name || (q && !name.toLowerCase().includes(q))) return [];
    return [{ label: name, insert: `/${name}`, description: typeof row.description === "string" ? row.description : "", group: "Skills", kind: "skill" }];
  }).slice(0, 100);
}

export function createNativeRunsService({
  dataDir,
  hermesHome = process.env.HERMES_HOME || join(homedir(), ".hermes"),
  fetchImpl = fetch,
  apiOrigin = process.env.AIOT_HERMES_API_ORIGIN || "",
  loadTaskResultContext = async () => [],
} = {}) {
  const root = dataDir || join(process.cwd(), ".aiot");
  const privateState = createPrivateStateCipher({ dataDir: root, fileName: "native-runs.json" });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let state = { historyResetAt: 0, nextSeq: 1, runs: {}, events: [], queues: {} };
  {
    const saved = privateState.read(() => null);
    if (saved && typeof saved === "object") state = { historyResetAt: Number(saved.historyResetAt) || 0, nextSeq: Number(saved.nextSeq) || 1, runs: saved.runs && typeof saved.runs === "object" ? saved.runs : {}, events: Array.isArray(saved.events) ? saved.events : [], queues: saved.queues && typeof saved.queues === "object" ? saved.queues : {} };
  }
  // Old snapshots did not date chat events. Recover their source run time,
  // never the time the proxy restarts or the browser replays them.
  for (const event of state.events) {
    if (event.payload?.created_at == null && Number.isFinite(state.runs[event.event_id]?.createdAt)) {
      event.payload = { ...event.payload, created_at: state.runs[event.event_id].createdAt };
    }
  }
  // Migrate a legacy plaintext snapshot before accepting new work. Never overwrite corrupt ciphertext.
  privateState.write(state);
  const tasks = new Map();
  const endpoints = new Map();
  const authCache = new Map();
  const deliveryScopes = new Map();
  const queueLocks = new Map();
  let closed = false;

  function cacheAuthorization(key, value) {
    authCache.delete(key);
    authCache.set(key, value);
    while (authCache.size > 64) authCache.delete(authCache.keys().next().value);
  }

  function save() {
    if (closed) return;
    privateState.write(state);
  }

  function append(profile, conversation, eventId, kind, payload = {}) {
    const event = { source: "native-runs", seq: state.nextSeq++, profile, conversation, event_id: eventId, kind, payload: { created_at: Date.now(), ...payload } };
    state.events.push(event);
    state.events = state.events.slice(-10_000);
    save();
    return event;
  }

  function envFor(profile) {
    const profileDir = profile === "default" ? hermesHome : join(hermesHome, "profiles", profile);
    return { ...dotenv(join(hermesHome, ".env")), ...dotenv(join(profileDir, ".env")) };
  }

  function portFor(profile, env) {
    const direct = Number(env.API_SERVER_PORT);
    if (Number.isInteger(direct) && direct > 0 && direct < 65536) return direct;
    const profileDir = profile === "default" ? hermesHome : join(hermesHome, "profiles", profile);
    const local = configPort(join(profileDir, "config.yaml"));
    if (local) return local;
    const rootPort = configPort(join(hermesHome, "config.yaml"));
    if (rootPort) return rootPort;
    try {
      for (const entry of readdirSync(join(hermesHome, "profiles"), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = configPort(join(hermesHome, "profiles", entry.name, "config.yaml"));
        if (candidate) return candidate;
      }
    } catch {
      // A deployment without named profiles still uses the documented default port.
    }
    return 8642;
  }

  async function endpoint(profile) {
    if (!PROFILE_RE.test(profile)) return null;
    const cached = endpoints.get(profile);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const env = envFor(profile);
    const apiKey = env.API_SERVER_KEY || "";
    if (apiKey.length < 16) return null;
    const configured = safeLoopbackOrigin(apiOrigin);
    const origin = configured || `http://127.0.0.1:${portFor(profile, env)}`;
    const base = `${origin}${profilePrefix(profile)}`;
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
    try {
      const response = await fetchImpl(`${base}/v1/capabilities`, { headers, redirect: "error", signal: AbortSignal.timeout(4000) });
      if (!response.ok) return null;
      const raw = await response.json();
      const value = { profile, base, apiKey, headers, capabilities: featureFlags(raw), raw };
      endpoints.set(profile, { value, expiresAt: Date.now() + 30_000 });
      return value;
    } catch {
      return null;
    }
  }

  async function authorize(req, botTarget) {
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || !/^Bearer \S+$/.test(authorization)) return 401;
    const cacheKey = createHash("sha256").update(`${botTarget}\n${authorization}`).digest("hex");
    const cached = authCache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) return cached.status;
    if (cached?.pending) return cached.pending;
    const pending = (async () => {
      try {
        const response = await fetchImpl(`${botTarget.replace(/\/$/, "")}/profiles`, { headers: { Authorization: authorization, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(4000) });
        const status = response.ok ? 0 : response.status === 401 || response.status === 403 ? response.status : 503;
        cacheAuthorization(cacheKey, { status, expiresAt: Date.now() + (status === 0 ? 10_000 : 1_000) });
        return status;
      } catch {
        cacheAuthorization(cacheKey, { status: 503, expiresAt: Date.now() + 1_000 });
        return 503;
      }
    })();
    cacheAuthorization(cacheKey, { pending, expiresAt: 0 });
    return pending;
  }

  async function forRun(runId) {
    const run = state.runs[runId];
    if (!run || !PROFILE_RE.test(run.profile)) return { run: null, endpoint: null };
    return { run, endpoint: await endpoint(run.profile) };
  }

  function matchingRun(profile, conversation, requestId = "") {
    return Object.values(state.runs).filter((run) =>
      run.profile === profile && run.conversation === conversation &&
      (!requestId || run.approvalRequestId === requestId),
    ).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  }
  const queueKey=(profile,conversation)=>`${profile}\n${conversation}`;
  const activeRun=(profile,conversation)=>Object.values(state.runs).find(run=>run.profile===profile&&run.conversation===conversation&&!TERMINAL.has(run.status));
  async function drainQueue(key) {
    if(queueLocks.has(key))return queueLocks.get(key);
    const pending=(async()=>{
      const item=state.queues[key]?.[0];const scope=deliveryScopes.get(key);
      if(!item||item.status==='paused'||!scope||activeRun(item.profile,item.conversation))return;
      const ep=await endpoint(item.profile);
      if(!ep?.capabilities.run_submission||!ep.capabilities.run_events_sse)return;
      item.status='dispatching';item.idempotency ||= randomUUID();delete item.error;save();
      let conversationHistory;
      try { conversationHistory=await loadRunContext(fetchImpl,ep,item.conversation); }
      catch(error){item.status='paused';item.error=error.message==='context_too_large'?'context_too_large':'context_unavailable';save();return;}
      try { const references=await loadTaskResultContext(scope.botTarget,scope.authorization,item.profile,item.conversation);if(Array.isArray(references))conversationHistory.push(...references.filter(message=>message?.role==='assistant'&&typeof message.content==='string')); } catch {
        // A failed optional result-memory lookup must not block the queued turn.
      }
      try {
        const headers={...ep.headers,'Content-Type':'application/json','Idempotency-Key':item.idempotency,'X-Hermes-Session-Key':`aiot:${item.profile}:${item.conversation}`};
        const response=await fetchImpl(`${ep.base}/v1/runs`,{method:'POST',headers,body:JSON.stringify({input:item.text,session_id:item.conversation,conversation_history:conversationHistory}),redirect:'error'});
        const value=await response.json().catch(()=>({}));
        if(!response.ok||!ID_RE.test(String(value.run_id||''))){item.status='paused';item.error='run_not_accepted';save();return;}
        state.queues[key].shift();if(!state.queues[key].length)delete state.queues[key];
        const run={runId:value.run_id,requestId:item.id,profile:item.profile,conversation:item.conversation,status:'started',output:'',published:'',createdAt:Date.now()};
        state.runs[run.runId]=run;append(run.profile,run.conversation,run.runId,'user_message',{message_id:`native-user-${run.runId}`,text:item.text});append(run.profile,run.conversation,run.runId,'turn_start',{});launch(run,ep);
      } catch { item.status='dispatching';save(); }
    })().finally(()=>queueLocks.delete(key));
    queueLocks.set(key,pending);return pending;
  }

  function translate(run, event) {
    const name = String(event?.event || "");
    if (name === "message.delta") {
      run.output = `${run.output || ""}${typeof event.delta === "string" ? event.delta : ""}`;
      if (run.output !== run.published && /(?:[。！？.!?][\]})"'”’]*\s*|\n\s*\n)$/.test(run.output)) {
        run.published = run.output;
        append(run.profile, run.conversation, run.runId, "edit", { message_id: `native-${run.runId}`, text: run.output });
      }
    } else if (name === "tool.started" || name === "tool.completed" || name === "tool.failed") {
      append(run.profile, run.conversation, run.runId, name.replace(".", "_"), { tool: event.tool, preview: event.preview, duration: event.duration, error: event.error });
    } else if (name === "reasoning.available" || name === "subagent.start" || name === "subagent.complete") {
      append(run.profile, run.conversation, run.runId, name.replace(".", "_"), { text: event.text || event.preview || event.summary || "", status: event.status });
    } else if (name === "approval.request") {
      run.approvalRequestId = typeof event.request_id === "string" ? event.request_id : "";
      append(run.profile, run.conversation, run.runId, "approval_request", {
        request_id: run.approvalRequestId,
        command: event.command,
        description: event.description,
        choices: event.choices,
        created_at: typeof event.timestamp === "number" ? event.timestamp * 1000 : Date.now(),
        timeout_seconds: event.timeout_seconds,
      });
    } else if (name === "approval.responded") {
      append(run.profile, run.conversation, run.runId, "approval_resolved", { request_id: event.request_id || run.approvalRequestId, choice: event.choice });
    } else if (["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(name)) {
      const outcome = name === "run.completed" ? "success" : name === "run.failed" ? "failure" : "cancelled";
      const output = typeof event.output === "string" && event.output ? event.output : run.output || "";
      if (output && output !== run.published) append(run.profile, run.conversation, run.runId, "edit", { message_id: `native-${run.runId}`, text: output });
      run.output = output;
      run.published = output;
      run.status = name.slice(4);
      append(run.profile, run.conversation, run.runId, "turn_complete", { outcome });
      queueMicrotask(()=>void drainQueue(queueKey(run.profile,run.conversation)));
    }
    save();
  }

  function translateStatus(run, value) {
    if (!value || typeof value !== "object") return false;
    const status = String(value.status || "");
    if (status === "waiting_for_approval" && value.approval && typeof value.approval === "object") {
      const requestId = typeof value.approval.request_id === "string" ? value.approval.request_id : "";
      if (requestId && requestId !== run.approvalRequestId) translate(run, { event: "approval.request", ...value.approval });
    }
    if (TERMINAL.has(status)) {
      translate(run, { event: `run.${status}`, output: value.output });
      return true;
    }
    run.status = status || run.status;
    save();
    return false;
  }

  async function pollUntilTerminal(run, ep) {
    while (!closed && !TERMINAL.has(run.status)) {
      try {
        const response = await fetchImpl(`${ep.base}/v1/runs/${encodeURIComponent(run.runId)}`, { headers: ep.headers, redirect: "error", signal: AbortSignal.timeout(6000) });
        if (response.ok && translateStatus(run, await response.json())) return;
        if (response.status === 404) {
          translate(run, { event: "run.interrupted" });
          return;
        }
      } catch {
        // Temporary status failures are retried while the local service remains active.
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function consume(run, ep) {
    try {
      const response = await fetchImpl(`${ep.base}/v1/runs/${encodeURIComponent(run.runId)}/events`, { headers: ep.headers, redirect: "error" });
      if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (data) {
            try { translate(run, JSON.parse(data)); } catch {
              // Ignore malformed third-party SSE frames without ending a healthy run.
            }
          }
        }
        if (done) break;
      }
      if (!TERMINAL.has(run.status)) {
        const status = await fetchImpl(`${ep.base}/v1/runs/${encodeURIComponent(run.runId)}`, { headers: ep.headers, redirect: "error" });
        if (status.ok && translateStatus(run, await status.json())) return;
      }
    } catch {
      // The official stream is intentionally single-subscriber. If it drops,
      // the durable status endpoint remains the source of truth.
    } finally {
      save();
    }
    if (!TERMINAL.has(run.status)) await pollUntilTerminal(run, ep);
  }

  function launch(run, ep, mode = "events") {
    if (closed || tasks.has(run.runId) || TERMINAL.has(run.status)) return;
    const task = (mode === "events" ? consume(run, ep) : pollUntilTerminal(run, ep))
      .finally(() => tasks.delete(run.runId));
    tasks.set(run.runId, task);
  }

  async function resumePersistedRuns() {
    for (const run of Object.values(state.runs)) {
      if (closed || TERMINAL.has(run.status) || tasks.has(run.runId)) continue;
      const ep = await endpoint(run.profile);
      if (ep) launch(run, ep, "status");
    }
  }

  async function controlRun(res, run, ep, action, input) {
    if (action === "approval") {
      const choice = typeof input.choice === "string" ? input.choice : "";
      const requestId = typeof input.request_id === "string" ? input.request_id : "";
      if (!["once", "session", "always", "deny"].includes(choice) || !ID_RE.test(requestId)) return json(res, 400, { error: "invalid_approval" });
      const response = await fetchImpl(`${ep.base}/v1/runs/${encodeURIComponent(run.runId)}/approval`, { method: "POST", headers: { ...ep.headers, "Content-Type": "application/json" }, body: JSON.stringify({ choice, request_id: requestId }), redirect: "error" });
      const value = await response.json().catch(() => ({}));
      if (response.ok) append(run.profile, run.conversation, run.runId, "approval_resolved", { request_id: requestId, choice });
      return json(res, response.status, value);
    }
    const response = await fetchImpl(`${ep.base}/v1/runs/${encodeURIComponent(run.runId)}/stop`, { method: "POST", headers: { ...ep.headers, "Content-Type": "application/json" }, body: "{}", redirect: "error" });
    return json(res, response.status, await response.json().catch(() => ({})));
  }

  async function handle(req, res, botTarget) {
    const unauthorized = await authorize(req, botTarget);
    if (unauthorized) return json(res, unauthorized, { error: unauthorized === 401 ? "connection_key_required" : "connection_unavailable" });
    const incoming = new URL(req.url || "/", "http://localhost");
    const path = incoming.pathname;
    if (path === "/api/bot/native/jobs" || path.startsWith("/api/bot/native/jobs/")) {
      const profile = incoming.searchParams.get("profile") || "";
      if (!PROFILE_RE.test(profile)) return json(res, 400, { error: "invalid_profile" });
      try {
        const result = await handleJobs({ req, incoming, ep: await endpoint(profile), profile, fetchImpl, readBody: bodyJson });
        return json(res, result.status, result.value);
      } catch { return json(res, 400, { error: "invalid_request" }); }
    }


    if (req.method === "GET" && path === "/api/bot/native/capabilities") {
      const profile = incoming.searchParams.get("profile") || "";
      const ep = await endpoint(profile);
      return ep ? json(res, 200, { available: true, profile, features: ep.capabilities }) : json(res, 404, { available: false, profile, features: {} });
    }

    if (req.method === "GET" && path === "/api/bot/native/history") {
      const profile = incoming.searchParams.get("profile") || "";
      const conversation = incoming.searchParams.get("conversation") || "";
      if (!PROFILE_RE.test(profile) || !ID_RE.test(conversation)) return json(res, 400, { error: "invalid_request" });
      const ep = await endpoint(profile);
      if (!ep) return json(res, 404, { messages: [] });
      // Probe the real Session endpoint, even when capability metadata lags.
      // Never select another session or create a replacement on a 404.
      const response = await fetchImpl(`${ep.base}/api/sessions/${encodeURIComponent(conversation)}/messages?order=latest&limit=500`, { headers: ep.headers, redirect: "error", signal: AbortSignal.timeout(6000) });
      if (!response.ok) return json(res, response.status, { messages: [] });
      const value = await response.json();
      if (!Array.isArray(value?.data)) return json(res, 502, { error: "invalid_session_response" });
      return json(res, 200, { conversation, messages: sessionMessages(value, profile, value.session_id || conversation) });
    }

    if (req.method === "GET" && path === "/api/bot/native/skills") {
      const profile = incoming.searchParams.get("profile") || "";
      const ep = await endpoint(profile);
      if (!ep?.capabilities.skills) return json(res, 404, { items: [] });
      const response = await fetchImpl(`${ep.base}/v1/skills`, { headers: ep.headers, redirect: "error", signal: AbortSignal.timeout(6000) });
      return json(res, response.ok ? 200 : response.status, { items: response.ok ? skillRows(await response.json(), incoming.searchParams.get("query")) : [] });
    }

    if (req.method === "POST" && path === "/api/bot/native/runs") {
      let input;
      try { input = await bodyJson(req); } catch { return json(res, 400, { error: "invalid_json" }); }
      const profile = typeof input.profile === "string" ? input.profile : "";
      const conversation = typeof input.conversation === "string" ? input.conversation.trim() : "";
      const text = typeof input.text === "string" ? input.text.trim() : "";
      const requestId=typeof input.requestId==='string'?input.requestId:'';
      if (!PROFILE_RE.test(profile) || !conversation || !text || !/^[a-f0-9-]{36}$/i.test(requestId) || Object.keys(input).some((key) => !["profile", "conversation", "text", "requestId"].includes(key))) return json(res, 400, { error: "invalid_request" });
      const ep = await endpoint(profile);
      if (!ep?.capabilities.run_submission || !ep.capabilities.run_events_sse) return json(res, 409, { error: "native_runs_unavailable" });
      const key=queueKey(profile,conversation);deliveryScopes.set(key,{botTarget,authorization:req.headers.authorization});
      const fingerprint=createHash('sha256').update(text).digest('hex');
      const existingRun=Object.values(state.runs).find(run=>run.requestId===requestId&&run.profile===profile&&run.conversation===conversation);
      if(existingRun)return json(res,202,{run_id:existingRun.runId,status:existingRun.status});
      const existing=state.queues[key]?.find(item=>item.id===requestId);
      if(existing){if(existing.fingerprint!==fingerprint)return json(res,409,{error:'request_conflict'});return json(res,202,{queue_id:existing.id,status:existing.status});}
      state.queues[key] ||= [];
      if(state.queues[key].length>=20)return json(res,409,{error:'queue_full'});
      state.queues[key].push({id:requestId,fingerprint,text,profile,conversation,status:'queued',createdAt:Date.now()});save();
      await drainQueue(key);
      const run=Object.values(state.runs).find(candidate=>candidate.requestId===requestId&&candidate.profile===profile&&candidate.conversation===conversation);
      return json(res,202,run?{run_id:run.runId,status:run.status}:{queue_id:requestId,status:state.queues[key]?.find(item=>item.id===requestId)?.status||'queued'});
    }

    if(req.method==='GET'&&path==='/api/bot/native/queue'){
      const profile=incoming.searchParams.get('profile')||'';const conversation=incoming.searchParams.get('conversation')||'';
      if(!PROFILE_RE.test(profile)||!ID_RE.test(conversation))return json(res,400,{error:'invalid_request'});
      const key=queueKey(profile,conversation);deliveryScopes.set(key,{botTarget,authorization:req.headers.authorization});void drainQueue(key);
      return json(res,200,{items:(state.queues[key]||[]).map(({id,text,status,createdAt})=>({id,text,status,createdAt}))});
    }

    if (req.method === "GET" && path === "/api/bot/native/events") {
      const after = Number(incoming.searchParams.get("after") || 0);
      if (!Number.isSafeInteger(after) || after < 0) return json(res, 400, { error: "invalid_cursor" });
      return json(res, 200, { events: state.events.filter((event) => event.seq > after).slice(0, 100), durable: true, historyResetAt: state.historyResetAt });
    }

    const control = path.match(/^\/api\/bot\/native\/runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,255})\/(approval|stop)$/);
    if (req.method === "POST" && control) {
      const { run, endpoint: ep } = await forRun(control[1]);
      if (!run || !ep) return json(res, 404, { error: "run_not_found" });
      let input;
      try { input = await bodyJson(req); } catch { return json(res, 400, { error: "invalid_json" }); }
      return controlRun(res, run, ep, control[2], input);
    }

    const approval = path.match(/^\/api\/bot\/native\/approvals\/([A-Za-z0-9][A-Za-z0-9_-]{0,255})$/);
    if (req.method === "POST" && approval) {
      let input;
      try { input = await bodyJson(req); } catch { return json(res, 400, { error: "invalid_json" }); }
      const run = matchingRun(input.profile, input.conversation, approval[1]);
      if (!run) return json(res, 404, { error: "run_not_found" });
      const ep = await endpoint(run.profile);
      if (!ep) return json(res, 404, { error: "run_not_found" });
      return controlRun(res, run, ep, "approval", { request_id: approval[1], choice: input.choice });
    }

    if (req.method === "POST" && path === "/api/bot/native/interrupts") {
      let input;
      try { input = await bodyJson(req); } catch { return json(res, 400, { error: "invalid_json" }); }
      const run = matchingRun(input.profile, input.conversation);
      if (!run || TERMINAL.has(run.status)) return json(res, 404, { error: "run_not_found" });
      const ep = await endpoint(run.profile);
      if (!ep) return json(res, 404, { error: "run_not_found" });
      return controlRun(res, run, ep, "stop", {});
    }

    return json(res, 404, { error: "not_found" });
  }

  const resumeTask = resumePersistedRuns();

  return {
    handle,
    events: async (after = 0) => ({ events: state.events.filter((event) => event.seq > after).slice(0, 100), durable: true, historyResetAt: state.historyResetAt }),
    settled: async (runId) => {
      await resumeTask;
      const task = tasks.get(runId);
      if (task) await task;
    },
    close: () => { closed = true; },
  };
}
