import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateStateCipher } from "./aiot-private-state.mjs";

test("private notification state is encrypted at rest and round-trips", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "aiot-private-state-"));
  try {
    const cipher = createPrivateStateCipher({ dataDir });
    const secret = { authorization: "Bearer private-connection-key", target: "http://127.0.0.1:8642/api/bot" };
    cipher.write(secret);
    const raw = readFileSync(cipher.file, "utf8");
    assert.equal(raw.includes("private-connection-key"), false);
    assert.equal(raw.includes("127.0.0.1"), false);
    assert.deepEqual(cipher.read(() => ({})), secret);
    assert.equal(statSync(cipher.file).mode & 0o777, 0o600);
    assert.equal(statSync(join(dataDir, "push-state.key")).mode & 0o777, 0o600);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("legacy plaintext state migrates on the next write", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "aiot-private-migrate-"));
  try {
    writeFileSync(join(dataDir, "push-private.json"), JSON.stringify({ authorization: "legacy-secret" }), { mode: 0o600 });
    const cipher = createPrivateStateCipher({ dataDir });
    const state = cipher.read(() => ({}));
    assert.equal(state.authorization, "legacy-secret");
    cipher.write(state);
    assert.equal(readFileSync(cipher.file, "utf8").includes("legacy-secret"), false);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("native run snapshots encrypt sensitive fields, migrate and reject tampering", () => {
 const dataDir = mkdtempSync(join(tmpdir(), "aiot-run-private-"));
 try {
  const value = { user: "private-prompt", output: "private-response", tool: "private-tool" };
  const file = join(dataDir, "native-runs.json");
  writeFileSync(file, JSON.stringify(value));
  const cipher = createPrivateStateCipher({ dataDir, fileName: "native-runs.json" });
  cipher.write(cipher.read(() => null));
  const raw = readFileSync(file, "utf8");
  assert.equal(raw.includes("private-prompt"), false);
  assert.equal(raw.includes("private-response"), false);
  assert.equal(raw.includes("private-tool"), false);
  assert.deepEqual(cipher.read(() => null), value);
  const envelope = JSON.parse(raw); envelope.tag = Buffer.alloc(16).toString("base64url");
  writeFileSync(file, JSON.stringify(envelope));
  assert.throws(() => cipher.read(() => null));
 } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
