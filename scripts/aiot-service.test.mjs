import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiotReady, isAiotCommand, isAiotServerCommand, listenerPids, ownedAiotReady, supportsNode } from "./aiot-service.mjs";

test("enforces the supported AIOT launcher floor", () => {
  assert.equal(supportsNode("20.18.9"), false);
  assert.equal(supportsNode("20.19.0"), false);
  assert.equal(supportsNode("21.7.3"), false);
  assert.equal(supportsNode("22.11.0"), false);
  assert.equal(supportsNode("22.12.0"), true);
  assert.equal(supportsNode("24.0.0"), true);
});

test("direct service entry keeps Node 26 alive without unsettled top-level await", () => {
  const source = readFileSync(new URL("./aiot-service.mjs", import.meta.url), "utf8");
  assert.equal(source.includes('await runService(process.argv[2] || "start")'), false);
  assert.match(source, /runService\(process\.argv\[2\] \|\| "start"\)\.catch/);
});

test("ready verifies AIOT identity instead of accepting any HTTP service", async () => {
  const response = (body, contentType = "application/manifest+json") => async () => new Response(JSON.stringify(body), { headers: { "content-type": contentType } });
  assert.equal(await aiotReady("http://127.0.0.1:8888/", response({ name: "AIOT / Hermes Bot", short_name: "AIOT", id: "/" })), true);
  assert.equal(await aiotReady("http://127.0.0.1:8888/", response({ name: "another app", short_name: "AIOT", id: "/" })), false);
  assert.equal(await aiotReady("http://127.0.0.1:8888/", response({ name: "AIOT / Hermes Bot", short_name: "AIOT", id: "/" }, "text/html")), false);
  assert.equal(await aiotReady("http://127.0.0.1:8888/", response({ name: "AIOT / Hermes Bot", short_name: "AIOT", id: "/" }, "application/octet-stream")), true);
});

test("readiness timeout waits for an unreachable endpoint to settle", async () => {
  let aborted = false;
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  });
  assert.equal(await aiotReady("http://127.0.0.1:9/", fetchImpl), false);
  assert.equal(aborted, true);
});

test("PID ownership requires the exact AIOT server path and port", () => {
  const project = "/opt/AIOT";
  assert.equal(isAiotCommand(`node ${project}/scripts/aiot-server.mjs ${project} 8888`, project, 8888), true);
  assert.equal(isAiotCommand("python -m http.server 8888", project, 8888), false);
  assert.equal(isAiotCommand(`node ${project}/scripts/aiot-server.mjs ${project} 9999`, project, 8888), false);
});

test("recognizes an AIOT server from an older checkout without accepting another service", () => {
  assert.equal(isAiotServerCommand("node /old/AIOT/scripts/aiot-server.mjs /old/AIOT 8888"), true);
  assert.equal(isAiotServerCommand("node C:\\old\\AIOT\\scripts\\aiot-server.mjs C:\\old\\AIOT 8888"), true);
  assert.equal(isAiotServerCommand("python -m http.server 8888"), false);
  assert.equal(isAiotServerCommand("node /old/AIOT/scripts/aiot-server.mjs /old/AIOT 9999"), false);
});

test("reads only listening process IDs for the requested port", async () => {
  const capture = async () => "42\n42\nnot-a-pid\n";
  assert.deepEqual(await listenerPids(8888, capture, "darwin"), [42]);
  assert.deepEqual(await listenerPids(8888, capture, "win32"), [42]);
});

test("ready rejects an AIOT response owned by another checkout", async () => {
  const manifest = async () => new Response(JSON.stringify({ name: "AIOT / Hermes Bot", short_name: "AIOT", id: "/" }), { headers: { "content-type": "application/manifest+json" } });
  assert.equal(await ownedAiotReady("http://127.0.0.1:8888/", process.pid, manifest, async () => "node /other/AIOT/scripts/aiot-server.mjs /other/AIOT 8888"), false);
});
