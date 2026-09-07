export type NativeBotProfile = {
  name: string;
  available: boolean;
  canonicalSessionId: string;
  displayName?: string;
};

export type NativeBotCapabilities = {
  attachments: boolean;
  attachment_uploads: boolean;
  attachment_downloads: boolean;
  max_attachment_bytes: number;
  durable_events: boolean;
  completion_events: boolean;
  dynamic_completions: boolean;
  interrupts: boolean;
};

export type NativeBotCatalog = {
  profiles: NativeBotProfile[];
  transport: "native-bot";
  capabilities: NativeBotCapabilities;
};

export const PROFILE_REFRESH_SECONDS = 30;

export function parseCanonicalSessionId(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const rec = row as Record<string, unknown>;
  const nested = rec.canonical_session;
  if (nested && typeof nested === "object") {
    const id = (nested as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  if (typeof rec.canonical_session_id === "string" && rec.canonical_session_id.trim()) {
    return rec.canonical_session_id.trim();
  }
  return "";
}

export function parseBotCatalog(json: unknown): NativeBotCatalog {
  const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const rows = Array.isArray(rec.profiles) ? rec.profiles : [];
  const profiles: NativeBotProfile[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    let name = "";
    let available = true;
    let canonicalSessionId = "";
    let displayName = "";
    if (typeof row === "string") name = row.trim();
    else if (row && typeof row === "object") {
      const r = row as { name?: unknown; available?: unknown; display_name?: unknown };
      name = typeof r.name === "string" ? r.name.trim() : "";
      available = r.available === true ? true : r.available === false ? false : true;
      canonicalSessionId = parseCanonicalSessionId(row);
      displayName = typeof r.display_name === "string" ? r.display_name.trim() : "";
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    profiles.push({ name, available, canonicalSessionId, displayName });
  }
  const caps = rec.capabilities && typeof rec.capabilities === "object" ? (rec.capabilities as Record<string, unknown>) : {};
  return {
    profiles,
    transport: "native-bot",
    capabilities: {
      attachments: caps.attachments === true,
      attachment_uploads: caps.attachment_uploads === true,
      attachment_downloads: caps.attachment_downloads === true,
      max_attachment_bytes:
        typeof caps.max_attachment_bytes === "number" && caps.max_attachment_bytes > 0
          ? caps.max_attachment_bytes
          : 10_485_760,
      durable_events: caps.durable_events !== false,
      completion_events: caps.completion_events !== false,
      dynamic_completions: caps.dynamic_completions === true,
      interrupts: caps.interrupts === true,
    },
  };
}
