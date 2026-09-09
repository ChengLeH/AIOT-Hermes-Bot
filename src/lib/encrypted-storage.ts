import type { StateStorage } from "zustand/middleware";

export type EncryptedRecord = {
  version: 1;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
};

export interface EncryptedStorageVault {
  getKey(create: boolean): Promise<CryptoKey | undefined>;
  getRecord(name: string): Promise<EncryptedRecord | undefined>;
  putRecord(name: string, record: EncryptedRecord): Promise<void>;
  deleteRecord(name: string): Promise<void>;
}

export interface LegacyStorage {
  getItem(name: string): string | null;
  removeItem(name: string): void;
}

const encoder = new TextEncoder();

function aad(origin: string, name: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`aiot-browser-state\0${origin}\0${name}`);
}

async function seal(key: CryptoKey, origin: string, name: string, value: string): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(origin, name) },
    key,
    encoder.encode(value),
  );
  return { version: 1, iv, ciphertext };
}

async function open(key: CryptoKey, origin: string, name: string, record: EncryptedRecord): Promise<string> {
  if (record.version !== 1) throw new Error("Unsupported encrypted state version");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv, additionalData: aad(origin, name) },
    key,
    record.ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

export function createEncryptedStateStorage(input: {
  origin: string;
  vault: EncryptedStorageVault;
  legacy?: LegacyStorage | null;
}): StateStorage {
  let queue: Promise<unknown> = Promise.resolve();
  const blockedWrites = new Set<string>();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    getItem: (name) => serialized(async () => {
      try {
        const record = await input.vault.getRecord(name);
        if (record) {
          const key = await input.vault.getKey(false);
          if (!key) throw new Error("Encrypted browser storage key is missing");
          const plaintext = await open(key, input.origin, name, record);
          // A previous migration may have persisted ciphertext before legacy
          // cleanup was interrupted. Do not expose it until cleanup succeeds.
          input.legacy?.removeItem(name);
          blockedWrites.delete(name);
          return plaintext;
        }

        let plaintext: string | null = null;
        plaintext = input.legacy?.getItem(name) ?? null;
        if (plaintext === null) {
          blockedWrites.delete(name);
          return null;
        }

        const key = await input.vault.getKey(true);
        if (!key) throw new Error("Encrypted browser storage unavailable");
        await input.vault.putRecord(name, await seal(key, input.origin, name, plaintext));
        // Migration is intentionally fail-closed: expose and erase legacy data only
        // after the authenticated ciphertext transaction has completed.
        input.legacy?.removeItem(name);
        blockedWrites.delete(name);
        return plaintext;
      } catch {
        // `null` tells Zustand there is no state. Remember that this was an
        // unreadable state instead, so a later default-state update cannot
        // destroy ciphertext or retryable legacy plaintext.
        blockedWrites.add(name);
        return null;
      }
    }),
    setItem: (name, value) => serialized(async () => {
      if (blockedWrites.has(name)) throw new Error("Encrypted browser storage is locked after a failed read");
      const key = await input.vault.getKey(true);
      if (!key) throw new Error("Encrypted browser storage unavailable");
      await input.vault.putRecord(name, await seal(key, input.origin, name, value));
      try { input.legacy?.removeItem(name); } catch { /* ciphertext is authoritative */ }
    }),
    removeItem: (name) => serialized(async () => {
      await input.vault.deleteRecord(name);
      input.legacy?.removeItem(name);
      blockedWrites.delete(name);
    }),
  };
}

function browserVault(): EncryptedStorageVault {
  const database = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open("aiot-credential-vault", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("vault")) request.result.createObjectStore("vault");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Encrypted browser storage blocked"));
  });

  const access = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction("vault", mode);
        const request = operation(transaction.objectStore("vault"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Encrypted browser storage failed"));
      });
    } finally {
      db.close();
    }
  };

  return {
    async getKey(create) {
      const existing = await access("readonly", (store) => store.get("browser-state:key")) as CryptoKey | undefined;
      if (existing || !create) return existing;
      const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const db = await database();
      try {
        return await new Promise<CryptoKey>((resolve, reject) => {
          const transaction = db.transaction("vault", "readwrite");
          const store = transaction.objectStore("vault");
          const request = store.get("browser-state:key");
          let result = candidate;
          request.onsuccess = () => {
            if (request.result) result = request.result as CryptoKey;
            else store.put(candidate, "browser-state:key");
          };
          transaction.oncomplete = () => resolve(result);
          transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Encrypted key storage failed"));
        });
      } finally {
        db.close();
      }
    },
    getRecord: (name) => access("readonly", (store) => store.get(`browser-state:${name}`)) as Promise<EncryptedRecord | undefined>,
    putRecord: (name, record) => access("readwrite", (store) => store.put(record, `browser-state:${name}`)).then(() => undefined),
    deleteRecord: (name) => access("readwrite", (store) => store.delete(`browser-state:${name}`)).then(() => undefined),
  };
}

let browserStorage: StateStorage | null = null;

export function encryptedBrowserStorage(): StateStorage {
  if (!browserStorage) {
    browserStorage = createEncryptedStateStorage({
      origin: location.origin,
      vault: browserVault(),
      legacy: localStorage,
    });
  }
  return browserStorage;
}
