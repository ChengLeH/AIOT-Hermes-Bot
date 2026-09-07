/** Split a cumulative response without exposing an unfinished sentence or code fence.
 * Concatenating completed output reproduces the original message byte for byte.
 */
export function sentenceBubbles(text: string, streaming: boolean): string[] {
  const parts: string[] = [];
  let start = 0;
  let fence = "";
  let inline = false;
  let lineStart = true;
  let structured = false;
  for (let i = 0; i < text.length; i++) {
    if (lineStart) {
      const line = text.slice(i).split("\n", 1)[0];
      if (/^\s*(?:#{1,6} |[-+*] |\d+[.)] |> )/.test(line) || /^\s*\|/.test(line)) structured = true;
      const match = text.slice(i).match(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/);
      if (match) {
        if (!fence) {
          if (i > start) { parts.push(text.slice(start, i)); start = i; }
          fence = match[1];
        } else if (match[1][0] === fence[0] && match[1].length >= fence.length && /^[ \t]*$/.test(match[0].trim().slice(match[1].length))) {
          fence = "";
          const end = i + match[0].length;
          parts.push(text.slice(start, end)); start = end;
        }
        i += match[0].length - 1;
        lineStart = match[0].endsWith("\n");
        continue;
      }
    }
    const c = text[i];
    if (!fence && !inline && /[|*_\[]/.test(c)) structured = true;
    if (!fence && c === "`") inline = !inline;
    if (!fence && !inline) {
      const cjkEnd = /[。！？]/.test(c);
      const englishEnd = /[.!?]/.test(c) && /\s/.test(text[i + 1] ?? "") && !/\b(?:Mr|Mrs|Dr|Prof|e\.g|i\.e)\.$/.test(text.slice(start, i + 1));
      const paragraphEnd = c === "\n" && text[i - 1] === "\n";
      if ((!structured && (cjkEnd || englishEnd)) || paragraphEnd) {
        parts.push(text.slice(start, i + 1)); start = i + 1;
        if (paragraphEnd) structured = false;
      }
    }
    lineStart = c === "\n";
  }
  if (!streaming && start < text.length) parts.push(text.slice(start));
  // Attach whitespace to the next bubble, rather than rendering blank bubbles.
  const visible: string[] = [];
  let gap = "";
  for (const part of parts) {
    if (!part.trim()) { gap += part; continue; }
    visible.push(gap + part); gap = "";
  }
  if (gap && visible.length) visible[visible.length - 1] += gap;
  return visible;
}
