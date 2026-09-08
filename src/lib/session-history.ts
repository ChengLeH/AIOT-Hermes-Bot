import type { ChatMessage } from "./types";
export type SessionMessage = {
  messageId: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
};
// Reuse one existing bubble per matching occurrence. A repeated "hello" is not
// globally deduplicated, and the live event identity remains stable.
export function missingSessionMessages(
  existing: ChatMessage[],
  rows: SessionMessage[],
): SessionMessage[] {
  const available = [...existing];
  return rows.filter((row) => {
    let index = available.findIndex((m) => m.messageId === row.messageId);
    if (index < 0)
      index = available.findIndex((m) => m.role === row.role && m.content === row.text);
    if (index < 0) return true;
    available.splice(index, 1);
    return false;
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
