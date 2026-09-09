export type PushSubscribeBody = {
  subscription: PushSubscriptionJSON;
  preview: false;
};

export function pushSubscribePayload(subscription: PushSubscriptionJSON): PushSubscribeBody {
  return { subscription, preview: false };
}

export type VisiblePush = {
  taskId?: string;
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

function safePreview(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "").replace(/^\s*(?:tool|function|@(?:file|image):).*$/gim, " ").replace(/[\r\n]+/g, " ")
    .replace(/(?:file:\/\/|https?:\/\/|~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/])[^\s<>(){}[\]]+/gi, "")
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|secret|password|passwd|authorization)\b(?:\s*[:=]\s*|\s+)\S+/gi, "")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, "")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "")
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|secret|password|passwd|authorization)\b/gi, "")
    .replace(/\s+/g, " ").trim().slice(0, 120);
}

function taskMode(data: Record<string, unknown>): "independent" | "fork" | "" {
  return data.taskMode === "independent" || data.taskMode === "fork" ? data.taskMode : "";
}

function notificationBody(data: Record<string, unknown>, approval: boolean, hasTask: boolean): string {
  const zh = data.locale === "zh-Hant"; const mode = taskMode(data);
  const base = approval
    ? mode === "fork" ? (zh ? "分支任務需要你批准" : "Forked task needs approval") : mode === "independent" ? (zh ? "獨立任務需要你批准" : "Independent task needs approval") : (zh ? "需要你批准" : "Approval requested")
    : mode === "fork" ? (zh ? "分支任務已完成" : "Forked task complete") : hasTask ? (zh ? "獨立任務已完成" : "Independent task complete") : (zh ? "有新的回覆" : "New reply");
  const preview = approval ? "" : safePreview(data.preview);
  return preview ? `${base}：${preview}` : base;
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
  const task = typeof data.taskId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.taskId) ? { taskId: data.taskId } : {};
  if (isApprovalPush(data)) {
    return {
      title: "aiot",
      body: notificationBody(data, true, Boolean(task.taskId)),
      tag: typeof data.tag === "string" && data.tag ? data.tag : profile ? `approval:${profile}:${sessionId}` : "approval",
      profile,
      sessionId,
      ...task,
    };
  }
  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title : "aiot",
    body: data.kind === "complete" ? notificationBody(data, false, Boolean(task.taskId)) : typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : "",
    profile,
    sessionId,
    ...task,
  };
}
