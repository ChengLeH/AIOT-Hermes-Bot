import { postPushLookup, readPushId } from "./push";
import { hermesFetch } from "./hermes-fetch";

/** Each tab holds its own short lease for this browser's subscription. */
export function startPushPresence(origin: string, apiKey: string): () => void {
  if (!origin || !apiKey || !("serviceWorker" in navigator)) return () => {};
  const clientId = crypto.randomUUID();
  let stopped = false;
  let id = readPushId(origin);
  let chain = Promise.resolve();
  const report = (visible: boolean) => {
    chain = chain.then(async () => {
      if (!id) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const sub = await registration?.pushManager.getSubscription();
        if (sub) id = (await postPushLookup(origin, apiKey, sub.endpoint))?.id || "";
      }
      if (!id) return;
      const res = await hermesFetch(`${window.location.origin}/api/pwa/push/presence`, {
        method: "POST", apiKey, keepalive: true, timeoutMs: 5000,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, clientId, visible: visible && !stopped && document.visibilityState === "visible" }),
      });
      if (res.status === 404) id = "";
    }).catch(() => {}); // Expiration restores background delivery when disconnected.
  };
  const changed = () => report(document.visibilityState === "visible");
  const leaving = () => report(false);
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("pagehide", leaving);
  window.addEventListener("pageshow", changed);
  changed();
  const timer = window.setInterval(() => { if (document.visibilityState === "visible") changed(); }, 5000);
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("pagehide", leaving);
    window.removeEventListener("pageshow", changed);
    report(false);
  };
}
