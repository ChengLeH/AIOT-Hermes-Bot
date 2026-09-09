import { hermesFetch, CONNECTION_PROBE_TIMEOUT_MS } from "./hermes-fetch";
import { parseBotCatalog, type NativeBotCatalog } from "./bot-catalog";
import { attachmentDownloadUrl, botMessageBody } from "./attachment-preview";
import { completionBody, parseCompletionItems, type CompletionItem, type CompletionTrigger } from "./completions";
import { interruptBody } from "./interrupt";
import { approvalBody, type ApprovalChoice } from "./approvals";
import { getNativeSkills, getProfileNativeCapabilities, mergeCompletionItems, postNativeApproval, postNativeInterrupt } from "./native-runs";

export type BotWireEvent = {
  source?: string;
  timestamp?: string | number;
  created_at?: string | number;
  seq?: number;
  profile?: string;
  conversation?: string;
  event_id?: string;
  kind?: string;
  payload?: {
    text?: string;
    message_id?: string;
    active?: boolean;
    outcome?: string;
    attachments?: unknown;
    request_id?: string;
    command?: string;
    description?: string;
    choices?: unknown;
    created_at?: string | number;
    choice?: string;
    tool?: string;
    preview?: string;
    duration?: number;
    error?: boolean;
    run_id?: string;
  };
};

export async function getBotProfiles(origin: string, apiKey: string): Promise<NativeBotCatalog> {
  const res = await hermesFetch(`${origin}/api/bot/profiles`, { apiKey, timeoutMs: CONNECTION_PROBE_TIMEOUT_MS });
  if (!res.ok) throw new Error(`profiles ${res.status}`);
  const catalog = parseBotCatalog(await res.json());
  const profiles = await Promise.all(catalog.profiles.map(async (profile) => ({
    ...profile,
    nativeCapabilities: profile.available
      ? await getProfileNativeCapabilities(origin, apiKey, profile.name)
      : undefined,
  })));
  return { ...catalog, profiles };
}

export { botMessageBody };

export async function postBotMessage(input: {
  origin: string;
  apiKey: string;
  profile: string;
  conversation: string;
  text: string;
  attachmentIds?: string[];
}): Promise<{ accepted: boolean; profile: string; conversation: string; status: number }> {
  const payload = botMessageBody(input);
  const res = await hermesFetch(`${input.origin}/api/bot/messages`, {
    method: "POST",
    apiKey: input.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let json: { accepted?: boolean; profile?: string; conversation?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {};
  }
  return {
    accepted: res.status === 202 && json.accepted !== false,
    profile: json.profile || input.profile,
    conversation: json.conversation || input.conversation,
    status: res.status,
  };
}

export async function getBotEvents(
  origin: string,
  apiKey: string,
  after: number,
): Promise<{ events: BotWireEvent[]; durable: boolean; status: number }> {
  const res = await hermesFetch(`${origin}/api/bot/events?after=${encodeURIComponent(String(after))}`, {
    apiKey,
    timeoutMs: CONNECTION_PROBE_TIMEOUT_MS,
  });
  if (!res.ok) return { events: [], durable: true, status: res.status };
  const json = (await res.json()) as { events?: BotWireEvent[]; durable?: boolean };
  const events = Array.isArray(json.events) ? json.events.slice(0, 1000) : [];
  return { events, durable: json.durable !== false, status: res.status };
}

export async function getBotAttachment(input: {
  origin: string;
  apiKey: string;
  id: string;
}): Promise<{ blob: Blob; mime: string }> {
  const res = await hermesFetch(attachmentDownloadUrl(input.origin, input.id), {
    apiKey: input.apiKey,
    headers: { Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`attachment ${res.status}`);
  const blob = await res.blob();
  const mime = blob.type || res.headers.get("content-type") || "";
  return { blob, mime };
}

export async function getSessionArtifact(input: {
  origin: string; apiKey: string; botId: string; profile: string; taskId: string; artifactId: string;
}): Promise<{ blob: Blob; mime: string }> {
  const query = new URLSearchParams({ botId: input.botId, profile: input.profile, id: input.taskId, artifactId: input.artifactId });
  const res = await hermesFetch(`${input.origin}/api/bot/sessions/artifact?${query}`, { apiKey: input.apiKey, headers: { Accept: "*/*" } });
  if (!res.ok) throw new Error(`artifact ${res.status}`);
  const blob = await res.blob();
  return { blob, mime: blob.type || res.headers.get("content-type") || "" };
}

export async function postBotCompletions(input: {
  origin: string;
  apiKey: string;
  profile: string;
  conversation: string;
  trigger: CompletionTrigger;
  query: string;
  signal?: AbortSignal;
}): Promise<CompletionItem[]> {
  const body = completionBody(input);
  const legacyRequest = hermesFetch(`${input.origin}/api/bot/completions`, {
    method: "POST",
    apiKey: input.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  const officialRequest = input.trigger === "/"
    ? getNativeSkills({ origin: input.origin, apiKey: input.apiKey, profile: input.profile, query: input.query, signal: input.signal })
    : Promise.resolve([]);
  const [res, official] = await Promise.all([legacyRequest, officialRequest]);
  const legacy = res.ok ? parseCompletionItems(await res.json().catch(() => ({}))) : [];
  return mergeCompletionItems(legacy, official);
}

export async function postBotApproval(input: {
  origin: string;
  apiKey: string;
  requestId: string;
  profile: string;
  conversation: string;
  choice: ApprovalChoice;
}): Promise<{ status: number }> {
  const native = await postNativeApproval(input).catch(() => ({ status: 0 }));
  if (native.status !== 404 && native.status !== 0) return native;
  const res = await hermesFetch(`${input.origin}/api/bot/approvals/${encodeURIComponent(input.requestId)}`, {
    method: "POST",
    apiKey: input.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(approvalBody(input)),
  });
  return { status: res.status };
}

export async function postBotInterrupt(input: {
  origin: string;
  apiKey: string;
  profile: string;
  conversation: string;
}): Promise<{ status: number }> {
  const native = await postNativeInterrupt(input).catch(() => ({ status: 0 }));
  if (native.status !== 404 && native.status !== 0) return native;
  const res = await hermesFetch(`${input.origin}/api/bot/interrupts`, {
    method: "POST",
    apiKey: input.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(interruptBody(input)),
  });
  return { status: res.status };
}
