import type { NativeBotCapabilities } from "./bot-catalog";

export type AttachmentDescriptor = {
  id: string;
  name: string;
  mime: string;
  size: number;
};

export const MAX_ATTACHMENTS = 5;
export const DEFAULT_MAX_BYTES = 10_485_760;

export function canUploadAttachments(caps: NativeBotCapabilities | undefined): boolean {
  return Boolean(caps?.attachments && caps.attachment_uploads);
}

export function canDownloadAttachments(caps: NativeBotCapabilities | undefined): boolean {
  return Boolean(caps?.attachments && caps.attachment_downloads);
}

export function maxAttachmentBytes(caps: NativeBotCapabilities | undefined): number {
  const n = caps?.max_attachment_bytes;
  if (typeof n === "number" && n > 0) return n;
  return DEFAULT_MAX_BYTES;
}

export function fileKindError(file: { name: string; type: string }): string | null {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "error.audioVideo";
  const ok =
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    /\.(png|jpe?g|gif|webp|heic|heif|pdf|txt|md|doc|docx|xlsx)$/i.test(file.name);
  if (!ok) return "error.fileKind";
  return null;
}

export function parseAttachmentList(raw: unknown): AttachmentDescriptor[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentDescriptor[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const name = typeof r.name === "string" ? r.name : "";
    if (!id || !name) continue;
    out.push({
      id,
      name,
      mime: typeof r.mime === "string" ? r.mime : "",
      size: typeof r.size === "number" ? r.size : 0,
    });
  }
  return out;
}
