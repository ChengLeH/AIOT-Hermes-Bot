import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { createEncryptedStateStorage, type EncryptedRecord, type EncryptedStorageVault } from "./encrypted-storage.ts";

const origin = "https://aiot.example.test";

function fixture() {
  let key: CryptoKey | undefined;
  const records = new Map<string, EncryptedRecord>();
  const legacy = new Map<string, string>();
  const vault: EncryptedStorageVault = {
    async getKey(create) {
      if (!key && create) key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      return key;
    },
    async getRecord(name) { return records.get(name); },
    async putRecord(name, record) { records.set(name, record); },
    async deleteRecord(name) { records.delete(name); },
  };
  const legacyStorage = {
    getItem: (name: string) => legacy.get(name) ?? null,
    removeItem: (name: string) => { legacy.delete(name); },
  };
  return { vault, records, legacy, legacyStorage, clearKey: () => { key = undefined; } };
}

test("migrates plaintext only after ciphertext persists and reloads from ciphertext", async () => {
  const f = fixture();
  f.legacy.set("desk", '{"messages":["private"]}');
  const storage = createEncryptedStateStorage({ origin, vault: f.vault, legacy: f.legacyStorage });
  assert.equal(await storage.getItem("desk"), '{"messages":["private"]}');
  assert.equal(f.legacy.has("desk"), false);
  assert.equal(new TextDecoder().decode(f.records.get("desk")!.ciphertext).includes("private"), false);
  assert.equal(await createEncryptedStateStorage({ origin, vault: f.vault }).getItem("desk"), '{"messages":["private"]}');
});

test("migration failure leaves legacy data for retry but does not hydrate it", async () => {
  const f = fixture();
  f.legacy.set("desk", "private");
  const failing = { ...f.vault, async putRecord() { throw new Error("quota"); } };
  const storage = createEncryptedStateStorage({ origin, vault: failing, legacy: f.legacyStorage });
  assert.equal(await storage.getItem("desk"), null);
  assert.equal(f.legacy.get("desk"), "private");
  await assert.rejects(async () => { await storage.setItem("desk", "defaults"); }, /locked after a failed read/);
  assert.equal(f.legacy.get("desk"), "private");
});

test("corrupted ciphertext blocks default-state overwrite until explicit clear", async () => {
  const f = fixture();
  const storage = createEncryptedStateStorage({ origin, vault: f.vault });
  await storage.setItem("desk", "private");
  const corrupted = new Uint8Array([1, 2, 3]).buffer;
  f.records.get("desk")!.ciphertext = corrupted;
  assert.equal(await storage.getItem("desk"), null);
  await assert.rejects(async () => { await storage.setItem("desk", "defaults"); }, /locked after a failed read/);
  assert.equal(f.records.get("desk")!.ciphertext, corrupted);
  await storage.removeItem("desk");
  await storage.setItem("desk", "new-private");
  assert.equal(await storage.getItem("desk"), "new-private");
});

test("missing key preserves ciphertext and rejects writes", async () => {
  const f = fixture();
  const storage = createEncryptedStateStorage({ origin, vault: f.vault });
  await storage.setItem("desk", "private");
  const ciphertext = f.records.get("desk")!.ciphertext;
  f.clearKey();
  assert.equal(await storage.getItem("desk"), null);
  await assert.rejects(async () => { await storage.setItem("desk", "defaults"); }, /locked after a failed read/);
  assert.equal(f.records.get("desk")!.ciphertext, ciphertext);
});

test("confirmed empty storage remains writable", async () => {
  const f = fixture();
  const storage = createEncryptedStateStorage({ origin, vault: f.vault, legacy: f.legacyStorage });
  assert.equal(await storage.getItem("desk"), null);
  await storage.setItem("desk", "first-state");
  assert.equal(await storage.getItem("desk"), "first-state");
});

test("serialized migration and writes cannot resurrect stale plaintext", async () => {
  const f = fixture();
  f.legacy.set("desk", "legacy");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const delayed = {
    ...f.vault,
    async putRecord(name: string, record: EncryptedRecord) {
      if (writes++ === 0) await gate;
      return f.vault.putRecord(name, record);
    },
  };
  const storage = createEncryptedStateStorage({ origin, vault: delayed, legacy: f.legacyStorage });
  const migration = storage.getItem("desk");
  const latest = storage.setItem("desk", "latest");
  release();
  assert.equal(await migration, "legacy");
  await latest;
  assert.equal(await storage.getItem("desk"), "latest");
  assert.equal(f.legacy.has("desk"), false);
});

test("Zustand waits for asynchronous encrypted rehydration", async () => {
  const f = fixture();
  const encrypted = createEncryptedStateStorage({ origin, vault: f.vault });
  await encrypted.setItem("desk", JSON.stringify({ state: { message: "restored" }, version: 0 }));
  const store = createStore(persist(() => ({ message: "default" }), {
    name: "desk",
    storage: createJSONStorage(() => encrypted),
    skipHydration: true,
  }));
  assert.equal(store.persist.hasHydrated(), false);
  const hydration = store.persist.rehydrate();
  assert.equal(store.getState().message, "default");
  await hydration;
  assert.equal(store.persist.hasHydrated(), true);
  assert.equal(store.getState().message, "restored");
});
