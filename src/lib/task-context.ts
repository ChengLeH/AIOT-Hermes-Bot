export type TaskContextMessage = { role: "user" | "assistant"; text: string };
type SourceMessage = { role: string; content: string; createdAt: number; pending?: boolean; streaming?: boolean; messageId?: string };
const encoder = new TextEncoder();

/** Only completed conversational text, bounded before it leaves the browser. */
export function recentTaskContext(messages: readonly SourceMessage[]): TaskContextMessage[] {
  const recent = messages.filter(message => ["user", "assistant"].includes(message.role) &&
    !message.pending && !message.streaming && message.content.trim() && !message.messageId?.startsWith("aiot-task:"))
    .slice().sort((a, b) => a.createdAt - b.createdAt).slice(-7);
  let remaining = 24_000;
  return recent.reverse().map(message => {
    const limit = Math.min(4000, remaining);
    if (limit < 3) return { role: message.role as TaskContextMessage["role"], text: "" };
    let text = "";
    let size = 0;
    for (const character of message.content.trim()) {
      const bytes = encoder.encode(character).length;
      if (size + bytes > limit - 3) { text += "…"; size += 3; break; }
      text += character; size += bytes;
    }
    remaining -= size;
    return { role: message.role as TaskContextMessage["role"], text };
  }).filter(message => message.text).reverse();
}
