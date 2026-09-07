export type SendKeyEvent = {
  key: string;
  shiftKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

export function isComposingKey(e: SendKeyEvent, composing: boolean): boolean {
  if (composing) return true;
  if (e.isComposing) return true;
  if (e.nativeEvent?.isComposing) return true;
  if (e.keyCode === 229 || e.nativeEvent?.keyCode === 229) return true;
  return false;
}

export function shouldSendOnEnter(e: SendKeyEvent, composing: boolean, menuOpen = false): boolean {
  if (menuOpen) return false;
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false;
  if (e.repeat) return false;
  if (isComposingKey(e, composing)) return false;
  return true;
}

export function completionMenuAction(
  e: SendKeyEvent,
  composing: boolean,
  menuOpen: boolean,
): "next" | "prev" | "select" | "close" | null {
  if (!menuOpen) return null;
  if (isComposingKey(e, composing)) return null;
  if (e.key === "ArrowDown") return "next";
  if (e.key === "ArrowUp") return "prev";
  if (e.key === "Escape") return "close";
  if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.repeat) return "select";
  return null;
}

const locks = new Set<string>();

export function trySendLock(id: string): boolean {
  if (locks.has(id)) return false;
  locks.add(id);
  return true;
}

export function releaseSendLock(id: string): void {
  locks.delete(id);
}

export function resetSendLocks(): void {
  locks.clear();
}

export function isTurnBusy(state: "idle" | "working" | "waiting" | undefined, sending: boolean): boolean {
  if (sending) return true;
  return state === "working" || state === "waiting";
}
