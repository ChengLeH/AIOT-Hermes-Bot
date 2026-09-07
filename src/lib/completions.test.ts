import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyCompletionInsert,
  assertCompletionBodySafe,
  canUseDynamicCompletions,
  COMPLETION_DEBOUNCE_MS,
  completionBody,
  completionCacheId,
  completionCaretPosition,
  createCompletionCache,
  detectCompletionToken,
  filterCompletionItems,
  groupCompletionItems,
  itemMatchesCompletionQuery,
  moveCompletionIndex,
  parseCompletionItems,
  stripTriggerFromQuery,
} from "./completions.ts";

test("debounce is 80ms", () => {
  assert.equal(COMPLETION_DEBOUNCE_MS, 80);
});

test("dynamic completions stay off unless the server sets the flag", () => {
  assert.equal(canUseDynamicCompletions(undefined), false);
  assert.equal(canUseDynamicCompletions({}), false);
  assert.equal(canUseDynamicCompletions({ dynamic_completions: false }), false);
  assert.equal(canUseDynamicCompletions({ dynamic_completions: true }), true);
});

test("slash tokens only match at the start of the message", () => {
  assert.deepEqual(detectCompletionToken("/he", 3), { trigger: "/", query: "he", start: 0, end: 3 });
  assert.deepEqual(detectCompletionToken("/h3", 3), { trigger: "/", query: "h3", start: 0, end: 3 });
  assert.equal(detectCompletionToken("note /he", 8), null);
  assert.equal(detectCompletionToken(" /he", 4), null);
  assert.equal(detectCompletionToken("hello", 5), null);
});

test("@ tokens match at a whitespace boundary", () => {
  assert.deepEqual(detectCompletionToken("@co", 3), { trigger: "@", query: "co", start: 0, end: 3 });
  assert.deepEqual(detectCompletionToken("@g", 2), { trigger: "@", query: "g", start: 0, end: 2 });
  assert.deepEqual(detectCompletionToken("hi @co", 6), { trigger: "@", query: "co", start: 3, end: 6 });
  assert.deepEqual(detectCompletionToken("hi @g", 5), { trigger: "@", query: "g", start: 3, end: 5 });
  assert.equal(detectCompletionToken("hi@co", 5), null);
});

test("local filtering strips triggers but the Hermes wire query retains exactly one", () => {
  assert.equal(stripTriggerFromQuery("/", "h3"), "h3");
  assert.equal(stripTriggerFromQuery("/", "/h3"), "h3");
  assert.equal(stripTriggerFromQuery("/", "//h3"), "h3");
  assert.equal(stripTriggerFromQuery("@", "g"), "g");
  assert.equal(stripTriggerFromQuery("@", "@g"), "g");
  assert.equal(detectCompletionToken("/h3", 3)?.query, "h3");
  assert.equal(detectCompletionToken("@g", 2)?.query, "g");
  const slash = completionBody({
    profile: "alpha",
    conversation: "c1",
    trigger: "/",
    query: "/h3",
  });
  assert.deepEqual(slash, { profile: "alpha", conversation: "c1", trigger: "/", query: "/h3" });
  assert.equal(assertCompletionBodySafe(slash), true);
  const at = completionBody({
    profile: "alpha",
    conversation: "c1",
    trigger: "@",
    query: "@g",
  });
  assert.deepEqual(at, { profile: "alpha", conversation: "c1", trigger: "@", query: "@g" });
  assert.equal(assertCompletionBodySafe(at), true);
  assert.equal(assertCompletionBodySafe({ ...slash, query: "h3" }), false);
  assert.equal(assertCompletionBodySafe({ ...at, query: "g" }), false);
});

test("Android IME composition span uses selectionEnd so query stays h3/g not /h3/@g", () => {
  assert.equal(completionCaretPosition("/h3", 0, 3), 3);
  assert.equal(completionCaretPosition("/h3", 0, 0), 3);
  assert.equal(completionCaretPosition("/h3", 1, 1), 1);
  assert.equal(detectCompletionToken("/h3", completionCaretPosition("/h3", 0, 3))?.query, "h3");
  assert.equal(detectCompletionToken("/h3", completionCaretPosition("/h3", 0, 0))?.query, "h3");
  assert.equal(completionCaretPosition("@g", 0, 2), 2);
  assert.equal(completionCaretPosition("@g", 0, 0), 2);
  assert.equal(detectCompletionToken("@g", completionCaretPosition("@g", 0, 0))?.query, "g");
  assert.equal(completionCaretPosition("hi @g", 0, 0), 5);
  assert.equal(detectCompletionToken("hi @g", completionCaretPosition("hi @g", 0, 0))?.query, "g");
  assert.equal(completionCaretPosition("hello", 0, 0), 0);
  assert.equal(completionCaretPosition("", 0, 0), 0);
});

test("server /h3-prompt and @grok match typed /h3 and @g", () => {
  const items = parseCompletionItems({
    items: [
      { label: "h3-prompt", insert: "/h3-prompt", group: "Commands" },
      { label: "help", insert: "/help", group: "Commands" },
      { label: "grok", insert: "@grok", group: "Agents", mode: "bot-mode-message-agent" },
      { label: "notes", insert: "@notes" },
    ],
  });
  const slash = filterCompletionItems(items, "/", "h3");
  assert.deepEqual(slash.map((item) => item.insert), ["/h3-prompt"]);
  assert.equal(itemMatchesCompletionQuery(items[0]!, "/", "/h3"), true);
  const at = filterCompletionItems(items, "@", "g");
  assert.deepEqual(at.map((item) => item.insert), ["@grok"]);
  assert.equal(itemMatchesCompletionQuery(items[2]!, "@", "@g"), true);
  assert.deepEqual(filterCompletionItems(items, "/", "zzz").map((item) => item.insert), []);
});

test("completion body is only profile conversation trigger query", () => {
  const body = completionBody({
    profile: "alpha",
    conversation: "c1",
    trigger: "/",
    query: "he",
  });
  assert.deepEqual(Object.keys(body).sort(), ["conversation", "profile", "query", "trigger"]);
  assert.equal(assertCompletionBodySafe(body), true);
  assert.equal("cwd" in body, false);
  assert.equal("owner" in body, false);
  assert.equal("user_id" in body, false);
  assert.equal("chat_id" in body, false);
  assert.equal("session" in body, false);
  assert.equal("session_key" in body, false);
  assert.equal("file_root" in body, false);
  assert.equal(
    assertCompletionBodySafe({ ...body, cwd: "/home/me" }),
    false,
  );
});

test("empty server list stays empty with no hardcoded commands", () => {
  assert.deepEqual(parseCompletionItems({ items: [] }), []);
  assert.deepEqual(parseCompletionItems({}), []);
  assert.deepEqual(parseCompletionItems(null), []);
  const parsed = parseCompletionItems({
    items: [
      { label: "help", insert: "/help", group: "Commands", description: "usage" },
      { label: "skills", insert: "/skills/", kind: "folder" },
      { label: "codex", insert: "@codex", group: "Agents", mode: "bot-mode-message-agent" },
      { label: "notes", insert: "@notes" },
    ],
  });
  assert.equal(parsed.some((item) => item.insert === "/status"), false);
  assert.equal(parsed[1]?.folder, true);
  assert.equal(parsed[2]?.mention, "agent");
  assert.equal(parsed[3]?.mention, "text");
  assert.deepEqual(
    groupCompletionItems(parsed).map((g) => g.group),
    ["Commands", "", "Agents"],
  );
});

test("insert is verbatim; folders stay open without a trailing space", () => {
  const slash = detectCompletionToken("/sk", 3)!;
  const folder = applyCompletionInsert("/sk", slash, {
    label: "skills",
    description: "",
    insert: "/skills/",
    group: "",
    folder: true,
    mention: "text",
  });
  assert.equal(folder.text, "/skills/");
  assert.equal(folder.keepOpen, true);
  assert.equal(folder.cursor, "/skills/".length);

  const at = detectCompletionToken("hi @co", 6)!;
  const mention = applyCompletionInsert("hi @co", at, {
    label: "codex",
    description: "",
    insert: "@codex",
    group: "",
    folder: false,
    mention: "text",
  });
  assert.equal(mention.text, "hi @codex ");
  assert.equal(mention.keepOpen, false);
});

test("cache is keyed by origin profile conversation trigger query and clears on scope change", () => {
  const cache = createCompletionCache();
  const a = { origin: "https://a.example", profile: "alpha", conversation: "c1", trigger: "/" as const, query: "h" };
  cache.write(a, [{ label: "help", description: "", insert: "/help", group: "", folder: false, mention: "text" }]);
  assert.equal(cache.read(a)?.[0]?.insert, "/help");
  assert.notEqual(completionCacheId(a), completionCacheId({ ...a, query: "he" }));
  cache.write({ ...a, profile: "beta" }, []);
  assert.equal(cache.read(a), undefined);
});

test("arrow wrapping stays in range", () => {
  assert.equal(moveCompletionIndex(0, -1, 3), 2);
  assert.equal(moveCompletionIndex(2, 1, 3), 0);
  assert.equal(moveCompletionIndex(0, 1, 0), 0);
});

test("composer posts the Hermes token query and reads the IME composition span caret", () => {
  const view = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
  assert.equal(view.includes("completionCaretPosition"), true);
  assert.equal(view.includes("filterCompletionItems"), true);
  assert.equal(view.includes('autoCapitalize="none"'), true);
  const native = readFileSync(new URL("./native-bot.ts", import.meta.url), "utf8");
  assert.equal(native.includes("completionBody(input)"), true);
  assert.equal(native.includes("/api/bot/completions"), true);
});

// Captures the real Bot API contract: an empty bare query returns 400.
test("bare slash and at sign request the server catalog; containers stay navigable", () => {
  for (const trigger of ["/", "@"] as const) {
    assert.equal(completionBody({profile: "example", conversation: "c", trigger, query: ""}).query, trigger);
  }
  const [item] = parseCompletionItems({items: [{label: "@file:", insert: "@file:", is_container: true}]});
  assert.equal(applyCompletionInsert("@", detectCompletionToken("@", 1)!, item!).text, "@file:");
});
