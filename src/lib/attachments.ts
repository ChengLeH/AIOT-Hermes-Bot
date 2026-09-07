import { hermesFetch } from "./hermes-fetch";
import type { AttachmentDescriptor } from "./attachment-rules";
import { getBotAttachment } from "./native-bot";

export type { AttachmentDescriptor } from "./attachment-rules";
export {
  canUploadAttachments,
  canDownloadAttachments,
  fileKindError,
  maxAttachmentBytes,
  parseAttachmentList,
  MAX_ATTACHMENTS,
  DEFAULT_MAX_BYTES,
} from "./attachment-rules";

export async function postBotUpload(input: {
  origin: string;
  apiKey: string;
  file: File;
  profile: string;
  conversation: string;
}): Promise<AttachmentDescriptor> {
  const body = new FormData();
  body.append("file", input.file);
  body.append("profile", input.profile);
  body.append("conversation", input.conversation);
  const res = await hermesFetch(`${input.origin}/api/bot/uploads`, {
    method: "POST",
    apiKey: input.apiKey,
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    attachment?: Partial<AttachmentDescriptor>;
    error?: string;
  };
  const att = json.attachment;
  if (!res.ok || !att?.id || !att.name) {
    throw new Error("上傳失敗");
  }
  return {
    id: att.id,
    name: att.name,
    mime: att.mime || input.file.type,
    size: typeof att.size === "number" ? att.size : input.file.size,
  };
}

export { getBotAttachment };
