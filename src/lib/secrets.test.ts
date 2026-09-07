import test from "node:test";
import assert from "node:assert/strict";
import { createVaultKey, sealCredential, openCredential, type SealedCredential } from "./credential-vault.ts";
import { writePassword, readPassword, clearPassword, setCredentialVaultForTests, credentialStorageUnavailable, memorySecretStores, withSecretStores, passwordStorageKey } from "./secrets.ts";
const origin = "https://example.test";
test("AES-GCM uses fresh IVs, nonextractable key and authenticates origin", async () => {
  const key = await createVaultKey();
  const first = await sealCredential(key, origin, "private-test-key");
  const second = await sealCredential(key, origin, "private-test-key");
  assert.equal(await openCredential(key, origin, first), "private-test-key");
  assert.notDeepEqual(first.iv, second.iv);
  assert.equal(new TextDecoder().decode(first.ciphertext).includes("private-test-key"), false);
  await assert.rejects(crypto.subtle.exportKey("raw", key));
  await assert.rejects(openCredential(key, "https://other.test", first));
  await assert.rejects(openCredential(await createVaultKey(), origin, first));
});
test("queued writes cannot resurrect a cleared credential; failures are memory-only", async () => {
  const key = await createVaultKey();
  const records = new Map<string, SealedCredential>();
  const vault = {
    async write(o: string, value: string) { records.set(o, await sealCredential(key, o, value)); },
    async read(o: string) { return records.has(o) ? openCredential(key, o, records.get(o)!) : ""; },
    async clear(o?: string) { if (o) records.delete(o); else records.clear(); },
  };
  setCredentialVaultForTests(vault);
  const write = writePassword(origin, "secret");
  const clear = clearPassword(origin);
  await Promise.all([write, clear]);
  assert.equal(await readPassword(origin), "");
  await writePassword(origin, "retained");
  setCredentialVaultForTests(vault); // fresh in-memory cache, persisted record survives
  assert.equal(await readPassword(origin), "retained");
  setCredentialVaultForTests({ ...vault, async write() { throw new Error("disabled"); } });
  await writePassword(origin, "memory-only");
  assert.equal(await readPassword(origin), "memory-only");
  assert.equal(credentialStorageUnavailable(), true);
});

test("legacy plaintext is removed even when encrypted storage fails", async () => {
  const stores = memorySecretStores({ persistent: { [passwordStorageKey(origin)]: "old-secret", [passwordStorageKey("https://orphan.test")]: "orphan-secret" } });
  setCredentialVaultForTests({ async read() { return ""; }, async write() { throw new Error("quota"); }, async clear() {} });
  await withSecretStores(stores, async () => {
    assert.equal(await readPassword(origin), "old-secret");
    assert.equal(stores.persistent!.getItem(passwordStorageKey(origin)), null);
    assert.equal(stores.persistent!.getItem(passwordStorageKey("https://orphan.test")), null);
    assert.equal(await readPassword("https://orphan.test"), "orphan-secret");
    assert.equal(credentialStorageUnavailable(), true);
  });
});
