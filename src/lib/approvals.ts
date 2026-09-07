export const APPROVAL_CHOICES = ["once", "session", "always", "deny"] as const;
export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];
export type ApprovalStatus = "pending" | "submitting" | "approved" | "rejected" | "expired" | "error";

export type ApprovalCard = {
  requestId: string;
  profile: string;
  conversation: string;
  command: string;
  description: string;
  choices: ApprovalChoice[];
  createdAt: number;
  status: ApprovalStatus;
  lastChoice?: ApprovalChoice;
  confirmAlways?: boolean;
  errorKind?: "conflict" | "generic";
};

const SECRET_RE =
  /(session[_-]?key|api[_-]?key|password|authorization|bearer)\s*[:=]\s*\S+/gi;
const BEARER_RE = /Bearer\s+\S+/gi;
const FILE_RE = /(?:file:\/\/|(?:\/(?:Users|home)\/))[^\s]+/gi;
const QUERY_SECRET_RE = /https?:\/\/[^\s]*[?&](?:key|token|password|session_key)=[^\s]+/gi;

export function isApprovalChoice(value: unknown): value is ApprovalChoice {
  return value === "once" || value === "session" || value === "always" || value === "deny";
}

export function stripApprovalSecrets(text: string): string {
  return text
    .replace(SECRET_RE, "")
    .replace(BEARER_RE, "")
    .replace(FILE_RE, "")
    .replace(QUERY_SECRET_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseApprovalChoices(raw: unknown): ApprovalChoice[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ApprovalChoice[] = [];
  for (const row of rows) {
    const value = typeof row === "string" ? row : row && typeof row === "object" ? String((row as { id?: unknown }).id ?? (row as { choice?: unknown }).choice ?? "") : "";
    if (isApprovalChoice(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

export function parseApprovalCard(input: {
  profile?: string;
  conversation?: string;
  payload?: Record<string, unknown>;
}): ApprovalCard | null {
  const payload = input.payload ?? {};
  const requestId = typeof payload.request_id === "string" ? payload.request_id.trim() : "";
  const profile = (input.profile ?? "").trim();
  const conversation = (input.conversation ?? "").trim();
  if (!requestId || !profile || !conversation) return null;
  const createdRaw = payload.created_at;
  const createdAt =
    typeof createdRaw === "number"
      ? createdRaw
      : typeof createdRaw === "string" && Date.parse(createdRaw)
        ? Date.parse(createdRaw)
        : Date.now();
  return {
    requestId,
    profile,
    conversation,
    command: stripApprovalSecrets(typeof payload.command === "string" ? payload.command : ""),
    description: stripApprovalSecrets(typeof payload.description === "string" ? payload.description : ""),
    choices: parseApprovalChoices(payload.choices),
    createdAt,
    status: "pending",
  };
}

export function approvalBody(input: {
  profile: string;
  conversation: string;
  choice: ApprovalChoice;
}): { profile: string; conversation: string; choice: ApprovalChoice } {
  return { profile: input.profile, conversation: input.conversation, choice: input.choice };
}

export function statusAfterApprovalHttp(status: number, choice: ApprovalChoice): ApprovalStatus {
  if (status === 409) return "error";
  if (status >= 200 && status < 300) return choice === "deny" ? "rejected" : "approved";
  return "error";
}

export function mergeApprovalStatus(current: ApprovalStatus | undefined, incoming: ApprovalStatus): ApprovalStatus {
  if (!current) return incoming;
  if (incoming === "approved" || incoming === "rejected") return incoming;
  if (incoming === "expired" && current !== "approved" && current !== "rejected") return "expired";
  if (current === "approved" || current === "rejected" || current === "expired") return current;
  if (current === "submitting" && incoming === "pending") return "submitting";
  return incoming;
}

export function applyApprovalEvent(
  kind: string,
  card: ApprovalCard | null,
  prev: ApprovalCard | undefined,
): ApprovalCard | null {
  if (!card && !prev) return null;
  const base: ApprovalCard = {
    ...(prev ?? card!),
    ...(card ?? {}),
    requestId: card?.requestId || prev?.requestId || "",
    profile: card?.profile || prev?.profile || "",
    conversation: card?.conversation || prev?.conversation || "",
    command: card?.command || prev?.command || "",
    description: card?.description || prev?.description || "",
    choices: card?.choices?.length ? card.choices : prev?.choices ?? [],
  };
  if (kind === "approval_expired") return { ...base, status: "expired", confirmAlways: false };
  if (kind === "approval_resolved") {
    const choice = card?.lastChoice ?? prev?.lastChoice;
    return {
      ...base,
      status: choice === "deny" ? "rejected" : "approved",
      lastChoice: choice,
      confirmAlways: false,
    };
  }
  if (kind === "approval_request") {
    if (prev && (prev.status === "approved" || prev.status === "rejected" || prev.status === "expired")) {
      return prev;
    }
    return { ...base, status: prev?.status === "submitting" ? "submitting" : "pending" };
  }
  return base;
}

export function mergeApproval(list: ApprovalCard[], next: ApprovalCard): ApprovalCard[] {
  const safe = sanitizeApproval(next);
  const idx = list.findIndex((item) => item.requestId === safe.requestId);
  if (idx < 0) return [...list, safe].slice(-100);
  const current = list[idx]!;
  const copy = list.slice();
  copy[idx] = {
    ...current,
    ...safe,
    command: safe.command || current.command,
    description: safe.description || current.description,
    choices: safe.choices.length > 0 ? safe.choices : current.choices,
    status: mergeApprovalStatus(current.status, safe.status),
    lastChoice: safe.lastChoice ?? current.lastChoice,
    confirmAlways: next.confirmAlways ?? current.confirmAlways,
    errorKind: mergeApprovalStatus(current.status, safe.status) === "error" ? (next.errorKind ?? current.errorKind) : undefined,
  };
  return copy;
}

export function sanitizeApproval(card: ApprovalCard): ApprovalCard {
  return {
    requestId: card.requestId,
    profile: card.profile,
    conversation: card.conversation,
    command: stripApprovalSecrets(card.command),
    description: stripApprovalSecrets(card.description),
    choices: card.choices.filter(isApprovalChoice),
    createdAt: card.createdAt,
    status: card.status,
    lastChoice: card.lastChoice,
    errorKind: card.errorKind,
  };
}

export function sanitizeStoredApprovals(raw: unknown): ApprovalCard[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalCard[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = sanitizeApproval(row as ApprovalCard);
    if (!item.requestId || seen.has(item.requestId)) continue;
    seen.add(item.requestId);
    out.push(item);
  }
  return out;
}

export function genericApprovalNotice(): { title: string; body: string } {
  return { title: "aiot", body: "" };
}

export function approvalDeepLink(origin: string, profile: string, conversation: string): string {
  const url = new URL("/", origin);
  if (profile) url.searchParams.set("profile", profile);
  if (conversation) url.searchParams.set("session", conversation);
  return url.pathname + url.search;
}

export function resolvedChoiceFromPayload(payload: Record<string, unknown> | undefined): ApprovalChoice | undefined {
  const value = payload?.choice ?? payload?.outcome;
  return isApprovalChoice(value) ? value : undefined;
}
