import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const root = resolve(dirname(modulePath), "..");
const runtime = resolve(root, ".aiot");
const pidFile = resolve(runtime, "aiot.pid");
const logFile = resolve(runtime, "aiot.log");
const port = Number(process.env.AIOT_LOCAL_PORT || 8888);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid AIOT port");
const url = `http://127.0.0.1:${port}/`;

export function supportsNode(version = process.versions.node) {
  const [major = 0, minor = 0] = String(version).replace(/^v/, "").split(".").map(Number);
  return (major === 22 && minor >= 12) || major > 22;
}

function savedPid() {
  try {
    const value = Number(readFileSync(pidFile, "utf8").trim());
    return Number.isInteger(value) && value > 1 ? value : 0;
  } catch { return 0; }
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function isAiotCommand(command, expectedRoot = root, expectedPort = port) {
  const text = String(command || "");
  return text.includes(resolve(expectedRoot, "scripts/aiot-server.mjs")) && text.includes(String(expectedPort));
}

function capture(command, args) {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveOutput(output) : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function commandForPid(pid) {
  try {
    if (process.platform === "win32") return await capture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`]);
    return await capture("ps", ["-p", String(pid), "-o", "command="]);
  } catch { return ""; }
}

export async function aiotReady(targetUrl = url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetchImpl(new URL("manifest.webmanifest", targetUrl), { signal: controller.signal, cache: "no-store" });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || (!contentType.includes("json") && contentType !== "application/octet-stream")) return false;
    const manifest = await response.json();
    return manifest?.name === "AIOT / Hermes Bot" && manifest?.short_name === "AIOT" && manifest?.id === "/";
  } catch { return false; }
  finally { clearTimeout(timeout); }
}

export async function ownedAiotReady(targetUrl = url, pid = savedPid(), fetchImpl = fetch, commandLookup = commandForPid) {
  if (!pid || !alive(pid) || !await aiotReady(targetUrl, fetchImpl)) return false;
  return isAiotCommand(await commandLookup(pid));
}

async function start() {
  if (!supportsNode()) throw new Error(`AIOT requires Node.js 22.12+. Current: ${process.versions.node}`);
  if (await ownedAiotReady()) { console.log(url); return; }
  const { ensureDependencies } = await import("./aiot-bootstrap.mjs");
  await ensureDependencies();
  const oldPid = savedPid();
  if (oldPid && alive(oldPid)) {
    const command = await commandForPid(oldPid);
    if (!isAiotCommand(command)) throw new Error(`Refusing to replace unverified process ${oldPid}. Remove ${pidFile} only after checking that process.`);
  } else if (oldPid) rmSync(pidFile, { force: true });
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const fd = openSync(logFile, "a", 0o600);
  const child = spawn(process.execPath, [resolve(root, "scripts/aiot-server.mjs"), root, String(port)], {
    cwd: root,
    detached: true,
    env: { ...process.env, VITE_AUTH_ENABLED: "false", AIOT_USE_KEYCHAIN: process.platform === "darwin" ? "1" : "0" },
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  closeSync(fd);
  writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await ownedAiotReady()) { child.unref(); console.log(url); return; }
    if (!alive(child.pid)) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`AIOT did not start. See ${logFile}`);
}

async function stop() {
  const pid = savedPid();
  if (!pid) return;
  if (!alive(pid)) { rmSync(pidFile, { force: true }); return; }
  const command = await commandForPid(pid);
  if (!isAiotCommand(command)) throw new Error(`Refusing to stop unverified process ${pid}`);
  if (process.platform === "win32") await capture("taskkill.exe", ["/PID", String(pid), "/T"]);
  else { try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); } }
  rmSync(pidFile, { force: true });
}

export async function runService(action = "start") {
  if (action === "start") return start();
  if (action === "stop") return stop();
  if (action === "status") { if (!await ownedAiotReady()) process.exitCode = 1; return; }
  throw new Error("Usage: aiot-service.mjs start|stop|status");
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  runService(process.argv[2] || "start").catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
