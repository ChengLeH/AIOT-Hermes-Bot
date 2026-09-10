export const BOT_LIVE_WINDOW = 7;

export function liveBotMessages<T extends { botId: string; createdAt: number }>(
  messages: readonly T[],
  windowSize = BOT_LIVE_WINDOW,
): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const message of messages) {
    const list = groups.get(message.botId);
    if (list) list.push(message);
    else {
      groups.set(message.botId, [message]);
      order.push(message.botId);
    }
  }
  const out: T[] = [];
  for (const botId of order) {
    const list = groups.get(botId)!;
    list.sort((a, b) => a.createdAt - b.createdAt);
    out.push(...list.slice(-windowSize));
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function settleOrphanPending<T extends { pending?: boolean }>(messages: readonly T[]): T[] {
  return messages.map((message) => (message.pending ? { ...message, pending: false } : message));
}

export function latestHistoryWindow<T>(rows: readonly T[], windowSize = BOT_LIVE_WINDOW): T[] {
  return rows.length <= windowSize ? [...rows] : rows.slice(-windowSize);
}

export function olderHistoryPage<T extends { createdAt?: number }>(
  loaded: readonly { createdAt: number }[],
  archive: readonly T[],
  pageSize = BOT_LIVE_WINDOW,
): T[] {
  if (!loaded.length) return [];
  const oldest = loaded.reduce((min, message) => Math.min(min, message.createdAt), Number.POSITIVE_INFINITY);
  const older = archive
    .filter((row) => typeof row.createdAt === "number" && Number.isFinite(row.createdAt) && row.createdAt < oldest)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return older.slice(-pageSize);
}
