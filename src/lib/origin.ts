import type { Locale } from "./locale.ts";
import { isMessageKey, t } from "./locale.ts";

const PWA_SECRET_QUERY_KEYS = [
  "url",
  "origin",
  "host",
  "key",
  "apiKey",
  "api_key",
  "password",
  "token",
  "port",
  "profile",
  "session",
  "conversation",
] as const;

export function normalizeHttpsOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("error.originRequired");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:") {
    throw new Error("error.httpsRequired");
  }
  url.username = "";
  url.password = "";
  return url.origin;
}

export function connectionFromPwaSearch(_search: string): { origin: ""; apiKey: "" } {
  return { origin: "", apiKey: "" };
}

export function deepLinkFromPwaSearch(search: string): { profile: string | null; session: string | null } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const profile = params.get("profile")?.trim() || null;
  const session = params.get("session")?.trim() || null;
  return { profile, session };
}

export function sanitizedPwaSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of PWA_SECRET_QUERY_KEYS) params.delete(key);
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function stripPwaLocationSecrets(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${sanitizedPwaSearch(window.location.search)}${window.location.hash}`;
  const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === now) return;
  window.history.replaceState(window.history.state, "", next);
}

export function friendlyConnectError(err: unknown, locale: Locale | null | undefined): string {
  const msg = err instanceof Error ? err.message : "";
  if (isMessageKey(msg)) return t(locale, msg);
  if (/401|403/.test(msg)) return t(locale, "error.badKey");
  if (/404/.test(msg)) return t(locale, "error.notFound");
  return t(locale, "error.generic");
}
