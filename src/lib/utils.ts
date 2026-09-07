import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { resolveLocale, t, type Locale } from "./locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function formatAge(ts: number, now = Date.now(), locale?: Locale | null): string {
  const lang = resolveLocale(locale);
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return t(lang, "age.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t(lang, "age.minutes", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t(lang, "age.hours", { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return t(lang, "age.days", { n: d });
  return new Date(ts).toLocaleDateString(lang === "en" ? "en" : "zh-Hant-TW", { month: "short", day: "numeric" });
}

export function conversationUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    const v = ch === "x" ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}