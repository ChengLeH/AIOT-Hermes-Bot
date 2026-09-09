export const HERMES_FETCH = {
  credentials: "omit",
  mode: "cors",
  redirect: "error",
  cache: "no-store",
} as const satisfies RequestInit;

export const CONNECTION_PROBE_TIMEOUT_MS = 6_000;

export type HermesFetchInit = RequestInit & {
  apiKey?: string;
  timeoutMs?: number;
};

export function withBearer(apiKey: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const key = apiKey.trim();
  if (key) headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export function hermesRequestUrl(value: string): string {
  if (typeof window === "undefined") return value;
  const target = new URL(value);
  if (target.origin === window.location.origin) return value;
  return `/__aiot/hermes?origin=${encodeURIComponent(target.origin)}&path=${encodeURIComponent(`${target.pathname}${target.search}`)}`;
}

export async function hermesFetch(url: string, init: HermesFetchInit = {}): Promise<Response> {
  const { apiKey = "", headers: extra, timeoutMs, signal, ...rest } = init;
  const headers = withBearer(apiKey, extra);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (rest.body instanceof FormData) headers.delete("Content-Type");

  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let usedSignal = signal;
  let onAbort: (() => void) | undefined;
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    controller = new AbortController();
    timer = setTimeout(() => controller!.abort(), timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else {
        onAbort = () => controller!.abort();
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    usedSignal = controller.signal;
  }

  try {
    return await fetch(hermesRequestUrl(url), {
      ...rest,
      signal: usedSignal,
      headers,
      credentials: "omit",
      mode: "cors",
      redirect: "error",
      cache: "no-store",
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function bearerFromRequest(request: Request): string {
  const raw = request.headers.get("authorization") ?? "";
  return raw.replace(/^Bearer\s+/i, "").trim();
}
