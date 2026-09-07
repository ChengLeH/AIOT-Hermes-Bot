export type SearchableMessage = { id: string; content: string };

export type HighlightPiece = { text: string; hit: boolean };

export function escapeSearchRe(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findMessageMatches(messages: SearchableMessage[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return messages.filter((m) => m.content.toLowerCase().includes(q)).map((m) => m.id);
}

export function nextMatchIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}

export function searchCountLabel(index: number, count: number): string {
  if (count <= 0) return "0";
  return `${index + 1}/${count}`;
}

export function highlightPieces(text: string, query: string): HighlightPiece[] {
  const q = query.trim();
  if (!text) return [];
  if (!q) return [{ text, hit: false }];
  const re = new RegExp(escapeSearchRe(q), "ig");
  const out: HighlightPiece[] = [];
  let last = 0;
  let match = re.exec(text);
  while (match) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), hit: false });
    out.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
    if (match[0].length === 0) re.lastIndex += 1;
    match = re.exec(text);
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}
