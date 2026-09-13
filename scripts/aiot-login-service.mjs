import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const root = resolve(dirname(modulePath), "..");
export const launchAgentLabel = "ai.aiot.hermes-bot";

function xml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function loginAgentPath(home = homedir(), label = launchAgentLabel) {
  return resolve(home, "Library", "LaunchAgents", `${label}.plist`);
}

export function loginAgentPlist({ projectRoot = root, node = process.execPath, wrapper = "", logPath } = {}) {
  const service = resolve(projectRoot, "scripts", "aiot-service.mjs");
  const args = wrapper ? [wrapper, node, service, "start"] : [node, service, "start"];
  const log = logPath || resolve(projectRoot, ".aiot", "launchd.log");
  const values = args.map((arg) => `    <string>${xml(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>${launchAgentLabel}</string>\n  <key>ProgramArguments</key>\n  <array>\n${values}\n  </array>\n  <key>WorkingDirectory</key>\n  <string>${xml(projectRoot)}</string>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <dict><key>SuccessfulExit</key><false/></dict>\n  <key>ThrottleInterval</key>\n  <integer>30</integer>\n  <key>ProcessType</key>\n  <string>Background</string>\n  <key>StandardOutPath</key>\n  <string>${xml(log)}</string>\n  <key>StandardErrorPath</key>\n  <string>${xml(log)}</string>\n</dict>\n</plist>\n`;
}

function run(command, args, allowFailure = false) {
  return new Promise((resolveRun, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error && !allowFailure) reject(new Error(String(stderr || error.message).trim()));
      else resolveRun({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function domain() { return `gui/${process.getuid?.() || 0}`; }

export async function installLoginService({ projectRoot = root, wrapper = process.env.AIOT_LAUNCH_WRAPPER || "", path = loginAgentPath() } = {}) {
  if (process.platform !== "darwin") throw new Error("AIOT login service is currently available on macOS only.");
  if (wrapper && !isAbsolute(wrapper)) throw new Error("AIOT_LAUNCH_WRAPPER must be an absolute path.");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(projectRoot, ".aiot"), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, loginAgentPlist({ projectRoot, wrapper }), { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  await run("launchctl", ["bootout", domain(), launchAgentLabel], true);
  await run("launchctl", ["bootstrap", domain(), path]);
  return path;
}

export async function removeLoginService({ path = loginAgentPath() } = {}) {
  if (process.platform !== "darwin") throw new Error("AIOT login service is currently available on macOS only.");
  await run("launchctl", ["bootout", domain(), launchAgentLabel], true);
  rmSync(path, { force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const action = process.argv[2] || "install";
  const actionRun = action === "install" ? installLoginService() : action === "remove" ? removeLoginService() : Promise.reject(new Error("Usage: aiot-login-service.mjs install|remove"));
  actionRun.then((path) => { if (path) console.log(path); }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
