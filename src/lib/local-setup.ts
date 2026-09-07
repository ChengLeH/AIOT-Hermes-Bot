export type SetupBootstrap = { origin: string; apiKey: string };

export function isLocalSetupPage(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}

export async function finishLocalSetup(origin: string, apiKey: string): Promise<boolean> {
  if (!isLocalSetupPage()) return false;
  const res = await fetch("/__aiot/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, apiKey }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || `setup ${res.status}`);
  window.location.assign(body.url);
  return true;
}

export async function consumeSetupBootstrap(): Promise<SetupBootstrap | null> {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("aiot_setup")?.trim() || "";
  if (!token) return null;
  try {
    const res = await fetch(`/__aiot/setup?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<SetupBootstrap>;
    if (!body.origin || !body.apiKey) return null;
    return { origin: body.origin, apiKey: body.apiKey };
  } finally {
    params.delete("aiot_setup");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }
}
