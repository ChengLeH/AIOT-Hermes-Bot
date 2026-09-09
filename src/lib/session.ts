import type { NativeBotProfile } from "./bot-catalog";
import { encryptedBrowserStorage } from "./encrypted-storage.ts";

export type SessionView = "roster" | "chat" | "settings";

export type DeskSession = {
  origin: string;
  view: SessionView;
  profile: string | null;
  conversation: string | null;
  conversations: Record<string, string>;
  drafts: Record<string, string>;
};

export type RestoreResult = {
  view: SessionView;
  profile: string | null;
  conversation: string | null;
  conversations: Record<string, string>;
  drafts: Record<string, string>;
  notice: string | null;
};

export type SessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
};

export const MISSING_BOT_NOTICE = "error.missingAgent";

export function deskSessionKey(origin: string): string {
  return `hermes.desk.session:${origin}`;
}

export function readDeskSession(origin: string, storage: SessionStorage): DeskSession | null {
  if (!origin) return null;
  try {
    const raw = storage.getItem(deskSessionKey(origin));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeskSession>;
    if (parsed.origin && parsed.origin !== origin) return null;
    return {
      origin,
      view: parsed.view === "chat" || parsed.view === "settings" ? parsed.view : "roster",
      profile: typeof parsed.profile === "string" && parsed.profile ? parsed.profile : null,
      conversation: typeof parsed.conversation === "string" && parsed.conversation ? parsed.conversation : null,
      conversations: isStringMap(parsed.conversations) ? parsed.conversations : {},
      drafts: isStringMap(parsed.drafts) ? parsed.drafts : {},
    };
  } catch {
    return null;
  }
}

export function writeDeskSession(session: DeskSession, storage: SessionStorage): void {
  if (!session.origin) return;
  storage.setItem(deskSessionKey(session.origin), JSON.stringify(session));
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((v) => typeof v === "string");
}

export function captureDeskSession(input: {
  origin: string;
  view: SessionView;
  profile: string | null;
  conversation: string | null;
  conversations: Record<string, string>;
  drafts: Record<string, string>;
}): DeskSession {
  return {
    origin: input.origin,
    view: input.view,
    profile: input.profile,
    conversation: input.conversation,
    conversations: input.conversations,
    drafts: input.drafts,
  };
}

export function restoreAfterProfiles(input: {
  profiles: Pick<NativeBotProfile, "name">[];
  stored: DeskSession | null;
  query?: { profile?: string | null; session?: string | null };
}): RestoreResult {
  const names = new Set(input.profiles.map((p) => p.name).filter(Boolean));
  const stored = input.stored;
  const queryProfile = input.query?.profile?.trim() || null;
  const wantedProfile = queryProfile || stored?.profile || null;
  const conversations: Record<string, string> = {};
  const drafts: Record<string, string> = {};
  if (stored) {
    for (const [profile, text] of Object.entries(stored.drafts)) {
      if (names.has(profile) && text) drafts[profile] = text;
    }
  }

  if (wantedProfile && !names.has(wantedProfile)) {
    const intendedChat = Boolean(queryProfile) || stored?.view === "chat";
    return {
      view: "roster",
      profile: null,
      conversation: null,
      conversations,
      drafts,
      notice: intendedChat ? MISSING_BOT_NOTICE : null,
    };
  }

  if (wantedProfile) {
    // A fresh app starts at contacts; only an explicit notification link opens chat.
    const view: SessionView = queryProfile ? "chat" : "roster";
    return {
      view,
      profile: wantedProfile,
      conversation: null,
      conversations,
      drafts,
      notice: null,
    };
  }

  return {
    view: "roster",
    profile: null,
    conversation: null,
    conversations,
    drafts,
    notice: null,
  };
}

export function applyProfilePoll(input: {
  profiles: Pick<NativeBotProfile, "name">[];
  currentView: SessionView;
  currentProfile: string | null;
  conversations: Record<string, string>;
  drafts: Record<string, string>;
}): {
  view: SessionView;
  profile: string | null;
  notice: string | null;
  conversations: Record<string, string>;
  drafts: Record<string, string>;
} {
  const names = new Set(input.profiles.map((p) => p.name).filter(Boolean));
  const conversations: Record<string, string> = {};
  for (const [name, id] of Object.entries(input.conversations)) {
    if (names.has(name)) conversations[name] = id;
  }
  const drafts: Record<string, string> = {};
  for (const [name, text] of Object.entries(input.drafts)) {
    if (names.has(name)) drafts[name] = text;
  }
  if (input.currentView === "chat" && input.currentProfile && !names.has(input.currentProfile)) {
    return {
      view: "roster",
      profile: null,
      notice: MISSING_BOT_NOTICE,
      conversations,
      drafts,
    };
  }
  return {
    view: input.currentView,
    profile: input.currentProfile && names.has(input.currentProfile) ? input.currentProfile : input.currentProfile,
    notice: null,
    conversations,
    drafts,
  };
}

export function conversationForProfile(
  name: string,
  previous: string | undefined,
  stored: Record<string, string> | undefined,
): string | undefined {
  if (previous) return previous;
  if (stored?.[name]) return stored[name];
  return undefined;
}

let writesEnabled = false;
let restorePending = true;

export function enableSessionWrites(): void {
  writesEnabled = true;
}

export function disableSessionWrites(): void {
  writesEnabled = false;
}

export function sessionWritesEnabled(): boolean {
  return writesEnabled;
}

export function markRestorePending(): void {
  restorePending = true;
  writesEnabled = false;
}

export function consumeRestorePending(): boolean {
  if (!restorePending) return false;
  restorePending = false;
  return true;
}

export function isRestorePending(): boolean {
  return restorePending;
}

export function memoryStorage(initial: Record<string, string> = {}): SessionStorage {
  const data = { ...initial };
  const api: SessionStorage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
    key: (index) => Object.keys(data)[index] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
  return api;
}

export async function readBrowserDeskSession(origin: string): Promise<DeskSession | null> {
  if (!origin || typeof indexedDB === "undefined") return null;
  const raw = await encryptedBrowserStorage().getItem(deskSessionKey(origin));
  if (!raw) return null;
  return readDeskSession(origin, memoryStorage({ [deskSessionKey(origin)]: raw }));
}

export async function writeBrowserDeskSession(session: DeskSession): Promise<void> {
  if (!session.origin || typeof indexedDB === "undefined") return;
  const storage = memoryStorage();
  writeDeskSession(session, storage);
  const raw = storage.getItem(deskSessionKey(session.origin));
  if (raw) await encryptedBrowserStorage().setItem(deskSessionKey(session.origin), raw);
}
