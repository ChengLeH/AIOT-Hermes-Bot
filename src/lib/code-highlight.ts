export type CodeTokenKind = "plain" | "comment" | "string" | "keyword" | "number" | "tag";

export type CodeToken = { text: string; kind: CodeTokenKind };

const COMMON = [
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "if",
  "implements", "import", "in", "interface", "let", "new", "null", "of", "pass", "private", "protected",
  "public", "raise", "return", "static", "super", "switch", "this", "throw", "true", "try", "type",
  "typeof", "undefined", "var", "void", "while", "with", "yield",
];

const KEYWORD = new Set(COMMON);
const TOKEN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|<!--?[\s\S]*?-->|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$-]*\b|<\/?[A-Za-z][^>]*>/g;

export function codeTokens(source: string, language = ""): CodeToken[] {
  const lang = language.trim().toLowerCase();
  const out: CodeToken[] = [];
  let cursor = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) out.push({ text: source.slice(cursor, index), kind: "plain" });
    const text = match[0];
    let kind: CodeTokenKind = "plain";
    if (/^(\/\/|\/\*|#|<!--)/.test(text)) kind = "comment";
    else if (/^["'`]/.test(text)) kind = "string";
    else if (/^\d/.test(text)) kind = "number";
    else if (/^<\/?[A-Za-z]/.test(text)) kind = "tag";
    else if (KEYWORD.has(text) || (lang === "json" && /^(true|false|null)$/.test(text))) kind = "keyword";
    out.push({ text, kind });
    cursor = index + text.length;
  }
  if (cursor < source.length) out.push({ text: source.slice(cursor), kind: "plain" });
  return out.length ? out : [{ text: source, kind: "plain" }];
}
