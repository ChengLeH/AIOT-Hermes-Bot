import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createSessionAuth } from "./aiot-session-auth.mjs";

function fixture() {
  let time = 1_000_000;
  const owner = randomBytes(32).toString("base64url");
  const stored = new Map();
  const calls = [];
  let responder = () => ({ access_token: "secret-access", refresh_token: "secret-refresh", token_type: "Bearer", provider: "oidc", expires_at: time / 1000 + 3600 });
  let bootstrapResponder = url => new Response(JSON.stringify({ auth_required: true }), { headers: { 'content-type': 'application/json' } });
  const auth = createSessionAuth({
    now: () => time,
    read: async (key) => structuredClone(stored.get(key)),
    write: async (key, value) => { if (value) stored.set(key, structuredClone(value)); else stored.delete(key); },
    fetchImpl: async (url, init) => {
      if (init.method === 'GET') return bootstrapResponder(url, init);
      calls.push({ url, ...init, body: JSON.parse(init.body) });
      const data = responder(url, init);
      return { ok: !data.httpStatus, status: data.httpStatus || 200, json: async () => data };
    },
  });
  const start = (extra = {}) => auth.start({ dashboardOrigin: "https://dashboard.example", callbackUrl: "http://127.0.0.1:18080/api/session/callback", owner, ...extra });
  return { auth, owner, stored, calls, start, advance: (ms) => { time += ms; }, respond: (fn) => { responder = fn; }, bootstrap: fn => { bootstrapResponder = fn; } };
}

test("official native PKCE exchange persists owner-bound credentials and exposes only sanitized status", async () => {
  const f = fixture();
  const begun = f.start({ provider: "oidc" });
  const url = new URL(begun.authorizeURL);
  assert.equal(url.pathname, "/auth/native/authorize");
  assert.equal(url.searchParams.get("provider"), "oidc");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(Buffer.from(begun.state, "base64url").length, 32);
  assert.equal(url.searchParams.get("code_verifier"), null);
  const result = await f.auth.finish({ state: begun.state, code: "one-time-code" });
  assert.equal(result.owner, f.owner);
  assert.equal(f.calls[0].url, "https://dashboard.example/auth/native/token");
  assert.equal(f.calls[0].redirect, "error");
  assert.ok(f.calls[0].signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ["code", "code_verifier"]);
  assert.equal(Buffer.from(f.calls[0].body.code_verifier, "base64url").length, 32);
  assert.equal(createHash("sha256").update(f.calls[0].body.code_verifier).digest("base64url"), url.searchParams.get("code_challenge"));
  assert.equal(f.stored.get(f.owner).refresh_token, "secret-refresh");
  for (const value of [result, await f.auth.status(f.owner), begun]) assert.doesNotMatch(JSON.stringify(value), /secret-access|secret-refresh|code_verifier|access_token|refresh_token/);
  assert.deepEqual(await f.auth.status(randomBytes(32).toString("base64url")), { authenticated: false });
});

test("state expiry, replay, unknown state and failed redemption fail closed", async () => {
  const f = fixture();
  const first = f.start();
  await f.auth.finish({ state: first.state, code: "code" });
  await assert.rejects(f.auth.finish({ state: first.state, code: "code" }));
  await assert.rejects(f.auth.finish({ state: "unknown", code: "code" }));
  const expired = f.start();
  f.advance(600_000);
  await assert.rejects(f.auth.finish({ state: expired.state, code: "code" }));
  assert.equal(f.calls.length, 1);
  f.respond(() => ({ httpStatus: 400, detail: "sensitive upstream error" }));
  const failed = f.start();
  await assert.rejects(f.auth.finish({ state: failed.state, code: "code" }), /Dashboard sign-in unavailable/);
  await assert.rejects(f.auth.finish({ state: failed.state, code: "code" }));
  assert.equal(f.calls.length, 2);
});

test("strict origins and literal loopback callback; owner cannot be arbitrary task identifier", () => {
  const f = fixture();
  for (const dashboardOrigin of ["http://dashboard.example", "https://user:pass@dashboard.example", "https://dashboard.example/prefix", "https://dashboard.example?x=1", "https://dashboard.example/#hash"])
    assert.throws(() => f.start({ dashboardOrigin }));
  for (const callbackUrl of ["http://localhost:18080/callback", "http://127.1:18080/callback", "https://127.0.0.1/callback", "http://example.com/callback", "http://127.0.0.1:18080/callback?x=1", "http://127.0.0.1:0/callback"])
    assert.throws(() => f.start({ callbackUrl }));
  assert.throws(() => f.start({ owner: "browser-session-id" }));
  assert.ok(f.start({ owner: "a".repeat(64), callbackUrl: "http://[::1]:18081/callback" }).state);
});

test("ticket refresh rotates official bearer credentials once across concurrent calls", async () => {
  const f = fixture();
  const begun = f.start();
  await f.auth.finish({ state: begun.state, code: "code" });
  f.advance(3_600_000);
  f.respond((url) => url.endsWith("/refresh") ? { access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", provider: "oidc", expires_at: 8200 } : { ticket: "ws-one-time", ttl_seconds: 30 });
  const tickets = await Promise.all([f.auth.ticket(f.owner), f.auth.ticket(f.owner)]);
  assert.equal(f.calls.filter((c) => c.url.endsWith("/refresh")).length, 1);
  assert.deepEqual(f.calls[1].body, { refresh_token: "secret-refresh", provider: "oidc" });
  assert.equal(f.calls[2].headers.Authorization, "Bearer new-access");
  assert.equal(f.stored.get(f.owner).refresh_token, "new-refresh");
  assert.equal(tickets[0].ticket, "ws-one-time");
  assert.doesNotMatch(JSON.stringify(tickets), /new-access|new-refresh/);
});

test("401 ticket triggers refresh and clear invalidates pending login and stored credentials", async () => {
  const f = fixture();
  const begun = f.start();
  await f.auth.finish({ state: begun.state, code: "code" });
  f.respond((url, init) => url.endsWith("/refresh") ? { access_token: "new", refresh_token: "rotated", token_type: "Bearer", provider: "oidc", expires_at: 8000 } : init.headers.Authorization === "Bearer new" ? { ticket: "ticket", ttl_seconds: 30 } : { httpStatus: 401 });
  assert.equal((await f.auth.ticket(f.owner)).ticket, "ticket");
  const pending = f.start();
  await f.auth.clear(f.owner);
  await assert.rejects(f.auth.finish({ state: pending.state, code: "code" }));
  assert.deepEqual(await f.auth.status(f.owner), { authenticated: false });
  await assert.rejects(f.auth.ticket(f.owner));
});

test("rejects cross-owner persisted credentials and invalidates rejected refresh credentials", async () => {
  const f = fixture();
  const old = f.start();
  const begun = f.start();
  await assert.rejects(f.auth.finish({ state: old.state, code: "code" }));
  await f.auth.finish({ state: begun.state, code: "code" });
  const other = randomBytes(32).toString("base64url");
  f.stored.set(other, f.stored.get(f.owner));
  await assert.rejects(f.auth.ticket(other));
  assert.equal(f.calls.length, 1);
  f.advance(3_600_000);
  f.respond(() => ({ httpStatus: 401 }));
  await assert.rejects(f.auth.ticket(f.owner));
  assert.equal(f.stored.has(f.owner), false);
  assert.deepEqual(await f.auth.status(f.owner), { authenticated: false });
});

test('explicit nongated status and official root bootstrap permit server-only legacy credential', async () => {
  const f = fixture();
  await f.auth.finish({ state: f.start().state, code: 'code' });
  const gets = [];
  const secret = 'official_legacy_token_123456';
  f.bootstrap((url, init) => {
    gets.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, undefined);
    return url.endsWith('/api/status')
      ? new Response('{"auth_required":false}', { headers: { 'content-type': 'application/json' } })
      : new Response(`<html><script>window.__HERMES_SESSION_TOKEN__="${secret}";window.__HERMES_AUTH_REQUIRED__=false;</script></html>`, { headers: { 'content-type': 'text/html' } });
  });
  assert.deepEqual(await f.auth.ticket(f.owner), { authMode: 'legacy', authRequired: false, dashboardOrigin: 'https://dashboard.example', loopbackToken: secret });
  assert.deepEqual(gets, ['https://dashboard.example/api/status', 'https://dashboard.example/']);
  assert.equal(f.calls.length, 1); // Never attempted ticket or refresh as a downgrade trigger.
  assert.doesNotMatch(JSON.stringify([...f.stored.values()]), /official_legacy/);
  assert.doesNotMatch(JSON.stringify(await f.auth.status(f.owner)), /official_legacy/);
});

test('unknown/gated auth never downgrades; contradictory bootstrap and redirects fail closed', async () => {
  const f = fixture();
  await f.auth.finish({ state: f.start().state, code: 'code' });
  let roots = 0;
  f.bootstrap(url => {
    if (!url.endsWith('/api/status')) roots++;
    return new Response('{"auth_required":true}', { headers: { 'content-type': 'application/json' } });
  });
  f.respond(() => ({ httpStatus: 401 }));
  await assert.rejects(f.auth.ticket(f.owner));
  assert.equal(roots, 0);
  // Restore a valid persisted login for the following independent bootstrap failures.
  f.respond(() => ({ access_token: 'a', refresh_token: 'r', token_type: 'Bearer', provider: 'p', expires_at: 8000 }));
  await f.auth.finish({ state: f.start().state, code: 'code' });
  for (const data of ['{}', '{"auth_required":"false"}']) {
    f.bootstrap(() => new Response(data, { headers: { 'content-type': 'application/json' } }));
    await assert.rejects(f.auth.ticket(f.owner));
  }
  for (const html of [
    '<script>window.__HERMES_SESSION_TOKEN__="secret_1234567890";window.__HERMES_AUTH_REQUIRED__=true;</script>',
    '<script>window.__HERMES_SESSION_TOKEN__="secret_1234567890";</script>',
    '<script>window.__HERMES_SESSION_TOKEN__=getToken();window.__HERMES_AUTH_REQUIRED__=false;</script>',
  ]) {
    f.bootstrap(url => new Response(url.endsWith('/api/status') ? '{"auth_required":false}' : html,
      { headers: { 'content-type': url.endsWith('/api/status') ? 'application/json' : 'text/html' } }));
    await assert.rejects(f.auth.ticket(f.owner));
  }
  f.bootstrap(() => {
    const response = new Response('{"auth_required":false}', { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: 'https://other.example/api/status' });
    return response;
  });
  await assert.rejects(f.auth.ticket(f.owner));
  f.bootstrap(() => new Response('', { status: 302, headers: { location: 'https://other.example/' } }));
  await assert.rejects(f.auth.ticket(f.owner));
});

test('approval timeout returns only a bounded official numeric value and caches by owner/profile', async () => {
  const f = fixture();
  await f.auth.finish({ state: f.start().state, code: 'code' });
  const gets = [];
  f.bootstrap((url, init) => {
    gets.push({ url, init });
    if (url.endsWith('/api/status')) return Response.json({ auth_required: true });
    if (url.includes('/api/config?profile=')) return Response.json({ approvals: { timeout: 45 }, private: { token: 'must-not-return' } });
    throw new Error('unexpected');
  });
  assert.equal(await f.auth.approvalTimeout(f.owner, 'demo'), 45);
  assert.equal(await f.auth.approvalTimeout(f.owner, 'demo'), 45);
  assert.equal(gets.filter(call => call.url.includes('/api/config?')).length, 1);
  assert.equal(gets.find(call => call.url.includes('/api/config?')).init.headers.Authorization, 'Bearer secret-access');
  for (const value of [-1, Infinity, '45', null]) {
    f.bootstrap(url => url.endsWith('/api/status') ? Response.json({ auth_required: true }) : Response.json({ approvals: { timeout: value } }));
    await assert.rejects(f.auth.approvalTimeout(f.owner, `bad-${String(value).replace(/\W/g, '')}`), /Dashboard sign-in unavailable/);
  }
});

test('legacy approval timeout uses only the official bootstrapped session token', async () => {
  const f = fixture();
  await f.auth.finish({ state: f.start().state, code: 'code' });
  const secret = 'official_legacy_token_123456';
  let configHeaders;
  f.bootstrap((url, init) => {
    if (url.endsWith('/api/status')) return Response.json({ auth_required: false });
    if (url === 'https://dashboard.example/') return new Response(`<script>window.__HERMES_SESSION_TOKEN__="${secret}";window.__HERMES_AUTH_REQUIRED__=false;</script>`, { headers: { 'content-type': 'text/html' } });
    configHeaders = init.headers;
    return Response.json({ approvals: { timeout: 0 } });
  });
  assert.equal(await f.auth.approvalTimeout(f.owner, 'demo'), 0);
  assert.equal(configHeaders['X-Hermes-Session-Token'], secret);
  assert.equal(configHeaders.Authorization, undefined);
});
