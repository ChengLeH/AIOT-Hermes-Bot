import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AAD = Buffer.from("aiot-push-private-v1", "utf8");
const KEYCHAIN_SERVICE = "AIOT Hermes Bot";
const STATE_FILES = ["push-private.json", "native-runs.json", "task-sessions.json"];
const envelopeFields = ["version", "cipher", "iv", "tag", "ciphertext"];
const isEnvelope = value => value && typeof value === "object" && envelopeFields.some(field => Object.hasOwn(value, field));
function hasEncryptedState(dataDir) {
  return STATE_FILES.some(name => {
    try { return isEnvelope(JSON.parse(readFileSync(join(dataDir, name), "utf8"))); }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  });
}

function validKey(value) {
  try {
    const key = Buffer.from(String(value || "").trim(), "base64url");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function fileKey(dataDir) {
  const path = join(dataDir, "push-state.key");
  try {
    const existing = validKey(readFileSync(path, "utf8"));
    if (!existing) throw new Error("Invalid AIOT state key");
    chmodSync(path, 0o600);
    return existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  writeFileSync(path, key.toString("base64url"), { mode: 0o600, flag: "wx" });
  return key;
}

function macOSKeychainKey(command, canCreate) {
  const account = "push-state-v1";
  let raw;
  try {
    raw = command("security", ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    // security maps errSecItemNotFound (-25300) to exit status 44. All other
    // failures (including locked/denied access) must preserve the existing key.
    if (error.status !== 44 || !canCreate) throw new Error("AIOT state Keychain unavailable");
    const key = randomBytes(32);
    try {
      // No -U: concurrent initialization must never replace an existing item.
      command("security", ["add-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w", key.toString("base64url")], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch { throw new Error("AIOT state Keychain initialization unavailable"); }
    return key;
  }
  const key = validKey(raw);
  if (!key) throw new Error("Invalid AIOT state Keychain key");
  return key;
}

function stateKey(dataDir, { platform, useKeychain, keychainCommand }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (existsSync(join(dataDir, "push-state.key"))) return fileKey(dataDir);
  const encrypted = hasEncryptedState(dataDir);
  if (platform === "darwin" && useKeychain) {
    return macOSKeychainKey(keychainCommand, !encrypted);
  }
  // Missing file keys and changed backend settings are recovery conditions,
  // never permission to mint a replacement key for existing encrypted data.
  if (encrypted) throw new Error("AIOT state key unavailable");
  return fileKey(dataDir);
}

export function createPrivateStateCipher({ dataDir, fileName = "push-private.json",
  platform = process.platform, useKeychain = process.env.AIOT_USE_KEYCHAIN === "1", keychainCommand = execFileSync }) {
  if (!STATE_FILES.includes(fileName)) throw new Error("Invalid private state file");
  const aad = fileName === "push-private.json" ? AAD : Buffer.from(fileName === "native-runs.json" ? "aiot-native-runs-v1" : "aiot-task-sessions-v1", "utf8");
  const file = join(dataDir, fileName);
  const key = stateKey(dataDir, { platform, useKeychain, keychainCommand });
  return {
    file,
    read(fallback) {
      let parsed;
      try { parsed = JSON.parse(readFileSync(file, "utf8")); }
      catch (error) {
        if (error.code === "ENOENT") return fallback();
        throw error;
      }
      // One-time migration from the v0.1.2 private-permission JSON file.
      if (!isEnvelope(parsed)) {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid legacy AIOT state");
        return parsed;
      }
      if (parsed.version !== 1 || parsed.cipher !== "aes-256-gcm") throw new Error("Invalid encrypted AIOT state");
      const iv = Buffer.from(parsed.iv || "", "base64url");
      const tag = Buffer.from(parsed.tag || "", "base64url");
      const ciphertext = Buffer.from(parsed.ciphertext || "", "base64url");
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid encrypted AIOT state");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    },
    write(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      const envelope = {
        version: 1,
        cipher: "aes-256-gcm",
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      };
      const temp = `${file}.tmp`;
      writeFileSync(temp, JSON.stringify(envelope), { mode: 0o600 });
      chmodSync(temp, 0o600);
      renameSync(temp, file);
    },
  };
}
