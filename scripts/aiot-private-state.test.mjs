import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateStateCipher } from "./aiot-private-state.mjs";

test("private notification state is encrypted at rest and round-trips", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "aiot-private-state-"));
  try {
    const cipher = createPrivateStateCipher({ dataDir, useKeychain: false });
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
    const cipher = createPrivateStateCipher({ dataDir, useKeychain: false });
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
  const cipher = createPrivateStateCipher({ dataDir, fileName: "native-runs.json", useKeychain: false });
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

function isolated(run) {
  const dataDir = mkdtempSync(join(tmpdir(), 'aiot-keychain-test-'));
  try { run(dataDir); } finally { rmSync(dataDir, { recursive: true, force: true }); }
}
const keychainOptions = { platform: 'darwin', useKeychain: true };
const testKey = Buffer.alloc(32, 7).toString('base64url');

test('Keychain outage preserves encrypted state, creates no fallback and recovers', () => isolated(dataDir => {
  const options = { dataDir, ...keychainOptions, keychainCommand: () => testKey };
  const cipher = createPrivateStateCipher(options);
  cipher.write({ tasks: [{ id: 'retained' }] });
  const before = readFileSync(cipher.file, 'utf8');
  for (const status of [36, 44, 1]) {
    const calls = [];
    assert.throws(() => createPrivateStateCipher({ ...options, keychainCommand: (_, args) => {
      calls.push(args[0]); throw Object.assign(new Error('private command output'), { status });
    } }), /Keychain unavailable/);
    assert.deepEqual(calls, ['find-generic-password']);
    assert.throws(() => readFileSync(join(dataDir, 'push-state.key')), { code: 'ENOENT' });
    assert.equal(readFileSync(cipher.file, 'utf8'), before);
  }
  assert.deepEqual(createPrivateStateCipher(options).read(() => null), { tasks: [{ id: 'retained' }] });
  assert.throws(() => createPrivateStateCipher({ dataDir, useKeychain: false }), /state key unavailable/);
}));

test('first Keychain initialization only creates on missing-item and never overwrites', () => isolated(dataDir => {
  const calls = [];
  createPrivateStateCipher({ dataDir, ...keychainOptions, keychainCommand: (_, args) => {
    calls.push(args);
    if (args[0] === 'find-generic-password') throw Object.assign(new Error('missing'), { status: 44 });
    assert.equal(args.includes('-U'), false);
  } });
  assert.deepEqual(calls.map(args => args[0]), ['find-generic-password', 'add-generic-password']);
  for (const response of ['bad-key', null]) {
    let count = 0;
    assert.throws(() => createPrivateStateCipher({ dataDir, ...keychainOptions, keychainCommand: () => {
      count++;
      if (response === null) throw Object.assign(new Error('locked'), { status: 36 });
      return response;
    } }));
    assert.equal(count, 1);
  }
}));

test('existing portable key remains authoritative when Keychain is enabled', () => isolated(dataDir => {
  const cipher = createPrivateStateCipher({ dataDir, useKeychain: false });
  cipher.write({ retained: true });
  const key = readFileSync(join(dataDir, 'push-state.key'), 'utf8');
  const reopened = createPrivateStateCipher({ dataDir, ...keychainOptions, keychainCommand: () => { throw new Error('must not invoke'); } });
  assert.deepEqual(reopened.read(() => null), { retained: true });
  assert.equal(readFileSync(join(dataDir, 'push-state.key'), 'utf8'), key);
}));

test('damaged encryption metadata is rejected instead of migrated as plaintext', () => isolated(dataDir => {
  const cipher = createPrivateStateCipher({ dataDir, useKeychain: false });
  cipher.write({ tasks: [] });
  const original = JSON.parse(readFileSync(cipher.file, 'utf8'));
  for (const envelope of [{ ...original, version: 2 }, { ...original, cipher: 'damaged' }, { ciphertext: original.ciphertext }, null, []]) {
    writeFileSync(cipher.file, JSON.stringify(envelope));
    assert.throws(() => cipher.read(() => ({})), /Invalid/);
    assert.equal(readFileSync(cipher.file, 'utf8'), JSON.stringify(envelope));
  }
}));

test('lost portable key is never silently replaced for existing encrypted state', () => isolated(dataDir => {
  const cipher = createPrivateStateCipher({ dataDir, useKeychain: false });
  cipher.write({ tasks: [] });
  rmSync(join(dataDir, 'push-state.key'));
  assert.throws(() => createPrivateStateCipher({ dataDir, useKeychain: false }), /state key unavailable/);
  assert.throws(() => readFileSync(join(dataDir, 'push-state.key')), { code: 'ENOENT' });
}));
