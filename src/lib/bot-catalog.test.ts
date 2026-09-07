import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBotCatalog, parseCanonicalSessionId, PROFILE_REFRESH_SECONDS } from "./bot-catalog.ts";

test("30 is refresh seconds, not a contact cap", () => {
  assert.equal(PROFILE_REFRESH_SECONDS, 30);
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `p${i}`, available: true }));
  const catalog = parseBotCatalog({ profiles: many });
  assert.equal(catalog.profiles.length, 40);
});

test("does not invent default or drop unavailable", () => {
  const catalog = parseBotCatalog({
    profiles: [
      { name: "alpha", available: false },
      { name: "beta", available: true },
    ],
  });
  assert.deepEqual(
    catalog.profiles.map((p) => p.name),
    ["alpha", "beta"],
  );
  assert.equal(catalog.profiles[0]?.available, false);
  assert.equal(catalog.profiles.some((p) => p.name === "default"), false);
});

test("each profile is one Bot Chat keyed by canonical_session.id", () => {
  const catalog = parseBotCatalog({
    profiles: [
      { name: "Grok", available: true, canonical_session: { id: "sess-grok" } },
      { name: "Codex", available: true, canonical_session: { id: "sess-codex" } },
      { name: "hidden" },
    ],
  });
  assert.equal(catalog.profiles.length, 3);
  assert.equal(catalog.profiles[0]?.canonicalSessionId, "sess-grok");
  assert.equal(catalog.profiles[1]?.canonicalSessionId, "sess-codex");
  assert.equal(catalog.profiles[2]?.canonicalSessionId, "");
  assert.equal(parseCanonicalSessionId({ canonical_session: { id: "  abc  " } }), "abc");
  assert.equal(parseCanonicalSessionId({ name: "Grok" }), "");
});

test("dynamic_completions is opt-in", () => {
  assert.equal(parseBotCatalog({ profiles: [] }).capabilities.dynamic_completions, false);
  assert.equal(parseBotCatalog({ profiles: [], capabilities: { dynamic_completions: false } }).capabilities.dynamic_completions, false);
  assert.equal(parseBotCatalog({ profiles: [], capabilities: { dynamic_completions: true } }).capabilities.dynamic_completions, true);
});

test("interrupts is opt-in", () => {
  assert.equal(parseBotCatalog({ profiles: [] }).capabilities.interrupts, false);
  assert.equal(parseBotCatalog({ profiles: [], capabilities: { interrupts: true } }).capabilities.interrupts, true);
});

test("display_name is optional and profile name stays the identifier", () => {
  const catalog = parseBotCatalog({
    profiles: [
      { name: "grok", available: true, display_name: "Grok Prime", canonical_session: { id: "s1" } },
      { name: "codex-cli", available: true },
    ],
  });
  assert.equal(catalog.profiles[0]?.name, "grok");
  assert.equal(catalog.profiles[0]?.displayName, "Grok Prime");
  assert.equal(catalog.profiles[1]?.name, "codex-cli");
  assert.equal(catalog.profiles[1]?.displayName, "");
});
