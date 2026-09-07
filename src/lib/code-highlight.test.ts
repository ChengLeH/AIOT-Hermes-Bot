import assert from "node:assert/strict";
import test from "node:test";
import { codeTokens } from "./code-highlight.ts";

test("code blocks color comments strings keywords numbers and tags without changing text", () => {
  const source = "const count = 42; // note\n<div>\"ok\"</div>";
  const tokens = codeTokens(source, "tsx");
  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.equal(tokens.some((token) => token.kind === "keyword" && token.text === "const"), true);
  assert.equal(tokens.some((token) => token.kind === "number" && token.text === "42"), true);
  assert.equal(tokens.some((token) => token.kind === "comment"), true);
  assert.equal(tokens.some((token) => token.kind === "tag"), true);
  assert.equal(tokens.some((token) => token.kind === "string"), true);
});
