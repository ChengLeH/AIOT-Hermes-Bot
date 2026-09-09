export type AppHistoryView = "roster" | "chat" | "settings";

const VIEW_KEY = "aiotView";
const OVERLAY_KEY = "aiotOverlay";

type AppHistoryState = Record<string, unknown> & {
  aiotView?: AppHistoryView;
  aiotOverlay?: "search";
};

export type TaskWorkspaceHistoryState = Record<string, unknown> & {
  aiotView?: AppHistoryView;
  aiotTaskWorkspace?: string;
  aiotTaskPanel?: string;
  aiotTaskId?: string;
  aiotTaskReturn?: string | null;
  aiotTaskSearch?: boolean;
};

function currentState(): AppHistoryState {
  return typeof window !== "undefined" && window.history.state && typeof window.history.state === "object"
    ? (window.history.state as AppHistoryState)
    : {};
}

const TRANSIENT_KEYS = [
  OVERLAY_KEY,
  "aiotApprovalDock",
  "aiotScheduleDock",
  "aiotTaskWorkspace",
  "aiotTaskPanel",
  "aiotTaskId",
  "aiotTaskReturn",
  "aiotTaskSearch",
] as const;

function withoutTransientEntries(state: AppHistoryState): AppHistoryState {
  const next = { ...state };
  for (const key of TRANSIENT_KEYS) delete next[key];
  return next;
}

// Android WebAPK can skip a same-URL state-only entry when handling system Back.
// Use a non-sensitive fragment to distinguish the contact list from its chat page.
function viewUrl(view: AppHistoryView): string | undefined {
  if (typeof window === "undefined" || !window.location) return undefined;
  return `${window.location.pathname}${window.location.search}${view === "chat" ? "#aiot-chat" : ""}`;
}

export function seedAppHistory(view: AppHistoryView): void {
  if (typeof window === "undefined") return;
  const state = currentState();
  if (view === "roster") {
    window.history.replaceState({ ...withoutTransientEntries(state), [VIEW_KEY]: view }, "", viewUrl(view));
    return;
  }
  if (state[VIEW_KEY] === view) return;
  if (view === "chat") {
    window.history.replaceState({ ...state, [VIEW_KEY]: "roster" }, "", viewUrl("roster"));
    window.history.pushState({ ...state, [VIEW_KEY]: "chat" }, "", viewUrl("chat"));
    return;
  }
  window.history.replaceState({ ...state, [VIEW_KEY]: view }, "");
}

export function pushChatHistory(): void {
  if (typeof window === "undefined") return;
  const current = currentState();
  const hasTransientEntry = TRANSIENT_KEYS.some((key) => current[key] !== undefined);
  const state = withoutTransientEntries(current);
  if (state[VIEW_KEY] === "chat" && !hasTransientEntry) return;
  // A Bot conversation always belongs to the roster, even after opening settings.
  window.history.replaceState({ ...state, [VIEW_KEY]: "roster" }, "", viewUrl("roster"));
  window.history.pushState({ ...state, [VIEW_KEY]: "chat" }, "", viewUrl("chat"));
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

function stableMarkerHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(36)}${second.toString(36)}`;
}

export function taskWorkspaceMarker(botId: string, profile: string, conversation?: string | null): string {
  return `tasks-v1-${stableMarkerHash(JSON.stringify([botId, profile, conversation ?? ""]))}`;
}

export function reconcileTaskWorkspaceHistory(state: unknown, marker: string): TaskWorkspaceHistoryState {
  if (!state || typeof state !== "object") return {};
  const current = state as TaskWorkspaceHistoryState;
  if (current.aiotView !== "chat" || typeof current.aiotTaskWorkspace !== "string" || current.aiotTaskWorkspace === marker) return current;
  const next = { ...current };
  delete next.aiotTaskWorkspace;
  delete next.aiotTaskPanel;
  delete next.aiotTaskId;
  delete next.aiotTaskReturn;
  delete next.aiotTaskSearch;
  return next;
}

export function overlayHistoryAction(
  state: unknown,
  markerKey: string,
  markerValue: string,
  open: boolean,
): "keep" | "close" | "skip" {
  const ownsEntry = Boolean(
    state && typeof state === "object" && (state as Record<string, unknown>)[markerKey] === markerValue,
  );
  if (ownsEntry) return open ? "keep" : "skip";
  return open ? "close" : "keep";
}
