import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || process.cwd());
const port = Number(process.argv[3] || 8888);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Invalid AIOT port");
}

function run(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, VITE_AUTH_ENABLED: "false" },
      stdio: "inherit",
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (code === 0) done();
      else fail(new Error(`${command} exited with ${signal || code}`));
    });
  });
}

const npm = process.env.AIOT_NPM || "npm";
if (!existsSync(resolve(root, "node_modules/.package-lock.json"))) {
  await run(npm, ["ci"]);
}
await run(npm, ["run", "build"]);

const vite = resolve(root, "node_modules/vite/bin/vite.js");
const server = spawn(process.execPath, [vite, "preview", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, VITE_AUTH_ENABLED: "false" },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => server.kill(signal));
}

server.once("error", (error) => {
  console.error(error);
  process.exit(1);
});
server.once("exit", (code, signal) => {
  process.exit(signal ? 128 : (code ?? 1));
});
