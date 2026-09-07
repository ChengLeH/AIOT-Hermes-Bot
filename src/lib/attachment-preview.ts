import type { AttachmentDescriptor } from "./attachment-rules";

export type QueuedAttachment = {
  localId: string;
  name: string;
  mime: string;
  size: number;
  status: "uploading" | "ready" | "error";
  error?: string;
  attachment?: AttachmentDescriptor;
  previewUrl?: string;
};

const sessionImages = new Map<string, string>();
const fetchedImages = new Map<string, string>();
const revoked = new Set<string>();

export function isImageAttachment(input: { mime?: string; name?: string; type?: string }): boolean {
  const mime = (input.mime || input.type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(input.name ?? "");
}

export function formatFileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}

export function sanitizeAttachment(raw: Partial<AttachmentDescriptor> | null | undefined): AttachmentDescriptor | null {
  if (!raw || typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.name !== "string" || !raw.name) return null;
  return {
    id: raw.id,
    name: raw.name,
    mime: typeof raw.mime === "string" ? raw.mime : "",
    size: typeof raw.size === "number" && raw.size >= 0 ? raw.size : 0,
  };
}

export function persistableAttachment(item: QueuedAttachment | AttachmentDescriptor): AttachmentDescriptor | null {
  if ("localId" in item) return item.attachment ? sanitizeAttachment(item.attachment) : null;
  return sanitizeAttachment(item);
}

export function persistableRecord(value: unknown): string {
  return JSON.stringify(value);
}

export function containsUnsafePayload(value: unknown): boolean {
  const text = persistableRecord(value);
  return /blob:|data:image|base64,|file:\/\//i.test(text);
}

export function createPreviewUrl(file: Blob, meta: { name?: string; type?: string }): string | undefined {
  if (!isImageAttachment({ mime: meta.type || file.type, name: meta.name })) return undefined;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  return URL.createObjectURL(file);
}

export function revokeUrl(url: string | undefined): void {
  if (!url || revoked.has(url)) return;
  if (sessionImages.has(url) || [...sessionImages.values()].includes(url)) return;
  if ([...fetchedImages.values()].includes(url)) return;
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
  revoked.add(url);
}

export function revokeQueuedPreview(item: QueuedAttachment): void {
  if (!item.previewUrl) return;
  const kept = item.attachment?.id ? sessionImages.get(item.attachment.id) === item.previewUrl : false;
  if (kept) return;
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(item.previewUrl);
  }
}

export function rememberSessionImage(id: string, url: string): void {
  if (!id || !url) return;
  const prev = sessionImages.get(id);
  if (prev && prev !== url && typeof URL !== "undefined") URL.revokeObjectURL(prev);
  sessionImages.set(id, url);
}

export function sessionImageUrl(id: string): string | undefined {
  return sessionImages.get(id);
}

export function transferQueueToSession(items: QueuedAttachment[]): void {
  for (const item of items) {
    if (item.attachment?.id && item.previewUrl && isImageAttachment(item.attachment)) {
      rememberSessionImage(item.attachment.id, item.previewUrl);
    } else {
      revokeQueuedPreview(item);
    }
  }
}

export function rememberFetchedImage(id: string, url: string): void {
  if (!id || !url) return;
  const prev = fetchedImages.get(id);
  if (prev && prev !== url && typeof URL !== "undefined") URL.revokeObjectURL(prev);
  fetchedImages.set(id, url);
}

export function fetchedImageUrl(id: string): string | undefined {
  return fetchedImages.get(id) ?? sessionImages.get(id);
}

export function resetPreviewCaches(): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    for (const url of sessionImages.values()) URL.revokeObjectURL(url);
    for (const url of fetchedImages.values()) URL.revokeObjectURL(url);
  }
  sessionImages.clear();
  fetchedImages.clear();
  revoked.clear();
}

export function queueFromFile(file: { name: string; type: string; size: number }, localId: string, previewUrl?: string): QueuedAttachment {
  return {
    localId,
    name: file.name,
    mime: file.type,
    size: file.size,
    status: "uploading",
    previewUrl,
  };
}

export function attachmentDownloadUrl(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, "")}/api/bot/attachments/${encodeURIComponent(id)}`;
}

export function botMessageBody(input: {
  profile: string;
  conversation: string;
  text: string;
  attachmentIds?: string[];
}): { profile: string; conversation: string; text: string; attachment_ids?: string[] } {
  const payload: { profile: string; conversation: string; text: string; attachment_ids?: string[] } = {
    profile: input.profile,
    conversation: input.conversation,
    text: input.text,
  };
  const ids = input.attachmentIds?.filter(Boolean) ?? [];
  if (ids.length > 0) payload.attachment_ids = ids;
  return payload;
}

export function isNakedCredentialUrl(url: string): boolean {
  return /[?&](token|key|access_token|bearer)=/i.test(url) || /file:\/\//i.test(url);
}
