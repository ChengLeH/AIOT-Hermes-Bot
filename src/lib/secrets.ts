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

export function withSecretStores<T>(stores: SecretStores, fn: () => T): T {
  storesOverride = stores;
  try {
    return fn();
  } finally {
    storesOverride = null;
  }
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

function writeStore(store: SessionStorage | null, key: string, value: string): void {
  if (!store) return;
  try {
    if (!value) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* private mode */
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

export function readPassword(origin: string): string {
  if (!origin.trim()) return "";
  const persistent = persistentStore();
  const session = sessionStore();
  const candidates = originCandidates(origin);
  if (candidates.length === 0) return "";
  const bound = candidates[0]!;
  for (const candidate of candidates) {
    const stored = readStore(persistent, passwordStorageKey(candidate));
    if (stored) {
      if (candidate !== bound) {
        writeStore(persistent, passwordStorageKey(bound), stored);
        removeStore(persistent, passwordStorageKey(candidate));
      }
      for (const name of candidates) removeStore(session, passwordStorageKey(name));
      return stored;
    }
  }
  for (const candidate of candidates) {
    const legacy = readStore(session, passwordStorageKey(candidate));
    if (!legacy) continue;
    writeStore(persistent, passwordStorageKey(bound), legacy);
    for (const name of candidates) removeStore(session, passwordStorageKey(name));
    return legacy;
  }
  return "";
}

export function writePassword(origin: string, value: string): void {
  const bound = boundPasswordOrigin(origin);
  if (!bound) return;
  const persistent = persistentStore();
  const session = sessionStore();
  const trimmed = value.trim();
  writeStore(persistent, passwordStorageKey(bound), trimmed);
  removeStore(session, passwordStorageKey(bound));
  const raw = origin.trim();
  if (raw && raw !== bound) {
    removeStore(persistent, passwordStorageKey(raw));
    removeStore(session, passwordStorageKey(raw));
  }
}

export function clearPassword(origin?: string): void {
  const persistent = persistentStore();
  const session = sessionStore();
  if (origin && origin.trim()) {
    for (const candidate of originCandidates(origin)) {
      removeStore(persistent, passwordStorageKey(candidate));
      removeStore(session, passwordStorageKey(candidate));
    }
    return;
  }
  clearPasswordPrefix(persistent);
  clearPasswordPrefix(session);
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
