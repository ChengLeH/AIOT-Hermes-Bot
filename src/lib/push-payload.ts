export type PushSubscribeBody = {
  subscription: PushSubscriptionJSON;
  preview: false;
};

export function pushSubscribePayload(subscription: PushSubscriptionJSON): PushSubscribeBody {
  return { subscription, preview: false };
}

export type VisiblePush = {
  title: string;
  body: string;
  tag: string;
  profile: string;
  sessionId: string;
};

export function isApprovalPush(data: Record<string, unknown>): boolean {
  const kind = String(data.kind ?? data.type ?? data.event ?? "").toLowerCase();
  if (kind.includes("approval")) return true;
  if (typeof data.request_id === "string" && data.request_id.trim()) return true;
  if (typeof data.command === "string" && data.command && Array.isArray(data.choices)) return true;
  return false;
}

export function sanitizeVisiblePush(raw: unknown): VisiblePush {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profile = typeof data.profile === "string" ? data.profile : "";
  const sessionId =
    typeof data.sessionId === "string"
      ? data.sessionId
      : typeof data.conversation === "string"
        ? data.conversation
        : typeof data.session === "string"
          ? data.session
          : "";
  if (isApprovalPush(data)) {
    return {
      title: "aiot",
      body: "",
      tag: typeof data.tag === "string" && data.tag ? data.tag : profile ? `approval:${profile}:${sessionId}` : "approval",
      profile,
      sessionId,
    };
  }
  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title : "aiot",
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : "",
    profile,
    sessionId,
  };
}
