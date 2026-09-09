import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { supportsNode } from "./aiot-service.mjs";
import { npmInvocation } from "./aiot-platform.mjs";

const modulePath = fileURLToPath(import.meta.url);
const root = resolve(dirname(modulePath), "..");
const runtime = resolve(root, ".aiot");
const lockFile = resolve(root, "package-lock.json");
const installedLock = resolve(runtime, "dependency-lock.sha256");

export function lockDigest(contents) { return createHash("sha256").update(contents).digest("hex"); }
export function dependencyInstallNeeded(currentDigest, recordedDigest, modulesPresent) {
  return !modulesPresent || currentDigest !== String(recordedDigest || "").trim();
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true, ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

export function browserCommand(platform, target) {
  if (platform === "darwin") return { command: "open", args: [target] };
  if (platform === "win32") return { command: "explorer.exe", args: [target] };
  return { command: "xdg-open", args: [target] };
}

export async function ensureDependencies() {
  const digest = lockDigest(readFileSync(lockFile));
  let recorded = "";
  try { recorded = readFileSync(installedLock, "utf8"); } catch { /* first install */ }
  if (!dependencyInstallNeeded(digest, recorded, existsSync(resolve(root, "node_modules/.package-lock.json")))) return;
  const npm = npmInvocation(["ci"]);
  await run(npm.command, npm.args);
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  writeFileSync(installedLock, `${digest}\n`, { mode: 0o600 });
}

export async function bootstrap() {
  if (!supportsNode()) throw new Error(`AIOT requires Node.js 22.12+. Current: ${process.versions.node}. Download: https://nodejs.org/en/download`);
  await ensureDependencies();
  await run(process.execPath, [resolve(root, "scripts/aiot-service.mjs"), "start"]);
  const target = `http://127.0.0.1:${Number(process.env.AIOT_LOCAL_PORT || 8888)}/`;
  const opener = browserCommand(process.platform, target);
  try {
    await run(opener.command, opener.args, { detached: true, stdio: "ignore" });
  } catch {
    // Headless Linux and locked-down desktops may not provide a browser opener.
    // The service is already healthy; keep it running and print the exact local URL.
    console.log(target);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
