import { useState } from "react";
import { BotAvatar } from "./bot-avatar";
import { postBotApproval } from "@/lib/native-bot";
import {
  statusAfterApprovalHttp,
  type ApprovalCard as ApprovalModel,
  type ApprovalChoice,
} from "@/lib/approvals";
import { useDesk } from "@/lib/store";
import { connectionLive } from "@/lib/credential-gate";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/locale";
import { cn } from "@/lib/utils";

const CHOICE_KEYS: Record<ApprovalChoice, "approval.once" | "approval.session" | "approval.always" | "approval.deny"> = {
  once: "approval.once",
  session: "approval.session",
  always: "approval.always",
  deny: "approval.deny",
};

export function ApprovalCardView({
  card,
  locale,
  swatch,
  profile,
}: {
  card: ApprovalModel;
  locale: Locale;
  swatch: string;
  profile: string;
}) {
  const upsertApproval = useDesk((s) => s.upsertApproval);
  const connection = useDesk((s) => s.connection);
  const [open, setOpen] = useState(false);
  const live = connectionLive(connection);
  const disabled = !live || card.status === "submitting" || card.status === "approved" || card.status === "rejected" || card.status === "expired";

  async function choose(choice: ApprovalChoice) {
    if (disabled) return;
    if (choice === "always" && !card.confirmAlways) {
      upsertApproval({ ...card, confirmAlways: true });
      return;
    }
    upsertApproval({ ...card, status: "submitting", lastChoice: choice, confirmAlways: false, errorKind: undefined });
    try {
      const res = await postBotApproval({
        origin: connection.origin,
        apiKey: connection.apiKey,
        requestId: card.requestId,
        profile: card.profile,
        conversation: card.conversation,
        choice,
      });
      const status = statusAfterApprovalHttp(res.status, choice);
      upsertApproval({
        ...card,
        status,
        lastChoice: choice,
        confirmAlways: false,
        errorKind: res.status === 409 ? "conflict" : status === "error" ? "generic" : undefined,
      });
    } catch {
      upsertApproval({ ...card, status: "error", lastChoice: choice, confirmAlways: false, errorKind: "generic" });
    }
  }

  return (
    <article data-swatch={swatch} className="approval-card rise-in rounded-2xl border border-border bg-bg-elevated p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 opacity-55">
          <BotAvatar swatch={swatch} profile={profile} size={36} state="idle" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold tracking-tight">{t(locale, "approval.title")}</p>
          {card.description ? <p className="mt-1 text-sm leading-relaxed text-muted">{card.description}</p> : null}
        </div>
      </div>
      {card.command ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="min-h-11 text-xs text-subtle underline-offset-2 hover:underline"
          >
            {open ? t(locale, "approval.hideCommand") : t(locale, "approval.command")}
          </button>
          {open ? (
            <pre className="mt-1 overflow-x-auto rounded-xl bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-muted">{card.command}</pre>
          ) : null}
        </div>
      ) : null}

      {card.status === "pending" || card.status === "error" || card.status === "submitting" ? (
        <div className="mt-3 flex flex-col gap-2">
          {card.confirmAlways ? (
            <>
              <p className="text-sm text-fg">{t(locale, "approval.alwaysConfirm")}</p>
              <div className="flex flex-wrap gap-2">
                <ChoiceButton
                  label={t(locale, "approval.confirmAlways")}
                  onClick={() => void choose("always")}
                  disabled={disabled}
                  danger={false}
                />
                <ChoiceButton
                  label={t(locale, "approval.cancel")}
                  onClick={() => upsertApproval({ ...card, confirmAlways: false })}
                  disabled={card.status === "submitting"}
                  danger={false}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              {card.choices.map((choice) => (
                <ChoiceButton
                  key={choice}
                  label={t(locale, CHOICE_KEYS[choice])}
                  onClick={() => void choose(choice)}
                  disabled={disabled}
                  danger={choice === "deny"}
                />
              ))}
            </div>
          )}
          {card.status === "submitting" ? <p className="text-xs text-muted">{t(locale, "approval.submitting")}</p> : null}
          {card.status === "error" ? (
            <p className="text-xs text-danger">
              {t(locale, card.errorKind === "conflict" ? "approval.conflict" : "approval.error")}{" "}
              <button type="button" className="underline" onClick={() => upsertApproval({ ...card, status: "pending", errorKind: undefined })}>
                {t(locale, "approval.retry")}
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        <p className={cn("mt-3 text-xs", card.status === "approved" ? "text-ok" : "text-muted")}>
          {t(locale, `approval.${card.status}` as "approval.approved")}
        </p>
      )}
    </article>
  );
}

function ChoiceButton({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "min-h-11 rounded-xl px-3 text-sm disabled:opacity-40",
        danger ? "bg-danger/15 text-danger" : "bg-bg text-fg",
      )}
    >
      {label}
    </button>
  );
}
