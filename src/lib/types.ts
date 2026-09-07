import type { NativeBotCapabilities, NativeBotProfile } from "./bot-catalog";
import type { AttachmentDescriptor } from "./attachment-rules";

export type ChatRole = "user" | "assistant";

export type ActivityLine = {
  id: string;
  label: string;
  at: number;
  kind: "think" | "tool" | "done" | "wait";
};

export type ChatMessage = {
  id: string;
  botId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  messageId?: string;
  pending?: boolean;
  attachments?: AttachmentDescriptor[];
};

export type HermesProbe = {
  ok: boolean;
  at: number;
  transport: "native-bot";
  profiles: NativeBotProfile[];
  capabilities: NativeBotCapabilities;
  error?: string;
};

export type Connection = {
  origin: string;
  apiKey: string;
  lastProbe: HermesProbe | null;
};
