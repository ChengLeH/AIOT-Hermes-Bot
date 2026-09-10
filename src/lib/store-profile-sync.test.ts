import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadStore() {
  type StoreState = Record<string, any>;
  type SetState = (patch: Partial<StoreState> | ((current: StoreState) => Partial<StoreState>)) => void;
  let state: StoreState;
  const set: SetState = (patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  };
  const create = () => (initializer: (set: SetState, get: () => StoreState) => StoreState) => {
    state = initializer(set, () => state);
    return { getState: () => state, subscribe: () => () => {} };
  };
  const modules: Record<string, unknown> = {
    "zustand": { create },
    "zustand/middleware": { persist: (initializer: unknown) => initializer, createJSONStorage: () => () => ({}) },
    "./session-history": { isImportedSessionMessage: () => false },
    "./attachment-preview": { resetPreviewCaches: () => {}, sanitizeAttachment: (value: unknown) => value },
    "./unread": { shouldShowUnread: () => true },
    "./encrypted-storage": { encryptedBrowserStorage: () => ({}) },
    "./bots": { botFromProfile: (profile: string, available: boolean, conversation: string, displayName?: string) => ({ id: `hp:${profile}`, profile, available, conversation, name: displayName ?? profile, title: displayName ?? "", bio: profile, swatch: "moss", pinned: false, createdAt: 0 }), botDisplayName: (profile: string, displayName?: string) => displayName || profile },
    "./brand": { eyeSwatchesForProfiles: (profiles: string[]) => new Map(profiles.map((profile) => [profile, "moss"])) },
    "./utils": { uid: () => "local" },
    "./secrets": { boundPasswordOrigin: () => "", writePassword: async () => {}, clearPassword: async () => {}, credentialStorageUnavailable: () => false },
    "./session": { MISSING_BOT_NOTICE: "missing", shouldClearMessagesForOrigin: (previous: string, next: string) => Boolean(previous && next && previous !== next) },
    "./credential-gate": { applyMissingCredential: (value: unknown) => value, MISSING_KEY_NOTICE: "key", persistConnectionSlice: (value: unknown) => value },
    "./approvals": { mergeApproval: (items: unknown[]) => items, sanitizeApproval: (value: unknown) => value },
    "./history": { sanitizeMessage: (value: unknown) => value, mergeAttachmentMeta: (_old: unknown, next: unknown) => next },
    "./task-completion": { mergeTaskCompletionMessages: () => null },
    "./bot-window": {
      liveBotMessages: (messages: unknown[]) => messages,
      settleOrphanPending: (messages: unknown[]) => messages,
    },
  };
  const exports = {} as { useDesk: { getState: () => StoreState } };
  const code = ts.transpileModule(readFileSync(new URL("./store.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  return exports.useDesk;
}

test("profile refresh retains messages for temporarily absent profiles", () => {
  const desk = loadStore();
  desk.getState().syncHermesProfiles([{ name: "alpha", available: true, canonicalSessionId: "session" }]);
  const botId = desk.getState().bots[0].id;
  desk.getState().pushPendingUser(botId, "saved message");
  desk.getState().syncHermesProfiles([]);
  assert.equal(desk.getState().bots.length, 0);
  assert.equal(desk.getState().messages.length, 1);
  assert.equal(desk.getState().messages[0].content, "saved message");
});

test("a verified different origin clears retained history before its profiles apply", () => {
  const desk = loadStore();
  desk.getState().setConnection({ origin: "https://first.example" });
  desk.getState().confirmMessageOrigin("https://first.example");
  desk.getState().syncHermesProfiles([{ name: "alpha", available: true, canonicalSessionId: "session" }]);
  const botId = desk.getState().bots[0].id;
  desk.getState().pushPendingUser(botId, "private to first origin");
  desk.getState().setConnection({ origin: "https://second.example" });
  desk.getState().confirmMessageOrigin("https://second.example");
  assert.equal(desk.getState().messages.length, 0);
  assert.equal(desk.getState().messageOrigin, "https://second.example");
});

test("history reset is applied once and preserves messages sent after the reset", () => {
  const desk = loadStore();
  desk.getState().syncHermesProfiles([{ name: "alpha", available: true, canonicalSessionId: "session" }]);
  desk.getState().upsertEventMessage({ profile: "alpha", conversation: "session", messageId: "old", role: "user", text: "old", createdAt: 100 });
  desk.getState().upsertEventMessage({ profile: "alpha", conversation: "session", messageId: "new", role: "user", text: "new", createdAt: 300 });
  assert.equal(desk.getState().applyHistoryReset(200), true);
  assert.equal(desk.getState().messages.length, 1);
  assert.equal(desk.getState().messages[0].content, "new");
  assert.equal(desk.getState().applyHistoryReset(200), false);
  assert.equal(desk.getState().applyHistoryReset(-1), false);
});
