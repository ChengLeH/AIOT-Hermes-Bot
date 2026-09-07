import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const ROUTE = "/__aiot/hermes";
const SETUP_ROUTE = "/__aiot/setup";
const execFileAsync = promisify(execFile);
const setupTokens = new Map();
const SETUP_TOKEN_TTL_MS = 2 * 60 * 1000;
const runtimeFile = resolve(process.cwd(), ".aiot/runtime.json");

function samePageOrigin(req) {
  const caller = req.headers.origin;
  if (!caller) return true;
  const host = req.headers.host;
  return caller === `http://${host}` || caller === `https://${host}`;
}

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", (part) => {
      size += part.length;
      if (size > 11 * 1024 * 1024) {
        reject(new Error("request_too_large"));
        req.destroy();
        return;
      }
      parts.push(part);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(body.length));
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(body);
}

function isLoopbackHost(host = "") {
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

function localProxy(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return null;
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function httpsPort(origin) {
  const url = new URL(origin);
  return url.port || "443";
}

async function tailscaleJson() {
  const { stdout } = await execFileAsync("tailscale", ["serve", "status", "--json"], {
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout || "{}");
}

async function isConfiguredTailscaleOrigin(origin) {
  try {
    const target = new URL(origin);
    const status = await tailscaleJson();
    return Boolean(status?.Web?.[`${target.hostname}:${httpsPort(origin)}`]);
  } catch {
    return false;
  }
}

function readRuntimeTarget() {
  try {
    const saved = JSON.parse(readFileSync(runtimeFile, "utf8"));
    const target = localProxy(saved?.hermesBotTarget || "");
    return target?.toString() || "";
  } catch {
    return "";
  }
}

function writeRuntimeTarget(target) {
  mkdirSync(dirname(runtimeFile), { recursive: true, mode: 0o700 });
  writeFileSync(runtimeFile, `${JSON.stringify({ hermesBotTarget: target }, null, 2)}\n`, { mode: 0o600 });
}

function botTargetUrl(base, incoming) {
  const target = new URL(base);
  const suffix = incoming.pathname.replace(/^\/api\/bot/, "");
  target.pathname = `${target.pathname.replace(/\/$/, "")}${suffix}`;
  target.search = incoming.search;
  return target;
}

async function proxyRequest(req, res, targetUrl) {
  try {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      return json(res, 405, { error: "method_not_allowed" });
    }
    const headers = new Headers();
    for (const name of ["accept", "authorization", "content-type", "range"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const body = method === "GET" ? undefined : await requestBody(req);
    const upstream = await fetch(targetUrl, { method, headers, body, redirect: "manual" });
    res.statusCode = upstream.status;
    for (const name of ["content-type", "content-length", "content-disposition", "cache-control", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("x-content-type-options", "nosniff");
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    json(res, 502, { error: error instanceof Error ? error.message : "proxy_failed" });
  }
}

async function configureAiot(origin, localUrl) {
  const target = new URL(origin);
  const status = await tailscaleJson();
  const hostKey = `${target.hostname}:${httpsPort(origin)}`;
  const web = status?.Web?.[hostKey];
  if (!web?.Handlers) throw new Error("找不到這個網址原本的 Tailscale Serve 映射");

  const rootProxy = web.Handlers["/"]?.Proxy;
  const botProxy = web.Handlers["/api/bot"]?.Proxy;
  const localApp = localProxy(localUrl);
  if (!localApp) throw new Error("AIOT 本機服務位址無效");

  let upstream = botProxy ? localProxy(botProxy) : null;
  if (!upstream) {
    const original = rootProxy ? localProxy(rootProxy) : null;
    if (!original || original.origin === localApp.origin) {
      throw new Error("找不到原本的 Hermes Bot 目的地，Tailscale 路由沒有被修改");
    }
    original.pathname = `${original.pathname.replace(/\/$/, "")}/api/bot`;
    upstream = original;
  }

  const port = httpsPort(origin);
  writeRuntimeTarget(upstream.toString());
  if (botProxy) {
    await execFileAsync("tailscale", ["serve", `--https=${port}`, "--set-path=/api/bot", "off"]);
  }
  await execFileAsync("tailscale", ["serve", "--bg", `--https=${port}`, localUrl]);
  return `${target.origin}/`;
}

async function localSetup(req, res, incoming) {
  if (req.method === "GET") {
    const token = incoming.searchParams.get("token") || "";
    const saved = setupTokens.get(token);
    setupTokens.delete(token);
    if (!saved || saved.expiresAt < Date.now()) return json(res, 404, { error: "setup_expired" });
    return json(res, 200, { origin: saved.origin, apiKey: saved.apiKey });
  }

  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
  if (!isLoopbackHost(req.headers.host || "") || !samePageOrigin(req)) {
    return json(res, 403, { error: "local_setup_only" });
  }
  try {
    const raw = await requestBody(req);
    const body = JSON.parse(raw.toString("utf8") || "{}");
    const origin = exactHttpsOrigin(body.origin || "");
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!origin || !apiKey) return json(res, 400, { error: "missing_connection" });
    const host = (req.headers.host || "127.0.0.1").replace(/^localhost/i, "127.0.0.1");
    const publicUrl = await configureAiot(origin, `http://${host}`);
    const token = randomBytes(24).toString("base64url");
    setupTokens.set(token, { origin, apiKey, expiresAt: Date.now() + SETUP_TOKEN_TTL_MS });
    return json(res, 200, { url: `${publicUrl}?aiot_setup=${encodeURIComponent(token)}` });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : "setup_failed" });
  }
}

function middleware() {
  return async (req, res, next) => {
    const incoming = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (incoming.pathname === "/api/bot" || incoming.pathname.startsWith("/api/bot/")) {
      const base = readRuntimeTarget();
      if (!base) return json(res, 503, { error: "aiot_not_configured" });
      return proxyRequest(req, res, botTargetUrl(base, incoming));
    }
    if (incoming.pathname === SETUP_ROUTE) return localSetup(req, res, incoming);
    if (incoming.pathname !== ROUTE) return next();
    if (!samePageOrigin(req)) {
      res.statusCode = 403;
      return res.end("origin_rejected");
    }
    const origin = exactHttpsOrigin(incoming.searchParams.get("origin") || "");
    const path = incoming.searchParams.get("path") || "";
    if (!origin || !path.startsWith("/api/bot/")) {
      res.statusCode = 400;
      return res.end("invalid_hermes_target");
    }
    if (!(await isConfiguredTailscaleOrigin(origin))) {
      res.statusCode = 403;
      return res.end("origin_not_configured_in_tailscale");
    }
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      res.statusCode = 405;
      return res.end("method_not_allowed");
    }
    try {
      return proxyRequest(req, res, new URL(`${origin}${path}`));
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "proxy_failed" }));
    }
  };
}

export function aiotHermesProxyPlugin() {
  return {
    name: "aiot:hermes-proxy",
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}
