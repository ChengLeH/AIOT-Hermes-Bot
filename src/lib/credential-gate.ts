import type { NativeBotCapabilities } from "./bot-catalog";
import type { Connection, HermesProbe } from "./types";

export const MISSING_KEY_NOTICE = "error.missingKey";
export const OFFLINE_STATUS_CLASS = "status-offline";

export type CredentialGate = {
  live: boolean;
  missingKey: boolean;
  notice: string | null;
  view: "settings" | null;
  probe: HermesProbe | null;
};

export function disconnectedCapabilities(from?: NativeBotCapabilities | null): NativeBotCapabilities {
  return {
    attachments: false,
    attachment_uploads: false,
    attachment_downloads: false,
    max_attachment_bytes: from?.max_attachment_bytes ?? 10_485_760,
    durable_events: from?.durable_events ?? true,
    completion_events: from?.completion_events ?? true,
    dynamic_completions: false,
    interrupts: false,
  };
}

export function applyMissingCredential(probe: HermesProbe | null, reason = MISSING_KEY_NOTICE): HermesProbe {
  return {
    ok: false,
    at: probe?.at ?? 0,
    transport: "native-bot",
    profiles: probe?.profiles ?? [],
    capabilities: disconnectedCapabilities(probe?.capabilities),
    error: reason,
  };
}

export function failedProbe(probe: HermesProbe | null, error: string): HermesProbe {
  return {
    ok: false,
    at: Date.now(),
    transport: "native-bot",
    profiles: probe?.profiles ?? [],
    capabilities: disconnectedCapabilities(probe?.capabilities),
    error,
  };
}

export function browserIsOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

export function resolveCredentialGate(input: {
  origin: string;
  apiKey: string;
  lastProbe: HermesProbe | null;
}): CredentialGate {
  const origin = input.origin.trim();
  const apiKey = input.apiKey.trim();
  const rejected = input.lastProbe?.error === MISSING_KEY_NOTICE;
  if (origin && (!apiKey || rejected)) {
    return {
      live: false,
      missingKey: true,
      notice: MISSING_KEY_NOTICE,
      view: "settings",
      probe: applyMissingCredential(input.lastProbe),
    };
  }
  if (!browserIsOnline()) {
    return {
      live: false,
      missingKey: false,
      notice: null,
      view: null,
      probe: input.lastProbe,
    };
  }
  return {
    live: Boolean(origin && apiKey && input.lastProbe?.ok),
    missingKey: false,
    notice: null,
    view: null,
    probe: input.lastProbe,
  };
}

export function connectionLive(connection: Pick<Connection, "origin" | "apiKey" | "lastProbe">): boolean {
  return resolveCredentialGate(connection).live;
}

export function botPresenceOnline(input: { live: boolean; available: boolean }): boolean {
  return input.live && input.available;
}

export function isUnauthorizedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export function isUnauthorizedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /\b401\b|\b403\b/.test(msg);
}

export function persistConnectionSlice(connection: Connection): { origin: string; lastProbe: HermesProbe | null } {
  const probe = connection.lastProbe;
  return {
    origin: connection.origin,
    lastProbe: probe
      ? {
          ok: false,
          at: probe.at,
          transport: "native-bot",
          profiles: probe.profiles,
          capabilities: probe.capabilities,
          error: probe.error === MISSING_KEY_NOTICE ? probe.error : probe.ok ? undefined : probe.error,
        }
      : null,
  };
}

export function sanitizeHydratedConnection(connection: Connection, apiKey: string): Connection {
  const probe = connection.lastProbe;
  return {
    origin: connection.origin,
    apiKey,
    lastProbe: probe ? { ...probe, ok: false } : null,
  };
}
