import type { ChatMessage } from "./types";
export type SessionMessage = {
  messageId: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
};
export function isImportedSessionMessage(messageId: string | undefined): boolean {
  return typeof messageId === "string" && /^hermes-[^:]*:[^:]*:.+/.test(messageId);
}

export function isNativeRunAssistantId(messageId: string | undefined): boolean {
  return typeof messageId === "string" && /^native-(?!user-)/.test(messageId);
}

function sessionAssistantCoveredByNative(
  existing: readonly ChatMessage[],
  rows: readonly SessionMessage[],
  index: number,
  matched: (ChatMessage | undefined)[],
): boolean {
  if (rows[index]?.role !== "assistant") return false;
  let userIndex = index - 1;
  while (userIndex >= 0 && rows[userIndex].role !== "user") userIndex--;
  const existingUser = userIndex >= 0 ? matched[userIndex] : undefined;
  if (!existingUser) return false;
  return existing.some(
    (message) =>
      message.role === "assistant" &&
      isNativeRunAssistantId(message.messageId) &&
      message.createdAt >= existingUser.createdAt,
  );
}
// Reuse one existing bubble per matching occurrence. A repeated "hello" is not
// globally deduplicated, and the live event identity remains stable.
export function missingSessionMessages(
  existing: ChatMessage[],
  rows: SessionMessage[],
): SessionMessage[] {
  const available = [...existing];
  const matched = rows.map((row) => {
    let index = available.findIndex((m) => m.messageId === row.messageId);
    if (index < 0)
      index = available.findIndex((m) => m.role === row.role && m.content === row.text);
    return index < 0 ? undefined : available.splice(index, 1)[0];
  });
  // The official Session API returns insertion order even for order=latest.
  // Missing historical timestamps must never inherit the time of this fetch.
  const stamps = rows.map((row, index) => {
    const match = matched[index];
    // Imported rows may already carry the old fetch-time bug. Only live event
    // identities or a timestamp supplied by Hermes can anchor their repair.
    const value = match && !isImportedSessionMessage(match.messageId) ? match.createdAt : row.createdAt;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  });
  const existingTimes = existing.filter(m => !isImportedSessionMessage(m.messageId)).map(m => m.createdAt).filter(Number.isFinite);
  for (let start = 0; start < rows.length;) {
    if (stamps[start] !== undefined) { start++; continue; }
    let end = start;
    while (end < rows.length && stamps[end] === undefined) end++;
    const previous = start > 0 ? stamps[start - 1] : undefined;
    let next = stamps[end];
    // A newer live message may not yet exist in the supplementary Session page.
    // Keep an undated tail before that live message rather than after fetch time.
    if (next === undefined && previous !== undefined) {
      const newer = existingTimes.filter(time => time > previous);
      if (newer.length) next = Math.min(...newer);
    }
    if (previous !== undefined && next !== undefined && next > previous) {
      const step = (next - previous) / (end - start + 1);
      for (let i = start; i < end; i++) stamps[i] = previous + step * (i - start + 1);
    } else if (next !== undefined) {
      for (let i = start; i < end; i++) stamps[i] = next - (end - i);
    } else if (previous !== undefined) {
      for (let i = start; i < end; i++) stamps[i] = previous + (i - start + 1);
    } else {
      const ceiling = existingTimes.length ? Math.min(...existingTimes) : rows.length;
      for (let i = start; i < end; i++) stamps[i] = ceiling - (end - i);
    }
    start = end;
  }
  return rows.flatMap((row, index) => {
    const match = matched[index];
    if (!match) {
      if (sessionAssistantCoveredByNative(existing, rows, index, matched)) return [];
      return [{ ...row, createdAt: stamps[index]! }];
    }
    if (match.messageId === row.messageId && isImportedSessionMessage(row.messageId) && match.createdAt !== stamps[index]) {
      // Repair ordering only: an older API copy must not overwrite edited content.
      return [{ ...row, role: match.role, text: match.content, createdAt: stamps[index]! }];
    }
    return [];
  });
}

export type HistoryIdentity = {
  generation: number;
  origin: string;
  apiKey: string;
  profile: string;
  conversation: string;
};
export function canApplySessionHistory(
  request: HistoryIdentity,
  current: HistoryIdentity & { started: boolean; working: boolean; sending: boolean },
): boolean {
  return (
    current.started &&
    !current.working &&
    !current.sending &&
    request.generation === current.generation &&
    request.origin === current.origin &&
    request.apiKey === current.apiKey &&
    request.profile === current.profile &&
    request.conversation === current.conversation
  );
}
