import { browserCredentialVault, type CredentialVault } from "./credential-vault.ts";
import { memoryStorage, type SessionStorage } from "./session.ts";
import { normalizeHttpsOrigin } from "./origin.ts";

export type SecretStores = {
  persistent: SessionStorage | null;
  session: SessionStorage | null;
};

const PASSWORD_PREFIX = "hermes.gate.password:";

let storesOverride: SecretStores | null = null;

export function passwordStorageKey(origin: string): string {
  return `${PASSWORD_PREFIX}${origin}`;
}

export async function withSecretStores<T>(stores: SecretStores, fn: () => T | Promise<T>): Promise<T> {
  storesOverride = stores;
  try { return await fn(); } finally { storesOverride = null; }
}

export function memorySecretStores(initial?: { persistent?: Record<string, string>; session?: Record<string, string> }): SecretStores {
  return {
    persistent: memoryStorage(initial?.persistent),
    session: memoryStorage(initial?.session),
  };
}

function persistentStore(): SessionStorage | null {
  if (storesOverride) return storesOverride.persistent;
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): SessionStorage | null {
  if (storesOverride) return storesOverride.session;
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function boundPasswordOrigin(origin: string): string {
  try {
    return normalizeHttpsOrigin(origin);
  } catch {
    return "";
  }
}

function readStore(store: SessionStorage | null, key: string): string {
  if (!store) return "";
  try {
    return store.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function removeStore(store: SessionStorage | null, key: string): void {
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* private mode */
  }
}

function originCandidates(origin: string): string[] {
  const bound = boundPasswordOrigin(origin);
  const out: string[] = [];
  if (bound) out.push(bound);
  const trimmed = origin.trim();
  if (trimmed && trimmed !== bound && trimmed.startsWith("https://")) out.push(trimmed);
  return out;
}

let vault: CredentialVault = browserCredentialVault();
let queue: Promise<unknown> = Promise.resolve();
const volatile = new Map<string, string>();
let storageIssue = false;
export function credentialStorageUnavailable(): boolean { return storageIssue; }
export function setCredentialVaultForTests(value: CredentialVault): void { vault = value; volatile.clear(); storageIssue = false; }
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}
function eraseLegacy(origin?: string): void {
  if (!origin) { clearPasswordPrefix(persistentStore()); clearPasswordPrefix(sessionStore()); return; }
  for (const candidate of originCandidates(origin)) {
    removeStore(persistentStore(), passwordStorageKey(candidate));
    removeStore(sessionStore(), passwordStorageKey(candidate));
  }
}
export function readPassword(origin: string): Promise<string> {
  const bound = boundPasswordOrigin(origin);
  return serialized(async () => {
    if (!bound) return "";
    const legacyEntries = new Map<string, string>();
    for (const store of [persistentStore(), sessionStore()]) {
      try {
        for (let i = 0; i < (store?.length ?? 0); i++) {
          const name = store?.key?.(i);
          if (!name?.startsWith(PASSWORD_PREFIX)) continue;
          const legacyOrigin = boundPasswordOrigin(name.slice(PASSWORD_PREFIX.length));
          const value = readStore(store, name);
          if (legacyOrigin && value && !legacyEntries.has(legacyOrigin)) legacyEntries.set(legacyOrigin, value);
        }
      } catch { storageIssue = true; }
    }
    for (const [legacyOrigin, value] of legacyEntries) {
      volatile.set(legacyOrigin, value);
      try { await vault.write(legacyOrigin, value); } catch { storageIssue = true; }
    }
    // Preserve every readable legacy connection in the vault (or memory on failure).
    eraseLegacy();
    if (volatile.has(bound)) return volatile.get(bound)!;
    try { return await vault.read(bound); } catch { storageIssue = true; return ""; }
  });
}
export function writePassword(origin: string, value: string): Promise<void> {
  const bound = boundPasswordOrigin(origin);
  const trimmed = value.trim();
  // Never fall back to plaintext storage, even if IndexedDB or crypto is unavailable.
  eraseLegacy(origin);
  return serialized(async () => {
    if (!bound) return;
    volatile.set(bound, trimmed);
    try { if (trimmed) await vault.write(bound, trimmed); else await vault.clear(bound); }
    catch { storageIssue = true; }
  });
}
export function clearPassword(origin?: string): Promise<void> {
  eraseLegacy(origin);
  return serialized(async () => {
    const bound = origin ? boundPasswordOrigin(origin) : undefined;
    if (origin && !bound) return;
    if (bound) volatile.delete(bound); else volatile.clear();
    try { await vault.clear(bound); } catch { storageIssue = true; }
  });
}

function clearPasswordPrefix(store: SessionStorage | null): void {
  if (!store) return;
  try {
    const keys: string[] = [];
    const len = store.length ?? 0;
    for (let i = 0; i < len; i++) {
      const key = store.key?.(i);
      if (key && key.startsWith(PASSWORD_PREFIX)) keys.push(key);
    }
    for (const key of keys) removeStore(store, key);
  } catch {
    /* private mode */
  }
}

export function stripKeysFromPersist(): void {
  if (typeof localStorage === "undefined") return;
  for (const name of ["hermes-bot-desk-v2", "hermes-bot-desk-v3", "hermes-bot-desk-v4"]) {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { state?: { connection?: { apiKey?: string } } };
      if (parsed.state?.connection && "apiKey" in parsed.state.connection) {
        delete parsed.state.connection.apiKey;
        localStorage.setItem(name, JSON.stringify(parsed));
      }
    } catch {
      /* ignore */
    }
  }
}
