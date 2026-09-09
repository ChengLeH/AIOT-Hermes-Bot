/* aiot PWA — push only. Do not cache API or credentials. */
function isApprovalPush(data) {
  const kind = String(data.kind || data.type || data.event || "").toLowerCase();
  if (kind.includes("approval")) return true;
  if (typeof data.request_id === "string" && data.request_id.trim()) return true;
  if (typeof data.command === "string" && data.command && Array.isArray(data.choices)) return true;
  return false;
}

function safePreview(value) {
  if (typeof value !== "string") return "";
  return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "").replace(/^\s*(?:tool|function|@(?:file|image):).*$/gim, " ").replace(/[\r\n]+/g, " ")
    .replace(/(?:file:\/\/|https?:\/\/|~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/])[^\s<>(){}[\]]+/gi, "")
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|secret|password|passwd|authorization)\b(?:\s*[:=]\s*|\s+)\S+/gi, "")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, "")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "")
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer|secret|password|passwd|authorization)\b/gi, "")
    .replace(/\s+/g, " ").trim().slice(0, 120);
}

function notificationBody(data, approval, hasTask) {
  const zh = data.locale === "zh-Hant"; const mode = data.taskMode === "independent" || data.taskMode === "fork" ? data.taskMode : "";
  const base = approval
    ? mode === "fork" ? (zh ? "分支任務需要你批准" : "Forked task needs approval") : mode === "independent" ? (zh ? "獨立任務需要你批准" : "Independent task needs approval") : (zh ? "需要你批准" : "Approval requested")
    : mode === "fork" ? (zh ? "分支任務已完成" : "Forked task complete") : hasTask ? (zh ? "獨立任務已完成" : "Independent task complete") : (zh ? "有新的回覆" : "New reply");
  const preview = approval ? "" : safePreview(data.preview);
  return preview ? `${base}：${preview}` : base;
}

function sanitizeVisiblePush(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
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

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function deliverPush(data) {
  // Inspect live window visibility at delivery time; focus alone is insufficient
  // on Android and includes background tabs on some desktop browsers.
  let windows = [];
  try {
    windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  } catch {
    // If visibility cannot be determined, retain the background notification.
  }
  const visible = windows.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin && client.visibilityState === "visible";
    } catch {
      return false;
    }
  });
  // The authenticated manual test must reach the OS even from the settings page.
  // Ordinary replies and approvals remain silent while AIOT is visible.
  if (visible.length && data.tag !== "aiot:test") {
    for (const client of visible) {
      try {
        client.postMessage({ type: "foreground-push", profile: data.profile, sessionId: data.sessionId });
      } catch {
        // A closing window must not reject the push handler.
      }
    }
    return;
  }
  await self.registration.showNotification(data.title || "aiot", {
    body: data.body || "",
    tag: data.tag || undefined,
    data: { profile: data.profile || "", sessionId: data.sessionId || "", ...(data.taskId ? { taskId: data.taskId } : {}) },
  });
}

self.addEventListener("push", (event) => {
  let raw = {};
  try {
    if (event.data) raw = event.data.json();
  } catch {
    try {
      if (event.data) raw = { body: event.data.text() };
    } catch {
      /* ignore */
    }
  }
  const data = sanitizeVisiblePush(raw);
  event.waitUntil(deliverPush(data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = new URL("/", self.location.origin);
  if (d.profile) url.searchParams.set("profile", String(d.profile));
  if (d.sessionId) url.searchParams.set("session", String(d.sessionId));
  if (typeof d.taskId === "string" && /^[a-f0-9-]{36}$/i.test(d.taskId)) url.searchParams.set("task", d.taskId);
  const target = url.toString();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();
          client.postMessage({
            type: "open-session",
            profile: d.profile || "",
            sessionId: d.sessionId || "",
            taskId: d.taskId || "",
          });
          return;
        }
      }
      await self.clients.openWindow(target);
    }),
  );
});
