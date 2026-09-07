import type { AttachmentDescriptor } from "./attachment-rules";
import { sanitizeAttachment } from "./attachment-preview.ts";
import type { ChatMessage } from "./types";

export type SafeMessage = {
  id: string;
  botId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  messageId?: string;
  pending?: boolean;
  attachments?: AttachmentDescriptor[];
};

export function mergeAttachmentMeta(
  prev: AttachmentDescriptor[] | undefined,
  next: AttachmentDescriptor[] | undefined,
): AttachmentDescriptor[] | undefined {
  if (!next || next.length === 0) return prev;
  const map = new Map<string, AttachmentDescriptor>();
  for (const item of prev ?? []) {
    const safe = sanitizeAttachment(item);
    if (safe) map.set(safe.id, safe);
  }
  for (const item of next) {
    const safe = sanitizeAttachment(item);
    if (safe) map.set(safe.id, safe);
  }
  return [...map.values()];
}

export function sanitizeMessage(message: ChatMessage): SafeMessage {
  const attachments = (message.attachments ?? [])
    .map((item) => sanitizeAttachment(item))
    .filter((item): item is AttachmentDescriptor => Boolean(item));
  return {
    id: message.id,
    botId: message.botId,
    role: message.role === "user" ? "user" : "assistant",
    content: typeof message.content === "string" ? message.content : "",
    createdAt: typeof message.createdAt === "number" ? message.createdAt : 0,
    messageId: message.messageId,
    pending: message.pending ? true : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

export function sanitizeStoredMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const safe = sanitizeMessage(row as ChatMessage);
    if (!safe.id || !safe.botId) continue;
    const key = safe.messageId ? `${safe.botId}:${safe.messageId}` : `id:${safe.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe);
  }
  return out;
}

export function messageDedupeKey(message: Pick<ChatMessage, "botId" | "id" | "messageId">): string {
  if (message.messageId) return `${message.botId}:${message.messageId}`;
  return `${message.botId}:id:${message.id}`;
}

export function upsertHistory(existing: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const next = sanitizeMessage(incoming);
  const key = messageDedupeKey(next);
  let found = false;
  const mapped = existing.map((item) => {
    if (messageDedupeKey(item) !== key) return item;
    found = true;
    return {
      ...item,
      content: next.content || item.content,
      pending: false,
      role: next.role,
      attachments: mergeAttachmentMeta(item.attachments, next.attachments),
      messageId: next.messageId ?? item.messageId,
    };
  });
  if (found) return mapped;
  return [...existing, { ...next, pending: false }];
}

export function replayIntoHistory(existing: ChatMessage[], replayed: ChatMessage[]): ChatMessage[] {
  let acc = existing.map(sanitizeMessage);
  for (const item of replayed) acc = upsertHistory(acc, item);
  return acc;
}

export function sameConversation(prev: string | null | undefined, next: string | null | undefined): boolean {
  return Boolean(prev && next && prev === next);
}
