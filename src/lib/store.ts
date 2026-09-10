import { isImportedSessionMessage } from "./session-history";
import { resetPreviewCaches } from "./attachment-preview";
import { shouldShowUnread } from "./unread";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { encryptedBrowserStorage } from "./encrypted-storage";
import { botFromProfile, botDisplayName, type Bot } from "./bots";
import { eyeSwatchesForProfiles } from "./brand";
import type { NativeBotCapabilities, NativeBotProfile } from "./bot-catalog";
import type { ActivityLine, ChatMessage, Connection, HermesProbe } from "./types";
import type { AttachmentDescriptor } from "./attachment-rules";
import { uid } from "./utils";
import { boundPasswordOrigin, writePassword, clearPassword, credentialStorageUnavailable } from "./secrets";
import { MISSING_BOT_NOTICE, shouldClearMessagesForOrigin, type RestoreResult } from "./session";
import { applyMissingCredential, MISSING_KEY_NOTICE, persistConnectionSlice } from "./credential-gate";
import type { Locale } from "./locale";
import { mergeApproval, sanitizeApproval, type ApprovalCard } from "./approvals";
import { sanitizeMessage, mergeAttachmentMeta } from "./history";
import { sanitizeAttachment } from "./attachment-preview";
import { mergeTaskCompletionMessages, type TaskCompletionInput } from "./task-completion";
import { liveBotMessages, settleOrphanPending } from "./bot-window";

export type DeskView = "roster" | "chat" | "settings";

type EventMessageInput = {
  profile: string;
  conversation: string;
  messageId: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
  historical?: boolean;
  keepRole?: boolean;
  streaming?: boolean;
  attachments?: AttachmentDescriptor[];
};

function mergeEventMessage(messages: ChatMessage[], botId: string, { messageId, role, text, createdAt, historical, keepRole, streaming, attachments }: EventMessageInput): ChatMessage[] {
  const existing = messages.find((message) => message.botId === botId && message.messageId === messageId);
  if (existing) return messages.map((message) =>
    message.id === existing.id && message.botId === botId
      ? { ...message, content: text,
        ...((historical || isImportedSessionMessage(messageId)) && typeof createdAt === "number" && Number.isFinite(createdAt) ? { createdAt } : {}),
        streaming, pending: false, role: keepRole ? message.role : role, attachments: mergeAttachmentMeta(message.attachments, attachments) }
      : message,
  );
  const pending = role === "user" ? messages.find((message) => message.botId === botId && message.pending && message.content === text) : undefined;
  if (pending) return messages.map((message) => message.id === pending.id
    ? { ...message, messageId, content: text, pending: false, attachments: mergeAttachmentMeta(message.attachments, attachments) }
    : message);
  return [...messages, { id: messageId, botId, role, content: text, streaming,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now(), messageId,
    attachments: mergeAttachmentMeta(undefined, attachments) }];
}
