import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AAD = Buffer.from("aiot-push-private-v1", "utf8");
const KEYCHAIN_SERVICE = "AIOT Hermes Bot";

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

function macOSKeychainKey() {
  const account = "push-state-v1";
  try {
    const existing = validKey(execFileSync("security", ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }));
    if (existing) return existing;
  } catch {
    // First use has no item yet.
  }
  const key = randomBytes(32);
  execFileSync("security", ["add-generic-password", "-U", "-a", account, "-s", KEYCHAIN_SERVICE, "-w", key.toString("base64url")], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return key;
}

function stateKey(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // Once the portable fallback exists, keep using it so a temporary Keychain
  // outage cannot make an existing encrypted state unreadable.
  if (existsSync(join(dataDir, "push-state.key"))) return fileKey(dataDir);
  if (process.platform === "darwin" && process.env.AIOT_USE_KEYCHAIN === "1") {
    try { return macOSKeychainKey(); } catch {
      // A locked or unavailable Keychain falls back to a private 0600 key.
    }
  }
  return fileKey(dataDir);
}

export function createPrivateStateCipher({ dataDir }) {
  const file = join(dataDir, "push-private.json");
  const key = stateKey(dataDir);
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
      if (parsed?.version !== 1 || parsed?.cipher !== "aes-256-gcm") return parsed;
      const iv = Buffer.from(parsed.iv || "", "base64url");
      const tag = Buffer.from(parsed.tag || "", "base64url");
      const ciphertext = Buffer.from(parsed.ciphertext || "", "base64url");
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Invalid encrypted AIOT state");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(AAD);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    },
    write(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
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
