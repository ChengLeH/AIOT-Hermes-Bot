export const COMPLETION_DEBOUNCE_MS = 80;

export type CompletionTrigger = "/" | "@";

export type CompletionItem = {
  label: string;
  description: string;
  insert: string;
  group: string;
  folder: boolean;
  mention: "text" | "agent";
};

export type CompletionToken = {
  trigger: CompletionTrigger;
  query: string;
  start: number;
  end: number;
};

const FORBIDDEN_COMPLETION_KEYS = ["cwd", "owner", "user_id", "chat_id", "session", "session_key", "file_root", "root"] as const;
const SLASH_MARKS = "/\uFF0F";
const AT_MARKS = "@\uFF20";

export function canUseDynamicCompletions(caps: { dynamic_completions?: boolean } | null | undefined): boolean {
  return caps?.dynamic_completions === true;
}

export function stripTriggerFromQuery(trigger: CompletionTrigger, query: string): string {
  if (!query) return "";
  const marks = trigger === "/" ? SLASH_MARKS : AT_MARKS;
  let q = query;
  while (q.length > 0 && marks.includes(q[0]!)) q = q.slice(1);
  return q;
}

function clampCaret(value: number, len: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > len) return len;
  return value;
}

export function completionCaretPosition(value: string, selectionStart: number, selectionEnd = selectionStart): number {
  const len = value.length;
  if (len <= 0) return 0;
  const start = clampCaret(selectionStart, len);
  const end = clampCaret(selectionEnd, len);
  const caret = Math.max(start, end);
  if (caret > 0) return caret;
  // Android IME paints a composition span and often reports 0,0 (or start of
  // the span) while the user is appending /h3 or @g at the end.
  return detectCompletionToken(value, len) ? len : 0;
}

export function detectCompletionToken(text: string, cursor: number): CompletionToken | null {
  if (cursor < 0 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  const slash = before.match(/^[/\uFF0F]([^\s]*)$/);
  if (slash) {
    return { trigger: "/", query: stripTriggerFromQuery("/", slash[1] ?? ""), start: 0, end: cursor };
  }
  const at = before.match(/(^|[\s])[@\uFF20]([^\s]*)$/);
  if (at) {
    const query = stripTriggerFromQuery("@", at[2] ?? "");
    const start = cursor - query.length - 1;
    if (start < 0) return null;
    if (!AT_MARKS.includes(text.charAt(start))) return null;
    if (start > 0 && !/\s/.test(text.charAt(start - 1))) return null;
    return { trigger: "@", query, start, end: cursor };
  }
  return null;
}

export function completionBody(input: {
  profile: string;
  conversation: string;
  trigger: CompletionTrigger;
  query: string;
}): { profile: string; conversation: string; trigger: CompletionTrigger; query: string } {
  return {
    profile: input.profile,
    conversation: input.conversation,
    trigger: input.trigger,
    query: stripTriggerFromQuery(input.trigger, input.query),
  };
}

export function assertCompletionBodySafe(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.length !== 4) return false;
  if (!keys.includes("profile") || !keys.includes("conversation") || !keys.includes("trigger") || !keys.includes("query")) {
    return false;
  }
  if (typeof body.trigger !== "string" || (body.trigger !== "/" && body.trigger !== "@")) return false;
  if (typeof body.query !== "string") return false;
  if (body.query.startsWith("/") || body.query.startsWith("@")) return false;
  return FORBIDDEN_COMPLETION_KEYS.every((key) => !(key in body));
}

function isFolderItem(row: Record<string, unknown>): boolean {
  const kind = String(row.kind ?? row.type ?? "").toLowerCase();
  if (kind === "folder" || kind === "container") return true;
  return row.folder === true || row.container === true;
}

function mentionKind(row: Record<string, unknown>): "text" | "agent" {
  const mode = String(row.mode ?? row.kind ?? row.type ?? "");
  if (mode === "bot-mode-message-agent") return "agent";
  return "text";
}

export function parseCompletionItems(json: unknown): CompletionItem[] {
  const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const rows = Array.isArray(rec.items) ? rec.items : Array.isArray(json) ? json : [];
  const out: CompletionItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const insert = typeof r.insert === "string" ? r.insert : typeof r.value === "string" ? r.value : "";
    const label = typeof r.label === "string" && r.label.trim() ? r.label : insert;
    if (!insert && !label) continue;
    out.push({
      label,
      description: typeof r.description === "string" ? r.description : "",
      insert: insert || label,
      group: typeof r.group === "string" ? r.group : "",
      folder: isFolderItem(r),
      mention: mentionKind(r),
    });
  }
  return out;
}

export function itemMatchesCompletionQuery(item: CompletionItem, trigger: CompletionTrigger, query: string): boolean {
  const q = stripTriggerFromQuery(trigger, query).toLowerCase();
  if (!q) return true;
  return [item.insert, item.label].some((raw) => {
    const s = raw.toLowerCase();
    const bare = stripTriggerFromQuery(trigger, s);
    return s.startsWith(q) || s.startsWith(`${trigger}${q}`) || bare.startsWith(q);
  });
}

export function filterCompletionItems(
  items: CompletionItem[],
  trigger: CompletionTrigger,
  query: string,
): CompletionItem[] {
  return items.filter((item) => itemMatchesCompletionQuery(item, trigger, query));
}

export function groupCompletionItems(items: CompletionItem[]): { group: string; items: CompletionItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, CompletionItem[]>();
  for (const item of items) {
    const key = item.group;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }
  return order.map((group) => ({ group, items: map.get(group) ?? [] }));
}

export function applyCompletionInsert(
  text: string,
  token: CompletionToken,
  item: CompletionItem,
): { text: string; cursor: number; keepOpen: boolean } {
  const trailing = item.folder || item.insert.endsWith(" ") ? "" : " ";
  const piece = `${item.insert}${trailing}`;
  const next = `${text.slice(0, token.start)}${piece}${text.slice(token.end)}`;
  return { text: next, cursor: token.start + piece.length, keepOpen: item.folder };
}

export function moveCompletionIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}

export type CompletionCacheKey = {
  origin: string;
  profile: string;
  conversation: string;
  trigger: CompletionTrigger;
  query: string;
};

export function completionCacheId(input: CompletionCacheKey): string {
  return `${input.origin}\0${input.profile}\0${input.conversation}\0${input.trigger}\0${input.query}`;
}

export function createCompletionCache() {
  const map = new Map<string, CompletionItem[]>();
  let scope = "";
  return {
    read(input: CompletionCacheKey): CompletionItem[] | undefined {
      const nextScope = `${input.origin}\0${input.profile}\0${input.conversation}`;
      if (scope !== nextScope) {
        map.clear();
        scope = nextScope;
      }
      return map.get(completionCacheId(input));
    },
    write(input: CompletionCacheKey, items: CompletionItem[]) {
      const nextScope = `${input.origin}\0${input.profile}\0${input.conversation}`;
      if (scope !== nextScope) {
        map.clear();
        scope = nextScope;
      }
      map.set(completionCacheId(input), items);
    },
    clear() {
      map.clear();
      scope = "";
    },
  };
}
