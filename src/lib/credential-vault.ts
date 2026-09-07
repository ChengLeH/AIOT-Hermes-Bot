/** Browser-local encryption, not a defense against code running in this origin (XSS). */
export type SealedCredential = { iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
export async function createVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function sealCredential(key: CryptoKey, origin: string, value: string): Promise<SealedCredential> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(origin) }, key, new TextEncoder().encode(value));
  return { iv, ciphertext };
}
export async function openCredential(key: CryptoKey, origin: string, value: SealedCredential): Promise<string> {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: value.iv, additionalData: new TextEncoder().encode(origin) }, key, value.ciphertext));
}
export interface CredentialVault { read(origin: string): Promise<string>; write(origin: string, value: string): Promise<void>; clear(origin?: string): Promise<void> }
export function browserCredentialVault(): CredentialVault {
  async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("aiot-credential-vault", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("vault");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Credential storage blocked"));
    });
  }
  async function access<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction("vault", mode);
        const req = operation(tx.objectStore("vault"));
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Credential storage failed"));
      });
    } finally { db.close(); }
  }
  async function key(): Promise<CryptoKey> {
    const existing = await access("readonly", s => s.get("key")) as CryptoKey | undefined;
    if (existing) return existing;
    const candidate = await createVaultKey();
    // A read-write transaction keeps first-key creation atomic across browser tabs.
    const db = await database();
    try { return await new Promise<CryptoKey>((resolve, reject) => {
      const tx = db.transaction("vault", "readwrite");
      const store = tx.objectStore("vault");
      const req = store.get("key");
      let result = candidate;
      req.onsuccess = () => { if (req.result) result = req.result; else store.put(candidate, "key"); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    }); } finally { db.close(); }
  }
  return {
    async read(origin) {
      const record = await access("readonly", s => s.get(`credential:${origin}`)) as SealedCredential | undefined;
      return record ? openCredential(await key(), origin, record) : "";
    },
    async write(origin, value) {
      const sealed = await sealCredential(await key(), origin, value);
      await access("readwrite", s => s.put(sealed, `credential:${origin}`));
    },
    async clear(origin) {
      // Retain the encryption key on global clear to avoid races with another tab.
      if (origin) { await access("readwrite", s => s.delete(`credential:${origin}`)); return; }
      const keys = await access("readonly", s => s.getAllKeys());
      for (const name of keys) if (String(name).startsWith("credential:")) await access("readwrite", s => s.delete(name));
    },
  };
}
