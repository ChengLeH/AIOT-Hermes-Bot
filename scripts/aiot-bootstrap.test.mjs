import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browserCommand, dependencyInstallNeeded, lockDigest } from "./aiot-bootstrap.mjs";

test("dependency installation follows the exact lockfile digest", () => {
  const digest = lockDigest(Buffer.from("lock"));
  assert.equal(dependencyInstallNeeded(digest, digest, true), false);
  assert.equal(dependencyInstallNeeded(digest, "old", true), true);
  assert.equal(dependencyInstallNeeded(digest, digest, false), true);
});

test("browser opening uses platform-native commands and the supplied local URL", () => {
  const target = "http://127.0.0.1:8888/";
  assert.deepEqual(browserCommand("darwin", target), { command: "open", args: [target] });
  assert.deepEqual(browserCommand("win32", target), { command: "explorer.exe", args: [target] });
  assert.deepEqual(browserCommand("linux", target), { command: "xdg-open", args: [target] });
});

test("one-click launchers use the checked-in bootstrap without admin or download pipelines", () => {
  const shell = readFileSync(resolve("Start-AIOT.sh"), "utf8");
  const windows = readFileSync(resolve("Start-AIOT.cmd"), "utf8");
  for (const source of [shell, windows]) {
    assert.match(source, /aiot-bootstrap\.mjs/);
    assert.doesNotMatch(source, /curl|wget|sudo|runas|Codex/i);
    assert.match(source, /nodejs\.org\/en\/download/);
  }
  assert.match(windows, /"%~dp0scripts\\aiot-bootstrap\.mjs"/);
});

test("portable stop launchers target only the owned AIOT service", () => {
  const shell = readFileSync(resolve("Stop-AIOT.sh"), "utf8");
  const windows = readFileSync(resolve("Stop-AIOT.cmd"), "utf8");
  for (const source of [shell, windows]) {
    assert.match(source, /aiot-service\.mjs/);
    assert.match(source, /stop/);
    assert.doesNotMatch(source, /pkill|killall|taskkill|sudo/i);
  }
});
