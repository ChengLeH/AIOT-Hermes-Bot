export function canRegisterServiceWorker(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (window.location.protocol !== "https:") return false;
  if (window !== window.top) return false;
  return true;
}

export async function registerHermesServiceWorker(): Promise<void> {
  if (!canRegisterServiceWorker()) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    /* ignore */
  }
}
