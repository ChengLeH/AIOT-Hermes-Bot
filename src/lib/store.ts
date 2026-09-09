import { isImportedSessionMessage } from "./session-history";
import { resetPreviewCaches } from "./attachment-preview";
import { isReadingBot } from "./unread";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { encryptedBrowserStorage } from "./encrypted-storage";
import { botFromProfile, botDisplayName, type Bot } from "./bots";
import { eyeSwatchesForProfiles } from "./brand";
import type { NativeBotCapabilities, NativeBotProfile } from "./bot-catalog";
import type { ActivityLine, ChatMessage, Connection, HermesProbe } from "./types";
import type { AttachmentDescriptor } from "./attachment-rules";
import { uid } from "./utils";
import { boundPasswordOrigin, writePassword, clearPassword, credentialStorageUnavailable } from "./secrets";
import { MISSING_BOT_NOTICE, type RestoreResult } from "./session";
import { applyMissingCredential, MISSING_KEY_NOTICE, persistConnectionSlice } from "./credential-gate";
import type { Locale } from "./locale";
import { mergeApproval, sanitizeApproval, type ApprovalCard } from "./approvals";
import { sanitizeMessage, mergeAttachmentMeta } from "./history";
import { sanitizeAttachment } from "./attachment-preview";

export type DeskView = "roster" | "chat" | "settings";

type DeskState = {
  onboarded: boolean;
  view: DeskView;
  bots: Bot[];
  messages: ChatMessage[];
  activity: Record<string, ActivityLine[]>;
  notices: { id: string; label: string; at: number }[];
  botState: Record<string, "idle" | "working" | "waiting">;
  activeBotId: string | null;
  composerDrafts: Record<string, string>;
  connection: Connection;
  search: string;
  sending: Record<string, boolean>;
  sessionNotice: string | null;
  locale: Locale | null;
  approvals: ApprovalCard[];
  unreadBots: Record<string, boolean>;
  markUnread: (id: string) => void;
  markRead: (id: string) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  setView: (view: DeskView) => void;
  openBot: (id: string) => void;
  openFromPush: (profile: string, session?: string) => boolean;
  setSearch: (q: string) => void;
  setDraft: (botId: string, text: string) => void;
  pinBot: (id: string) => void;
  setBotState: (botId: string, state: "idle" | "working" | "waiting") => void;
  pushActivity: (botId: string, line: Omit<ActivityLine, "id" | "at"> & { id?: string }) => void;
  pushNotice: (label: string) => void;
  setSending: (botId: string, busy: boolean) => void;
  setConnection: (patch: Partial<Connection>) => void;
  setLocale: (locale: Locale) => void;
  setProbe: (probe: HermesProbe) => void;
  markDisconnected: (reason?: string) => void;
  syncHermesProfiles: (
    profiles: NativeBotProfile[],
    capabilities?: NativeBotCapabilities,
  ) => void;
  restoreDesk: (result: RestoreResult) => void;
  ensureConversation: (botId: string) => string;
  setConversation: (botId: string, conversation: string) => void;
  upsertEventMessage: (input: {
    profile: string;
    conversation: string;
    messageId: string;
    role: "user" | "assistant";
    text: string;
    createdAt?: number;
    historical?: boolean;
    keepRole?: boolean;
    streaming?: boolean;
    attachments?: AttachmentDescriptor[];
  }) => void;
  adoptPendingUser: (botId: string, text: string, messageId: string) => void;
  dropPendingUser: (botId: string, localId?: string) => void;
  pushPendingUser: (botId: string, text: string, attachments?: AttachmentDescriptor[]) => string;
  upsertApproval: (card: ApprovalCard) => void;
};

const defaultConnection: Connection = {
  origin: "",
  apiKey: "",
  lastProbe: null,
};

export const useDesk = create<DeskState>()(
  persist(
    (set, get) => ({
      onboarded: false,
      view: "roster",
      bots: [],
      messages: [],
      activity: {},
      notices: [],
      botState: {},
      activeBotId: null,
      composerDrafts: {},
      connection: defaultConnection,
      search: "",
      sending: {},
      sessionNotice: null,
      locale: null,
      approvals: [],
      unreadBots: {},
      markUnread: (id) => set((s) => ({ unreadBots: { ...s.unreadBots, [id]: !isReadingBot(id, s.activeBotId, s.view, typeof document !== "undefined" && document.visibilityState === "visible") } })),
      markRead: (id) => set((s) => s.unreadBots[id] ? { unreadBots: { ...s.unreadBots, [id]: false } } : {}),
      completeOnboarding: () => set({ onboarded: true, view: "roster" }),
      resetOnboarding: () => {
        clearPassword(get().connection.origin);
        set({
          onboarded: false,
          view: "roster",
          sessionNotice: null,
          connection: { origin: get().connection.origin, apiKey: "", lastProbe: get().connection.lastProbe },
        });
      },
      setView: (view) => set({ view, sessionNotice: view === "chat" ? null : get().sessionNotice }),
      openBot: (id) => { get().markRead(id); set({ activeBotId: id, view: "chat", sessionNotice: null }); },
      openFromPush: (profile) => {
        const bot = get().bots.find((b) => b.profile === profile);
        if (!bot) return false;
        set({ activeBotId: bot.id, view: "chat" });
        return true;
      },
      setSearch: (search) => set({ search }),
      setLocale: (locale) => set({ locale }),
      setDraft: (botId, text) =>
        set((s) => ({ composerDrafts: { ...s.composerDrafts, [botId]: text } })),
      pinBot: (id) =>
        set((s) => ({
          bots: s.bots.map((b) => (b.id === id ? { ...b, pinned: !b.pinned } : b)),
        })),
      setBotState: (botId, state) =>
        set((s) => ({ botState: { ...s.botState, [botId]: state },
          messages: state === "idle" ? s.messages.map((m) => m.botId === botId && m.streaming ? { ...m, streaming: false } : m) : s.messages })),
      pushActivity: (botId, line) => {
        const item: ActivityLine = {
          id: line.id ?? uid("act"),
          label: line.label,
          kind: line.kind,
          at: Date.now(),
        };
        set((s) => ({
          activity: {
            ...s.activity,
            [botId]: [...(s.activity[botId] ?? []), item].slice(-40),
          },
        }));
      },
      pushNotice: (label) =>
        set((s) => ({
          notices: [...s.notices, { id: uid("note"), label, at: Date.now() }].slice(-20),
        })),
      setSending: (botId, busy) =>
        set((s) => ({ sending: { ...s.sending, [botId]: busy } })),
      setConnection: (patch) => {
        const prevOrigin = get().connection.origin;
        const origin = patch.origin ?? prevOrigin;
        if (typeof patch.apiKey === "string") {
          void writePassword(origin, patch.apiKey).then(() => {
            if (credentialStorageUnavailable()) get().pushNotice(get().locale === "en" ? "Secure key storage is unavailable. This connection is kept only until you close this page." : "無法使用安全金鑰儲存；本次連線只會保留到關閉此頁面。");
          });
          const prevBound = boundPasswordOrigin(prevOrigin);
          const nextBound = boundPasswordOrigin(origin);
          if (prevBound && nextBound && prevBound !== nextBound) clearPassword(prevOrigin);
        }
        set((s) => ({ connection: { ...s.connection, ...patch } }));
      },
      setProbe: (lastProbe) =>
        set((s) => ({
          connection: { ...s.connection, lastProbe },
          sessionNotice:
            lastProbe.ok && s.sessionNotice === MISSING_KEY_NOTICE ? null : s.sessionNotice,
        })),
      markDisconnected: (reason = MISSING_KEY_NOTICE) =>
        set((s) => ({
          view: s.view === "chat" && s.activeBotId ? "chat" : "settings",
          sessionNotice: reason,
          connection: {
            ...s.connection,
            lastProbe: applyMissingCredential(s.connection.lastProbe, reason),
          },
        })),
      syncHermesProfiles: (profiles, _capabilities) =>
        set((s) => {
          const incoming = profiles.filter((p) => p.name);
          const colors = eyeSwatchesForProfiles(incoming.map((p) => p.name));
          const next: Bot[] = incoming.map((p) => {
            const prev = s.bots.find((b) => b.profile === p.name);
            const conversation = p.canonicalSessionId;
            if (prev) {
              return {
                ...prev,
                name: botDisplayName(p.name, p.displayName),
                available: p.available,
                title: p.displayName || (p.available ? prev.title : ""),
                swatch: colors.get(p.name)!,
                conversation,
                nativeCapabilities: p.nativeCapabilities,
              };
            }
            return { ...botFromProfile(p.name, p.available, conversation, p.displayName), swatch: colors.get(p.name)!, nativeCapabilities: p.nativeCapabilities };
          });
          const ids = new Set(next.map((b) => b.id));
          const activeOk = Boolean(s.activeBotId && ids.has(s.activeBotId));
          const chatMissing = s.view === "chat" && !activeOk;
          return {
            bots: next,
            messages: s.messages.filter((m) => ids.has(m.botId)),
            activeBotId: activeOk ? s.activeBotId : null,
            view: chatMissing ? "roster" : s.view,
            sessionNotice: chatMissing ? MISSING_BOT_NOTICE : s.sessionNotice,
            composerDrafts: Object.fromEntries(
              Object.entries(s.composerDrafts).filter(([id]) => ids.has(id)),
            ),
          };
        }),
      restoreDesk: (result) =>
        set((s) => {
          const active = result.profile ? s.bots.find((b) => b.profile === result.profile) : undefined;
          const drafts: Record<string, string> = {};
          for (const b of s.bots) {
            const text = result.drafts[b.profile];
            if (text) drafts[b.id] = text;
          }
          return {
            view: result.view,
            activeBotId: active?.id ?? null,
            composerDrafts: drafts,
            sessionNotice: result.notice,
          };
        }),
      ensureConversation: (botId) => get().bots.find((b) => b.id === botId)?.conversation ?? "",
      setConversation: (botId, conversation) =>
        set((s) => ({
          bots: s.bots.map((b) => (b.id === botId ? { ...b, conversation } : b)),
        })),
      upsertEventMessage: ({ profile, conversation, messageId, role, text, createdAt, historical, keepRole, streaming, attachments }) => {
        const bot = get().bots.find((b) => b.profile === profile);
        if (!bot) return;
        void conversation;
        set((s) => {
          const existing = s.messages.find((m) => m.botId === bot.id && m.messageId === messageId);
          if (existing) {
            return {
              messages: s.messages.map((m) =>
                m.id === existing.id && m.botId === bot.id
                  ? {
                      ...m,
                      content: text,
                      ...((historical || isImportedSessionMessage(messageId)) && typeof createdAt === "number" && Number.isFinite(createdAt) ? { createdAt } : {}),
                      streaming,
                      pending: false,
                      role: keepRole ? m.role : role,
                      attachments: mergeAttachmentMeta(m.attachments, attachments),
                    }
                  : m,
              ).sort((a, b) => a.createdAt - b.createdAt),
            };
          }
          const pending = role === "user"
            ? s.messages.find((m) => m.botId === bot.id && m.pending && m.content === text)
            : undefined;
          if (pending) {
            return {
              messages: s.messages.map((m) =>
                m.id === pending.id
                  ? { ...m, messageId, content: text, pending: false, attachments: mergeAttachmentMeta(m.attachments, attachments) }
                  : m,
              ),
            };
          }
          return {
            messages: [
              ...s.messages,
              {
                id: messageId,
                botId: bot.id,
                role,
                content: text,
                streaming,
                createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now(),
                messageId,
                attachments: mergeAttachmentMeta(undefined, attachments),
              },
            ].sort((a, b) => a.createdAt - b.createdAt),
          };
        });
      },
      adoptPendingUser: (botId, text, messageId) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.botId === botId && m.pending && m.content === text
              ? { ...m, messageId, pending: false }
              : m,
          ),
        })),
      dropPendingUser: (botId, localId) =>
        set((s) => ({
          messages: s.messages.filter((m) => {
            if (m.botId !== botId || !m.pending) return true;
            if (localId) return m.id !== localId;
            return false;
          }),
        })),
      pushPendingUser: (botId, text, attachments) => {
        const id = uid("local");
        const safe = (attachments ?? [])
          .map((item) => sanitizeAttachment(item))
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id,
              botId,
              role: "user",
              content: text,
              createdAt: Date.now(),
              pending: true,
              attachments: safe.length > 0 ? safe : undefined,
            },
          ],
        }));
        return id;
      },
      upsertApproval: (card) =>
        set((s) => ({
          approvals: mergeApproval(s.approvals, card),
        })),
    }),
    {
      name: "hermes-bot-desk-v4",
      storage: createJSONStorage(() => encryptedBrowserStorage()),
      skipHydration: true,
      partialize: (s) => ({
        onboarded: s.onboarded,
        unreadBots: s.unreadBots,
        locale: s.locale,
        view: s.view,
        activeBotId: s.activeBotId,
        composerDrafts: s.composerDrafts,
        messages: s.messages.map(sanitizeMessage).slice(-500),
        approvals: s.approvals.map(sanitizeApproval).slice(-100),
        bots: s.bots.map((b) => ({
          id: b.id,
          name: b.name,
          title: b.title,
          bio: b.bio,
          swatch: b.swatch,
          pinned: b.pinned,
          createdAt: b.createdAt,
          profile: b.profile,
          available: b.available,
          conversation: b.conversation,
        })),
        connection: persistConnectionSlice(s.connection),
      }),
    },
  ),
);

export function lastMessageFor(botId: string, messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.botId === botId) return messages[i];
  }
  return undefined;
}

useDesk.subscribe((next, previous) => {
  if (next.connection.origin !== previous.connection.origin || next.connection.apiKey !== previous.connection.apiKey) resetPreviewCaches();
});
