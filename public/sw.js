/* aiot PWA — push only. Do not cache API or credentials. */
function isApprovalPush(data) {
  const kind = String(data.kind || data.type || data.event || "").toLowerCase();
  if (kind.includes("approval")) return true;
  if (typeof data.request_id === "string" && data.request_id.trim()) return true;
  if (typeof data.command === "string" && data.command && Array.isArray(data.choices)) return true;
  return false;
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
  if (isApprovalPush(data)) {
    return {
      title: "aiot",
      body: "Approval requested",
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
  if (visible.length) {
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
    data: { profile: data.profile || "", sessionId: data.sessionId || "" },
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
          });
          return;
        }
      }
      await self.clients.openWindow(target);
    }),
  );
});
