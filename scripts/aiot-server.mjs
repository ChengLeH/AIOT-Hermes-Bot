import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { npmInvocation } from "./aiot-platform.mjs";

const modulePath = fileURLToPath(import.meta.url);

export function previewArgs(vitePath, port) {
  return [vitePath, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
}

function run(command, args, root) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, VITE_AUTH_ENABLED: "false" },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (code === 0) done();
      else fail(new Error(`${command} exited with ${signal || code}`));
    });
  });
}

export async function serve(projectRoot, requestedPort) {
  const root = resolve(projectRoot || process.cwd());
  const port = Number(requestedPort || 8888);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid AIOT port");
  const npm = npmInvocation(["ci"]);
  // The bootstrap normally installs first; retain direct aiot-server support.
  if (!existsSync(resolve(root, "node_modules/.package-lock.json"))) await run(npm.command, npm.args, root);
  const build = npmInvocation(["run", "build"]);
  await run(build.command, build.args, root);
  const vite = resolve(root, "node_modules/vite/bin/vite.js");
  const server = spawn(process.execPath, previewArgs(vite, port), {
    cwd: root,
    env: { ...process.env, VITE_AUTH_ENABLED: "false" },
    stdio: "inherit",
    windowsHide: true,
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => server.kill(signal));
  server.once("error", (error) => { console.error(error); process.exit(1); });
  server.once("exit", (code, signal) => { process.exit(signal ? 128 : (code ?? 1)); });
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) await serve(process.argv[2], process.argv[3]);
