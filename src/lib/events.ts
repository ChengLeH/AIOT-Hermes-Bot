import type { ApprovalCard } from "./approvals.ts";
import {
  applyApprovalEvent,
  parseApprovalCard,
  resolvedChoiceFromPayload,
} from "./approvals.ts";
import { parseAttachmentList, type AttachmentDescriptor } from "./attachment-rules.ts";
import type { BotWireEvent } from "./native-bot.ts";

const SUPPRESSED_PREFIXES = [
  "⚡ Interrupting current task",
  "↪ Redirected current run",
  "💡 First-time tip",
  "📬 No home channel is set for Pwa",
];

export function isSuppressedAssistantNotice(role: string, text: string): boolean {
  if (role !== "assistant") return false;
  const trimmed = text.trimStart();
  return SUPPRESSED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export type TurnMap = Record<string, { active: boolean; terminal: boolean; ids: string[] }>;

export type EventSink = {
  upsert: (input: {
    profile: string;
    conversation: string;
    messageId: string;
    role: "user" | "assistant";
    text: string;
    createdAt?: number;
    replayOrder?: number;
    historical?: boolean;
    keepRole?: boolean;
    streaming?: boolean;
    attachments?: AttachmentDescriptor[];
  }) => void;
  setWorking: (profile: string, conversation: string, working: boolean) => void;
  activity: (profile: string, conversation: string, label: string, kind: "think" | "tool" | "done" | "wait") => void;
  notice: (label: string) => void;
  upsertApproval?: (card: ApprovalCard) => void;
};

export function turnKey(profile: string, conversation: string): string {
  return `${profile}\0${conversation}`;
}

export function shouldApplySeq(seq: number | undefined, cursor: number): boolean {
  if (typeof seq !== "number") return true;
  return seq > cursor;
}

export function advanceCursor(seq: number | undefined, cursor: number): number {
  if (typeof seq === "number" && seq > cursor) return seq;
  return cursor;
}

export function eventIdentity(ev: BotWireEvent): string {
  const source = ev.source ? `${ev.source}:` : "";
  if (typeof ev.seq === "number") return `${source}seq:${ev.seq}`;
  const mid = typeof ev.payload?.message_id === "string" ? ev.payload.message_id : "";
  return `${source}seqless:${ev.kind ?? ""}:${ev.profile ?? ""}:${ev.conversation ?? ""}:${mid}`;
}

export function eventFingerprint(ev: BotWireEvent): string {
  return eventIdentity(ev);
}

function messageIdentity(ev: BotWireEvent, payload: { message_id?: string }): string {
  if (typeof payload.message_id === "string" && payload.message_id) return payload.message_id;
  if (typeof ev.seq === "number") return `seq:${ev.seq}`;
  return "";
}

export function applyBotEvent(
  ev: BotWireEvent,
  turns: TurnMap,
  seen: Set<string>,
  cursor: number,
  sink: EventSink,
): { cursor: number; applied: boolean } {
  if (!shouldApplySeq(ev.seq, cursor)) return { cursor, applied: false };
  const identity = eventIdentity(ev);
  if (seen.has(identity)) return { cursor: advanceCursor(ev.seq, cursor), applied: false };
  seen.add(identity);

  const kind = String(ev.kind ?? "").toLowerCase();
  const profile = ev.profile ?? "";
  const conversation = ev.conversation ?? "";
  const payload = ev.payload ?? {};
  const text = typeof payload.text === "string" ? payload.text : "";
  const messageId = messageIdentity(ev, payload);
  const rawTime = payload.created_at ?? ev.created_at ?? ev.timestamp;
  const numericTime = typeof rawTime === "number" ? rawTime : typeof rawTime === "string" && /^\d+(?:\.\d+)?$/.test(rawTime) ? Number(rawTime) : undefined;
  const parsedTime = numericTime !== undefined ? (numericTime < 1e12 ? numericTime * 1000 : numericTime) : typeof rawTime === "string" ? Date.parse(rawTime) : NaN;
  const key = turnKey(profile, conversation);
  const turn = turns[key] ?? { active: false, terminal: false, ids: [] };

  if (kind === "user_message" || kind === "message" || kind === "edit") {
    if (!profile || !conversation || !messageId) {
      return { cursor: advanceCursor(ev.seq, cursor), applied: false };
    }
    const role = kind === "user_message" ? "user" : "assistant";
    if (isSuppressedAssistantNotice(role, text)) {
      return { cursor: advanceCursor(ev.seq, cursor), applied: false };
    }
    sink.upsert({
      profile,
      conversation,
      messageId,
      role,
      text,
      ...(Number.isFinite(parsedTime) ? { createdAt: parsedTime } : {}),
      replayOrder: ev.seq,
      keepRole: kind === "edit",
      streaming: role === "assistant" && turn.active,
      attachments: parseAttachmentList(payload.attachments),
    });
    return { cursor: advanceCursor(ev.seq, cursor), applied: true };
  }

  if (kind === "complete") {
    sink.notice("通知");
    return { cursor: advanceCursor(ev.seq, cursor), applied: true };
  }

  if (kind === "turn_start") {
    const ids = ev.event_id ? [...turn.ids, ev.event_id] : turn.ids;
    turns[key] = { active: true, terminal: false, ids };
    sink.setWorking(profile, conversation, true);
    sink.activity(profile, conversation, "activity.started", "think");
    return { cursor: advanceCursor(ev.seq, cursor), applied: true };
  }

  if (kind === "typing") {
    const typingOn = payload.active === true;
    if (ev.event_id && turn.terminal && turn.ids.includes(ev.event_id)) {
      return { cursor: advanceCursor(ev.seq, cursor), applied: false };
    }
    if (!turn.active) {
      return { cursor: advanceCursor(ev.seq, cursor), applied: false };
    }
    if (!typingOn) {
      return { cursor: advanceCursor(ev.seq, cursor), applied: false };
    }
    if (ev.event_id) turn.ids.push(ev.event_id);
    turns[key] = turn;
    sink.activity(profile, conversation, "activity.typing", "think");
    return { cursor: advanceCursor(ev.seq, cursor), applied: true };
  }

  if (kind === "turn_complete") {
    turns[key] = { active: false, terminal: true, ids: turn.ids };
    sink.setWorking(profile, conversation, false);
    const outcome = payload.outcome;
    sink.activity(
      profile,
      conversation,
      outcome === "failure" ? "activity.failed" : outcome === "cancelled" ? "activity.cancelled" : "activity.done",
      outcome === "success" || !outcome ? "done" : "wait",
    );
    return { cursor: advanceCursor(ev.seq, cursor), applied: true };
  }

  if (kind === "tool_started" || kind === "tool_completed" || kind === "tool_failed") {
    const tool = typeof payload.tool === "string" ? payload.tool : "";
    const preview = typeof payload.preview === "string" ? payload.preview : "";
    const label = [tool, preview].filter(Boolean).join(" · ") || "activity.tool";
    sink.activity(profile, conversation, label, kind === "tool_started" ? "tool" : kind === "tool_completed" ? "done" : "wait");
    return { cursor: advanceCursor(ev.seq, cursor), applied: true };
  }

  if (kind === "reasoning_available" || kind === "subagent_start" || kind === "subagent_complete") {
    const label = typeof payload.text === "string" && payload.text ? payload.text : kind === "subagent_start" ? "activity.started" : "activity.done";
    sink.activity(profile, conversation, label, kind === "subagent_complete" ? "done" : "think");
    return { cursor: advanceCursor(ev.seq, cursor), applied: true };
  }

  if (kind === "approval_request" || kind === "approval_resolved" || kind === "approval_expired") {
    const parsed = parseApprovalCard({
      profile,
      conversation,
      payload: payload as Record<string, unknown>,
    });
    const choice = resolvedChoiceFromPayload(payload as Record<string, unknown>);
    const card = applyApprovalEvent(kind, parsed ? { ...parsed, lastChoice: choice } : parsed, undefined);
    if (card) {
      sink.upsertApproval?.(card);
      if (kind === "approval_request") sink.notice("approval.notify");
    }
    return { cursor: advanceCursor(ev.seq, cursor), applied: Boolean(card) };
  }

  return { cursor: advanceCursor(ev.seq, cursor), applied: false };
}

export function applyEventBatch(
  events: BotWireEvent[],
  state: { cursor: number; turns: TurnMap; seen: Set<string> },
  sink: EventSink,
): number {
  let applied = 0;
  for (const ev of events) {
    const next = applyBotEvent(ev, state.turns, state.seen, state.cursor, sink);
    state.cursor = next.cursor;
    if (next.applied) applied += 1;
  }
  return applied;
}

/** During initial history catch-up, keep lifecycle state internal until all pages arrive. */
export function replayEventSink(sink: EventSink): EventSink {
  return { ...sink,
    upsert: input => sink.upsert({ ...input, historical: true,
      // Legacy undated replay has only sequence order. Never date it at reconnect.
      createdAt: input.createdAt ?? (Number.isFinite(input.replayOrder) ? input.replayOrder! : 0) }),
    setWorking: () => {}, activity: () => {}, notice: () => {} };
}

export function finishEventReplay(
  turns: TurnMap,
  conversations: { profile: string; conversation: string }[],
  sink: EventSink,
): void {
  for (const { profile, conversation } of conversations) {
    sink.setWorking(profile, conversation, turns[turnKey(profile, conversation)]?.active === true);
  }
}
