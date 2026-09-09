import type { Bot } from "./bots.ts";
import type { ChatMessage } from "./types.ts";

export type TaskCompletionInput = { botId: string; messageId: string; text: string };

export function collectUnseenCompletedTasks<T extends { id: string; turn?: string | number; status: string }>(tasks: T[], completed: Set<string>): T[] {
  return tasks.filter((task) => {
    if (task.status !== "completed" && task.status !== "done") return false;
    const key = `${task.id}:${task.turn ?? 0}`;
    if (completed.has(key)) return false;
    completed.add(key);
    return true;
  });
}

export function mergeTaskCompletionMessages(state: { bots: Bot[]; messages: ChatMessage[]; unreadBots: Record<string, boolean> }, input: TaskCompletionInput[]) {
  const known = new Set(state.messages.map((message) => message.messageId));
  const additions = input.flatMap((item) => {
    if (known.has(item.messageId)) return [];
    const bot = state.bots.find((candidate) => candidate.id === item.botId);
    if (!bot) return [];
    known.add(item.messageId);
    return [{ id: item.messageId, botId: bot.id, role: "assistant" as const, content: item.text, createdAt: Date.now(), messageId: item.messageId }];
  });
  if (!additions.length) return null;
  return {
    messages: [...state.messages, ...additions].sort((a, b) => a.createdAt - b.createdAt),
    unreadBots: additions.reduce((unread, message) => ({ ...unread, [message.botId]: true }), state.unreadBots),
  };
}
