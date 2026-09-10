import { hermesFetch } from "./hermes-fetch.ts";
import { parseCompletionItems, type CompletionItem } from "./completions.ts";
import type { BotWireEvent } from "./native-bot.ts";
import type { ApprovalChoice } from "./approvals.ts";

export type NativeRunCapabilities = {
  available: boolean;
  run_submission: boolean;
  run_status: boolean;
  run_events_sse: boolean;
  run_approval_response: boolean;
  run_stop: boolean;
  skills: boolean;
};

const OFF: NativeRunCapabilities = {
  available: false,
  run_submission: false,
  run_status: false,
  run_events_sse: false,
  run_approval_response: false,
  run_stop: false,
  skills: false,
};

export function parseNativeRunCapabilities(raw: unknown): NativeRunCapabilities {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const features = rec.features && typeof rec.features === "object" ? (rec.features as Record<string, unknown>) : {};
  const available = rec.available === true;
  return {
    available,
    run_submission: available && features.run_submission === true,
    run_status: available && features.run_status === true,
    run_events_sse: available && features.run_events_sse === true,
    run_approval_response: available && features.run_approval_response === true,
    run_stop: available && features.run_stop === true,
    skills: available && features.skills === true,
  };
}

export function canUseNativeRuns(caps: NativeRunCapabilities | null | undefined): boolean {
  return caps?.available === true && caps.run_submission === true && caps.run_events_sse === true;
}

export function mergeCompletionItems(first: CompletionItem[], second: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  const out: CompletionItem[] = [];
  for (const item of [...first, ...second]) {
    if (!item.insert || seen.has(item.insert)) continue;
    seen.add(item.insert);
    out.push(item);
  }
  return out;
}

export async function getProfileNativeCapabilities(origin: string, apiKey: string, profile: string): Promise<NativeRunCapabilities> {
  try {
    const res = await hermesFetch(`${origin}/api/bot/native/capabilities?profile=${encodeURIComponent(profile)}`, { apiKey, timeoutMs: 4_500 });
    if (!res.ok) return OFF;
    return parseNativeRunCapabilities(await res.json());
  } catch {
    return OFF;
  }
}

export async function postNativeRun(input: {
  origin: string;
  apiKey: string;
  profile: string;
  conversation: string;
  text: string;
  requestId: string;
}): Promise<{ accepted: boolean; queued: boolean; runId: string; queueId: string; status: number; error?: string }> {
  const res = await hermesFetch(`${input.origin}/api/bot/native/runs`, {
    method: "POST",
    apiKey: input.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: input.profile, conversation: input.conversation, text: input.text, requestId: input.requestId }),
  });
  const json = (await res.json().catch(() => ({}))) as { run_id?: unknown; queue_id?: unknown; error?: unknown };
  const runId = typeof json.run_id === "string" ? json.run_id : "";
  const queueId = typeof json.queue_id === "string" ? json.queue_id : "";
  return { accepted: res.status === 202 && Boolean(runId || queueId), queued: Boolean(queueId && !runId), runId, queueId, status: res.status, error: typeof json.error === "string" ? json.error : undefined };
}

export type NativeQueuedTurn = { id: string; text: string; status: "queued" | "dispatching" | "paused"; createdAt: number };

export async function getNativeQueue(input: {
  origin: string;
  apiKey: string;
  profile: string;
  conversation: string;
}): Promise<NativeQueuedTurn[]> {
  try {
    const query = new URLSearchParams({ profile: input.profile, conversation: input.conversation });
    const res = await hermesFetch(`${input.origin}/api/bot/native/queue?${query}`, { apiKey: input.apiKey, timeoutMs: 4_500 });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: unknown };
    if (!Array.isArray(json.items)) return [];
    return json.items.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.text !== "string" || typeof row.createdAt !== "number" || !["queued", "dispatching", "paused"].includes(String(row.status))) return [];
      return [{ id: row.id, text: row.text, status: row.status as NativeQueuedTurn["status"], createdAt: row.createdAt }];
    }).slice(0, 20);
  } catch {
    return [];
  }
}

export async function getNativeRunEvents(origin: string, apiKey: string, after: number): Promise<{ events: BotWireEvent[]; status: number; historyResetAt?: number }> {
  try {
    const res = await hermesFetch(`${origin}/api/bot/native/events?after=${encodeURIComponent(String(after))}`, { apiKey, timeoutMs: 6_000 });
    if (!res.ok) return { events: [], status: res.status };
    const json = (await res.json()) as { events?: BotWireEvent[]; historyResetAt?: number };
    return { events: Array.isArray(json.events) ? json.events.slice(0, 1000) : [], status: res.status, historyResetAt: json.historyResetAt };
  } catch {
    return { events: [], status: 0 };
  }
}

export async function getNativeSkills(input: { origin: string; apiKey: string; profile: string; query: string; signal?: AbortSignal }): Promise<CompletionItem[]> {
  try {
    const res = await hermesFetch(`${input.origin}/api/bot/native/skills?profile=${encodeURIComponent(input.profile)}&query=${encodeURIComponent(input.query)}`, { apiKey: input.apiKey, timeoutMs: 6_000, signal: input.signal });
    if (!res.ok) return [];
    return parseCompletionItems(await res.json());
  } catch {
    return [];
  }
}

export async function postNativeApproval(input: {
  origin: string;
  apiKey: string;
  requestId: string;
  profile: string;
  conversation: string;
  choice: ApprovalChoice;
}): Promise<{ status: number }> {
  const res = await hermesFetch(`${input.origin}/api/bot/native/approvals/${encodeURIComponent(input.requestId)}`, {
    method: "POST",
    apiKey: input.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: input.profile, conversation: input.conversation, choice: input.choice }),
  });
  return { status: res.status };
}

export async function postNativeInterrupt(input: {
  origin: string;
  apiKey: string;
  profile: string;
  conversation: string;
}): Promise<{ status: number }> {
  const res = await hermesFetch(`${input.origin}/api/bot/native/interrupts`, {
    method: "POST",
    apiKey: input.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: input.profile, conversation: input.conversation }),
  });
  return { status: res.status };
}

export async function getSessionHistory(origin: string, apiKey: string, profile: string, conversation: string): Promise<import("./session-history").SessionMessage[]> {
  const query = new URLSearchParams({ profile, conversation });
  const res = await hermesFetch(`${origin}/api/bot/native/history?${query}`, { apiKey, timeoutMs: 6500 });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.messages) ? data.messages.filter((m: import("./session-history").SessionMessage) => m && typeof m.messageId === "string" && typeof m.text === "string" && ["user", "assistant"].includes(m.role)) : [];
}
