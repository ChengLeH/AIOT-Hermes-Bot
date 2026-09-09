import { createHash, randomBytes } from "node:crypto";

const TTL = 600_000;
const fail = () => new Error("Dashboard sign-in unavailable; sign in again.");
const opaque = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const MAX_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const hasControlCharacter = value => [...value].some(character => character.charCodeAt(0) <= 31);

function legacyBootstrap(html) {
  // Read data literals only; never evaluate the Dashboard's JavaScript.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => match[1]);
  const auth = scripts.flatMap(script => [...script.matchAll(/window\.__HERMES_AUTH_REQUIRED__\s*=\s*(true|false)\s*;/g)]);
  const tokens = scripts.flatMap(script => [...script.matchAll(/window\.__HERMES_SESSION_TOKEN__\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g)]);
  if (auth.length !== 1 || auth[0][1] !== "false" || tokens.length !== 1) throw fail();
  const token = JSON.parse(tokens[0][1]);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(token)) throw fail();
  return token;
}

function origin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (value !== url.origin && value !== `${url.origin}/`)) throw fail();
  return url.origin;
}

function callback(value) {
  if (typeof value !== "string" || !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?\//.test(value)) throw fail();
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.port === "0") throw fail();
  return url.href;
}

function tokens(value) {
  if (!value || value.token_type !== "Bearer" || typeof value.access_token !== "string" || !value.access_token ||
      typeof value.refresh_token !== "string" || !value.refresh_token || typeof value.provider !== "string" ||
      !Number.isFinite(value.expires_at) || value.expires_at <= 0) throw fail();
  return { access_token: value.access_token, refresh_token: value.refresh_token,
    provider: value.provider, expires_at: value.expires_at, token_type: "Bearer" };
}

/**
 * Server-only native Dashboard Session broker. read/write MUST use encrypted persistence.
 * owner is a server-minted 256-bit base64url/hex connection scope, never a client session ID.
 * Only start/finish/status sanitized results may be serialized to a browser. ticket is
 * for the server-side Dashboard WS connector. Callers enforce loopback setup + CSRF.
 */
export function createSessionAuth({ read, write, fetchImpl = globalThis.fetch, now = Date.now }) {
  if (typeof read !== "function" || typeof write !== "function" || typeof fetchImpl !== "function") throw fail();
  const pending = new Map();
  const locks = new Map();
  const configCache = new Map();
  const checkOwner = (owner) => { if (!opaque(owner) && !(typeof owner === "string" && /^[a-f0-9]{64}$/i.test(owner))) throw fail(); };
  const sanitized = (record) => record ? {
    authenticated: true, dashboardOrigin: record.dashboardOrigin, expiresAt: record.expires_at,
  } : { authenticated: false };

  async function safely(action) {
    try { return await action(); } catch { throw fail(); }
  }
  async function locked(owner, action) {
    checkOwner(owner);
    const previous = locks.get(owner) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    locks.set(owner, next);
    try { return await next; } finally { if (locks.get(owner) === next) locks.delete(owner); }
  }
  async function load(owner) {
    const record = await read(owner);
    if (!record) return null;
    if (record.owner !== owner) throw fail();
    return { owner, dashboardOrigin: origin(record.dashboardOrigin), ...tokens(record) };
  }
  async function post(dashboardOrigin, path, body, bearer) {
    const response = await fetchImpl(`${dashboardOrigin}${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { status: response.status, data: null };
    return { status: response.status, data: await response.json() };
  }
  async function boundedText(response) {
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_BOOTSTRAP_BYTES || !response.body || typeof response.body.getReader !== "function") throw fail();
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BOOTSTRAP_BYTES) throw fail();
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks).toString("utf8");
  }
  async function bootstrapGet(dashboardOrigin, path, expectedType) {
    const endpoint = `${dashboardOrigin}${path}`;
    const response = await fetchImpl(endpoint, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(10_000), headers: { Accept: expectedType }, cache: "no-store" });
    // Fetch redirect:error is authoritative; also reject transformed/custom fetch responses.
    if (!response.ok || response.redirected || (response.url && response.url !== endpoint) ||
        !response.headers?.get("content-type")?.toLowerCase().includes(expectedType)) throw fail();
    return boundedText(response);
  }
  async function refresh(owner, record) {
    const result = await post(record.dashboardOrigin, "/auth/native/refresh", {
      refresh_token: record.refresh_token, provider: record.provider,
    });
    if (!result.data) {
      if (result.status === 401) await write(owner, null);
      throw fail();
    }
    const rotated = { owner, dashboardOrigin: record.dashboardOrigin, ...tokens(result.data) };
    await write(owner, rotated);
    return rotated;
  }
  async function configGet(record, profile, headers) {
    const endpoint = `${record.dashboardOrigin}/api/config?profile=${encodeURIComponent(profile)}`;
    const response = await fetchImpl(endpoint, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json", ...headers }, cache: "no-store" });
    if (!response.ok || response.redirected || (response.url && response.url !== endpoint)) return { status: response.status, data: null };
    if (!response.headers?.get("content-type")?.toLowerCase().includes("application/json")) throw fail();
    return { status: response.status, data: JSON.parse(await boundedText(response)) };
  }

  return {
    start({ dashboardOrigin, callbackUrl, owner, provider = "" }) {
      try {
        checkOwner(owner);
        const dashboard = origin(dashboardOrigin);
        const redirect = callback(callbackUrl);
        if (typeof provider !== "string" || provider.length > 200 || hasControlCharacter(provider)) throw fail();
        for (const [state, entry] of pending) {
          if (entry.expiresAt <= now() || entry.owner === owner) pending.delete(state);
        }
        if (pending.size >= 256) throw fail();
        const state = randomBytes(32).toString("base64url");
        const verifier = randomBytes(32).toString("base64url");
        const url = new URL("/auth/native/authorize", dashboard);
        url.search = new URLSearchParams({ state, redirect_uri: redirect,
          code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
        if (provider) url.searchParams.set("provider", provider);
        pending.set(state, { owner, verifier, dashboardOrigin: dashboard, expiresAt: now() + TTL });
        return { authorizeURL: url.href, state };
      } catch { throw fail(); }
    },
    finish({ code, state }) {
      return safely(async () => {
        const entry = pending.get(state);
        pending.delete(state); // Consume before network I/O, including failed redemptions.
        if (!entry || !opaque(state) || entry.expiresAt <= now() || typeof code !== "string" || !code || code.length > 2048) throw fail();
        return locked(entry.owner, async () => {
          const result = await post(entry.dashboardOrigin, "/auth/native/token", { code, code_verifier: entry.verifier });
          const record = { owner: entry.owner, dashboardOrigin: entry.dashboardOrigin, ...tokens(result.data) };
          await write(entry.owner, record);
          return { owner: entry.owner, ...sanitized(record) };
        });
      });
    },
    status(owner) {
      return safely(() => locked(owner, async () => sanitized(await load(owner))));
    },
    ticket(owner) {
      return safely(() => locked(owner, async () => {
        let record = await load(owner);
        if (!record) throw fail();
        const status = JSON.parse(await bootstrapGet(record.dashboardOrigin, "/api/status", "application/json"));
        if (status.auth_required === false) {
          const html = await bootstrapGet(record.dashboardOrigin, "/", "text/html");
          return { authMode: "legacy", authRequired: false, loopbackToken: legacyBootstrap(html), dashboardOrigin: record.dashboardOrigin };
        }
        if (status.auth_required !== true) throw fail();
        let refreshed = false;
        if (record.expires_at * 1000 <= now() + 30_000) {
          record = await refresh(owner, record);
          refreshed = true;
        }
        let result = await post(record.dashboardOrigin, "/api/auth/ws-ticket", {}, record.access_token);
        if (result.status === 401 && !refreshed) {
          record = await refresh(owner, record);
          result = await post(record.dashboardOrigin, "/api/auth/ws-ticket", {}, record.access_token);
        }
        if (!result.data || typeof result.data.ticket !== "string" || !result.data.ticket ||
            !Number.isFinite(result.data.ttl_seconds) || result.data.ttl_seconds <= 0) throw fail();
        return { ticket: result.data.ticket, ttl_seconds: result.data.ttl_seconds, dashboardOrigin: record.dashboardOrigin };
      }));
    },
    approvalTimeout(owner, profile) {
      return safely(() => locked(owner, async () => {
        if (typeof profile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profile)) throw fail();
        const key = `${owner}\n${profile}`;
        const cached = configCache.get(key);
        if (cached?.expiresAt > now()) return cached.value;
        let record = await load(owner);
        if (!record) throw fail();
        const status = JSON.parse(await bootstrapGet(record.dashboardOrigin, "/api/status", "application/json"));
        let result;
        if (status.auth_required === false) {
          const html = await bootstrapGet(record.dashboardOrigin, "/", "text/html");
          result = await configGet(record, profile, { "X-Hermes-Session-Token": legacyBootstrap(html) });
        } else if (status.auth_required === true) {
          let refreshed = false;
          if (record.expires_at * 1000 <= now() + 30_000) { record = await refresh(owner, record); refreshed = true; }
          result = await configGet(record, profile, { Authorization: `Bearer ${record.access_token}` });
          if (result.status === 401 && !refreshed) {
            record = await refresh(owner, record);
            result = await configGet(record, profile, { Authorization: `Bearer ${record.access_token}` });
          }
        } else throw fail();
        const value = result?.data?.approvals?.timeout;
        if (!result?.data || typeof value !== "number" || !Number.isFinite(value) || value < 0) throw fail();
        for (const [cacheKey, entry] of configCache) if (entry.expiresAt <= now()) configCache.delete(cacheKey);
        configCache.set(key, { value, expiresAt: now() + 30_000 });
        while (configCache.size > 256) configCache.delete(configCache.keys().next().value);
        return value;
      }));
    },
    clear(owner) {
      return safely(() => locked(owner, async () => {
        for (const [state, entry] of pending) if (entry.owner === owner) pending.delete(state);
        for (const key of configCache.keys()) if (key.startsWith(`${owner}\n`)) configCache.delete(key);
        await write(owner, null);
        return { authenticated: false };
      }));
    },
  };
}
