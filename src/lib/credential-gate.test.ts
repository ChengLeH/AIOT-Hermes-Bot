import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMissingCredential,
  botPresenceOnline,
  connectionLive,
  failedProbe,
  isUnauthorizedStatus,
  MISSING_KEY_NOTICE,
  persistConnectionSlice,
  resolveCredentialGate,
  sanitizeHydratedConnection,
} from "./credential-gate.ts";
import { captureDeskSession, restoreAfterProfiles } from "./session.ts";

const ORIGIN = "https://machine.example.ts.net";
const CONV = "11111111-1111-4111-8111-111111111111";

const staleProbe = {
  ok: true,
  at: 1,
  transport: "native-bot" as const,
  profiles: [{ name: "alpha", available: true, canonicalSessionId: "sess-alpha" }],
  capabilities: {
    attachments: false,
    attachment_uploads: false,
    attachment_downloads: false,
    max_attachment_bytes: 10_485_760,
    durable_events: true,
    completion_events: true,
    dynamic_completions: true,
    interrupts: false,
  },
};

test("missing session key opens settings and clears connected status", () => {
  const gate = resolveCredentialGate({
    origin: ORIGIN,
    apiKey: "",
    lastProbe: staleProbe,
  });
  assert.equal(gate.missingKey, true);
  assert.equal(gate.live, false);
  assert.equal(gate.view, "settings");
  assert.equal(gate.notice, MISSING_KEY_NOTICE);
  assert.equal(gate.probe?.ok, false);
  assert.equal(gate.probe?.capabilities.attachments, false);
  assert.equal(gate.probe?.capabilities.attachment_uploads, false);
  assert.deepEqual(gate.probe?.profiles, staleProbe.profiles);
  assert.equal("apiKey" in (gate.probe ?? {}), false);
});

test("persisted connection slice never includes the key and is not current", () => {
  const slice = persistConnectionSlice({
    origin: ORIGIN,
    apiKey: "secret-should-not-persist",
    lastProbe: staleProbe,
  });
  assert.deepEqual(Object.keys(slice).sort(), ["lastProbe", "origin"]);
  assert.equal("apiKey" in slice, false);
  assert.equal(JSON.stringify(slice).includes("secret-should-not-persist"), false);
  assert.equal(slice.lastProbe?.ok, false);
  assert.equal(connectionLive({ origin: ORIGIN, apiKey: "secret-should-not-persist", lastProbe: slice.lastProbe }), false);
});

test("401 marks the same disconnected state", () => {
  assert.equal(isUnauthorizedStatus(401), true);
  const probe = applyMissingCredential(staleProbe, MISSING_KEY_NOTICE);
  assert.equal(probe.ok, false);
  assert.equal(probe.error, MISSING_KEY_NOTICE);
  assert.equal(probe.capabilities.attachment_uploads, false);
  assert.equal(probe.capabilities.dynamic_completions, false);
  assert.equal(probe.capabilities.interrupts, false);
  assert.equal(connectionLive({ origin: ORIGIN, apiKey: "x", lastProbe: probe }), false);
});

test("reconnect restores the prior contact without a device-local conversation id", () => {
  const stored = captureDeskSession({
    origin: ORIGIN,
    view: "chat",
    profile: "alpha",
    conversation: CONV,
    conversations: { alpha: CONV },
    drafts: { alpha: "還在" },
  });
  const restored = restoreAfterProfiles({
    profiles: [{ name: "alpha" }, { name: "beta" }],
    stored,
  });
  assert.equal(restored.view, "chat");
  assert.equal(restored.profile, "alpha");
  assert.equal(restored.conversation, null);
  assert.deepEqual(restored.conversations, {});
  assert.equal(restored.drafts.alpha, "還在");
});

test("live connection needs origin, key, and a successful current probe", () => {
  assert.equal(connectionLive({ origin: ORIGIN, apiKey: "k", lastProbe: staleProbe }), true);
  assert.equal(connectionLive({ origin: ORIGIN, apiKey: "", lastProbe: staleProbe }), false);
  assert.equal(connectionLive({ origin: ORIGIN, apiKey: "k", lastProbe: applyMissingCredential(staleProbe) }), false);
  assert.equal(connectionLive({ origin: ORIGIN, apiKey: "k", lastProbe: failedProbe(staleProbe, "timeout") }), false);
  assert.equal(connectionLive({ origin: ORIGIN, apiKey: "k", lastProbe: null }), false);
  const hydrated = sanitizeHydratedConnection({ origin: ORIGIN, apiKey: "", lastProbe: staleProbe }, "k");
  assert.equal(hydrated.apiKey, "k");
  assert.equal(hydrated.lastProbe?.ok, false);
  assert.equal(connectionLive(hydrated), false);
});

test("missing-key banner never coexists with Online", () => {
  const missing = resolveCredentialGate({ origin: ORIGIN, apiKey: "", lastProbe: staleProbe });
  assert.equal(missing.live, false);
  assert.equal(missing.missingKey, true);
  assert.equal(missing.notice, MISSING_KEY_NOTICE);
  const rejected = resolveCredentialGate({
    origin: ORIGIN,
    apiKey: "expired",
    lastProbe: applyMissingCredential(staleProbe),
  });
  assert.equal(rejected.live, false);
  assert.equal(rejected.missingKey, true);
  const unreachable = resolveCredentialGate({
    origin: ORIGIN,
    apiKey: "k",
    lastProbe: failedProbe(staleProbe, "timeout"),
  });
  assert.equal(unreachable.live, false);
  assert.equal(unreachable.missingKey, false);
  assert.equal(unreachable.notice, null);
  const live = resolveCredentialGate({ origin: ORIGIN, apiKey: "k", lastProbe: staleProbe });
  assert.equal(live.live, true);
  assert.equal(live.missingKey, false);
  assert.equal(live.notice, null);
  assert.equal(botPresenceOnline({ live: true, available: true }), true);
  assert.equal(botPresenceOnline({ live: false, available: true }), false);
  assert.equal(botPresenceOnline({ live: true, available: false }), false);
});

