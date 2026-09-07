import { hermesFetch } from "./hermes-fetch";
import { canRegisterServiceWorker } from "./api-helper";
import { vapidToBytes } from "./vapid";
import { pushSubscribePayload } from "./push-payload";

export { pushSubscribePayload } from "./push-payload";

export type PushStatus = {
  publicKey: string;
  sourceReady: boolean;
  subscriptions: number;
  failedDeliveries: number;
};

function count(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pushUrl(origin: string, path: string): string {
  // Notifications belong to this AIOT installation, not the Hermes server.
  const host = typeof window === "undefined" ? origin : window.location.origin;
  return `${host}/api/pwa/push/${path}`;
}

export async function getPushStatus(origin: string, apiKey: string): Promise<PushStatus> {
  const res = await hermesFetch(pushUrl(origin, "status"), { apiKey, timeoutMs: 12000 });
  if (!res.ok) throw new Error(`push status ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  return {
    publicKey: typeof json.publicKey === "string" ? json.publicKey : "",
    sourceReady: json.sourceReady === true,
    subscriptions: count(json.subscriptions),
    failedDeliveries: count(json.failedDeliveries),
  };
}

export async function postPushSubscribe(
  origin: string,
  apiKey: string,
  subscription: PushSubscriptionJSON,
): Promise<{ id: string; sourceReady: boolean }> {
  const res = await hermesFetch(pushUrl(origin, "subscribe"), {
    method: "POST",
    apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pushSubscribePayload(subscription)),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; sourceReady?: boolean };
  if (!res.ok || !json.id) throw new Error(`push subscribe ${res.status}`);
  return { id: json.id, sourceReady: json.sourceReady === true };
}

export async function postPushTest(origin: string, apiKey: string, id: string): Promise<void> {
  const res = await hermesFetch(pushUrl(origin, "test"), {
    method: "POST",
    apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`push test ${res.status}`);
}

export async function postPushUnsubscribe(origin: string, apiKey: string, id: string): Promise<void> {
  const res = await hermesFetch(pushUrl(origin, "unsubscribe"), {
    method: "POST",
    apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`push unsubscribe ${res.status}`);
}

export async function postPushLookup(
  origin: string,
  apiKey: string,
  endpoint: string,
): Promise<{ id: string } | null> {
  const res = await hermesFetch(pushUrl(origin, "lookup"), {
    method: "POST",
    apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return json.id ? { id: json.id } : null;
}

function sessionIdKey(origin: string): string {
  return `hermes.push.id:${origin}`;
}

export function readPushId(origin: string): string {
  if (!origin) return "";
  try {
    return sessionStorage.getItem(sessionIdKey(origin)) ?? "";
  } catch {
    return "";
  }
}

export function writePushId(origin: string, id: string): void {
  if (!origin) return;
  try {
    if (!id) sessionStorage.removeItem(sessionIdKey(origin));
    else sessionStorage.setItem(sessionIdKey(origin), id);
  } catch {
    /* private mode */
  }
}

export async function enableWebPush(origin: string, apiKey: string): Promise<{ id: string; sourceReady: boolean }> {
  if (!canRegisterServiceWorker()) {
    throw new Error("請在 AIOT 的 HTTPS 網址或已安裝的 PWA 開啟通知");
  }
  if (!("Notification" in window) || !("PushManager" in window)) throw new Error("此瀏覽器不支援推播通知");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("尚未允許通知");
  const status = await getPushStatus(origin, apiKey);
  if (!status.publicKey) throw new Error("AIOT 尚未提供通知金鑰");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidToBytes(status.publicKey) as BufferSource,
  });
  const result = await postPushSubscribe(origin, apiKey, sub.toJSON());
  writePushId(origin, result.id);
  return result;
}

export async function disableWebPush(origin: string, apiKey: string, id: string): Promise<void> {
  if (id) await postPushUnsubscribe(origin, apiKey, id);
  writePushId(origin, "");
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
}
