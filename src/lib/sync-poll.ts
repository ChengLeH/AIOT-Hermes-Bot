export const EVENT_POLL_MS = 2000;
export const HISTORY_SYNC_MS = 60_000;
export const NATIVE_QUEUE_POLL_MS = 5_000;

export function eventPollDelayMs(
  visibilityState: string | undefined,
  replayingFast: boolean,
): number | "wait-visible" {
  if (replayingFast) return 0;
  if (visibilityState === "hidden") return "wait-visible";
  return EVENT_POLL_MS;
}

export function shouldPollNativeQueue(sending: boolean, queuedCount: number): boolean {
  return sending || queuedCount > 0;
}
