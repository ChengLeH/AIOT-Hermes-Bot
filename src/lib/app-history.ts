export type AppHistoryView = "roster" | "chat" | "settings";

const VIEW_KEY = "aiotView";
const OVERLAY_KEY = "aiotOverlay";

type AppHistoryState = Record<string, unknown> & {
  aiotView?: AppHistoryView;
  aiotOverlay?: "search";
};

function currentState(): AppHistoryState {
  return typeof window !== "undefined" && window.history.state && typeof window.history.state === "object"
    ? (window.history.state as AppHistoryState)
    : {};
}

export function seedAppHistory(view: AppHistoryView): void {
  if (typeof window === "undefined") return;
  const state = currentState();
  if (state[VIEW_KEY]) return;
  if (view === "chat") {
    window.history.replaceState({ ...state, [VIEW_KEY]: "roster" }, "");
    window.history.pushState({ ...state, [VIEW_KEY]: "chat" }, "");
    return;
  }
  window.history.replaceState({ ...state, [VIEW_KEY]: view }, "");
}

export function pushChatHistory(): void {
  if (typeof window === "undefined") return;
  const state = currentState();
  if (state[VIEW_KEY] === "chat" && !state[OVERLAY_KEY]) return;
  window.history.pushState({ ...state, [VIEW_KEY]: "chat", [OVERLAY_KEY]: undefined }, "");
}

export function pushSearchHistory(): void {
  if (typeof window === "undefined") return;
  const state = currentState();
  if (state[OVERLAY_KEY] === "search") return;
  window.history.pushState({ ...state, [VIEW_KEY]: "chat", [OVERLAY_KEY]: "search" }, "");
}

export function closeSearchHistory(): void {
  if (typeof window === "undefined") return;
  if (currentState()[OVERLAY_KEY] === "search") window.history.back();
}

export function backToRoster(fallback: () => void): void {
  if (typeof window === "undefined") {
    fallback();
    return;
  }
  const state = currentState();
  if (state[VIEW_KEY] === "chat") window.history.back();
  else fallback();
}

export function historyView(state: unknown): AppHistoryView | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as AppHistoryState)[VIEW_KEY];
  return value === "roster" || value === "chat" || value === "settings" ? value : null;
}

export function historySearchOpen(state: unknown): boolean {
  return Boolean(state && typeof state === "object" && (state as AppHistoryState)[OVERLAY_KEY] === "search");
}
