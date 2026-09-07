import { postBotMessage } from "./native-bot";
import type { AttachmentDescriptor } from "./attachment-rules";
import { isTurnBusy, releaseSendLock, trySendLock } from "./composer";
import { useDesk } from "./store";
import { connectionLive, isUnauthorizedStatus, MISSING_KEY_NOTICE } from "./credential-gate";
import { t } from "./locale";

export async function sendTask(
  botId: string,
  text?: string,
  attachmentIds?: string[],
  attachmentMeta?: AttachmentDescriptor[],
): Promise<boolean> {
  if (!trySendLock(botId)) return false;
  try {
    const state = useDesk.getState();
    const bot = state.bots.find((b) => b.id === botId);
    if (!bot) return false;
    if (isTurnBusy(state.botState[botId], Boolean(state.sending[botId]))) return false;
    if (!bot.available) {
      state.pushActivity(botId, { label: t(state.locale, "error.unavailable", { name: bot.profile }), kind: "wait" });
      return false;
    }
    const profile = bot.profile;
    const conversation = bot.conversation;
    if (!profile || !conversation) return false;
    const origin = state.connection.origin;
    const apiKey = state.connection.apiKey;
    if (!connectionLive(state.connection) || !origin || !apiKey) {
      state.pushActivity(botId, { label: MISSING_KEY_NOTICE, kind: "wait" });
      return false;
    }
    const trimmed = (text ?? state.composerDrafts[botId] ?? "").trim();
    const ids = attachmentIds?.filter(Boolean) ?? [];
    if (!trimmed && ids.length === 0) return false;
    state.setDraft(botId, "");
    state.setSending(botId, true);
    state.setBotState(botId, "waiting");
    try {
      const ack = await postBotMessage({
        origin,
        apiKey,
        profile,
        conversation,
        text: trimmed,
        attachmentIds: ids,
      });
      if (isUnauthorizedStatus(ack.status)) {
        useDesk.getState().markDisconnected();
        useDesk.getState().setBotState(botId, "idle");
        return false;
      }
      if (!ack.accepted) {
        useDesk.getState().setBotState(botId, "idle");
        useDesk.getState().pushActivity(botId, { label: "error.notAccepted", kind: "wait" });
        return false;
      }
      useDesk.getState().pushPendingUser(botId, trimmed, attachmentMeta);
      return true;
    } catch {
      useDesk.getState().setBotState(botId, "idle");
      useDesk.getState().pushActivity(botId, { label: "error.sendFail", kind: "wait" });
      return false;
    } finally {
      useDesk.getState().setSending(botId, false);
    }
  } finally {
    releaseSendLock(botId);
  }
}
