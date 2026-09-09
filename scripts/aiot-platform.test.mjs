import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { npmInvocation, resolveNpmCli } from "./aiot-platform.mjs";

test("validated npm_execpath is executed through Node without a command shell", () => {
  const cli = resolve("C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js");
  const input = { execPath: "C:/Program Files/nodejs/node.exe", env: { npm_execpath: cli, PATH: "" }, exists: (path) => path === cli };
  assert.equal(resolveNpmCli(input), cli);
  assert.deepEqual(npmInvocation(["run", "build"], input), { command: input.execPath, args: [cli, "run", "build"] });
});

test("missing and non-JavaScript npm launchers are rejected", () => {
  assert.throws(() => resolveNpmCli({ execPath: "/node", env: { npm_execpath: "/tmp/npm.cmd", PATH: "" }, exists: (path) => path.endsWith("npm.cmd") }), /npm CLI was not found/);
  assert.throws(() => resolveNpmCli({ execPath: "/node", env: { PATH: "" }, exists: () => false }), /npm CLI was not found/);
});
