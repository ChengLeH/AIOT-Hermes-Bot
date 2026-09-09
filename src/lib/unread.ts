/** A reply is read only in its visible conversation, never merely because a tab exists. */
export function isReadingBot(botId: string, activeBotId: string | null, view: string, visible: boolean): boolean {
  return visible && view === "chat" && activeBotId === botId;
}

/** Session task results belong to the parent Bot but are read in another panel. */
export function shouldShowUnread(botId: string, activeBotId: string | null, view: string, visible: boolean, force = false): boolean {
  return force || !isReadingBot(botId, activeBotId, view, visible);
}

export function assistantSnapshot(messages: { botId: string; role: string; messageId?: string; id: string; content: string; attachments?: { id: string }[] }[]): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant") snapshot.set(message.botId, JSON.stringify([message.messageId || message.id, message.content, message.attachments?.map((a) => a.id)]));
  }
  return snapshot;
}
