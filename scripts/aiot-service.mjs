import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(root, ".aiot");
const pidFile = resolve(runtime, "aiot.pid");
const logFile = resolve(runtime, "aiot.log");
const port = Number(process.env.AIOT_LOCAL_PORT || 8888);
const url = `http://127.0.0.1:${port}/`;
const action = process.argv[2] || "start";

function savedPid() {
  try {
    const value = Number(readFileSync(pidFile, "utf8").trim());
    return Number.isInteger(value) && value > 1 ? value : 0;
  } catch {
    return 0;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ready() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function start() {
  if (await ready()) {
    console.log(url);
    return;
  }
  const oldPid = savedPid();
  if (oldPid && !alive(oldPid)) rmSync(pidFile, { force: true });
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const fd = openSync(logFile, "a", 0o600);
  const child = spawn(process.execPath, [resolve(root, "scripts/aiot-server.mjs"), root, String(port)], {
    cwd: root,
    detached: true,
    env: { ...process.env, VITE_AUTH_ENABLED: "false", AIOT_USE_KEYCHAIN: process.platform === "darwin" ? "1" : "0" },
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  closeSync(fd);
  writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await ready()) {
      console.log(url);
      return;
    }
    if (!alive(child.pid)) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`AIOT did not start. See ${logFile}`);
}

async function stop() {
  const pid = savedPid();
  if (alive(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
  rmSync(pidFile, { force: true });
}

if (action === "start") await start();
else if (action === "stop") await stop();
else if (action === "status") process.exit((await ready()) ? 0 : 1);
else throw new Error("Usage: aiot-service.mjs start|stop|status");
