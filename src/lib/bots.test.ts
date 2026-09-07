import assert from "node:assert/strict";
import { test } from "node:test";
import { botDisplayName, botFromProfile, titleCaseProfileId } from "./bots.ts";

test("ordinary profile ids become readable title case", () => {
  assert.equal(titleCaseProfileId("grok"), "Grok");
  assert.equal(titleCaseProfileId("codex"), "Codex");
  assert.equal(titleCaseProfileId("codex-cli"), "Codex Cli");
  assert.equal(titleCaseProfileId("big"), "Big");
  assert.equal(titleCaseProfileId("  Grok  "), "Grok");
  assert.equal(botFromProfile("grok", true, "sess").name, "Grok");
  assert.equal(botFromProfile("codex-cli", true, "sess").name, "Codex Cli");
  assert.equal(botFromProfile("grok", true, "sess").profile, "grok");
});

test("intentional display_name wins over title-cased profile id", () => {
  assert.equal(botDisplayName("grok", "Grok Prime"), "Grok Prime");
  assert.equal(botDisplayName("grok", "  "), "Grok");
  assert.equal(botDisplayName("grok"), "Grok");
  assert.equal(botFromProfile("grok", true, "sess", "Grok Prime").name, "Grok Prime");
  assert.equal(botFromProfile("grok", true, "sess", "Grok Prime").profile, "grok");
});
