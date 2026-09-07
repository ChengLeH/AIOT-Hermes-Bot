import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  stopAction,
  collapsible = true,
}: {
  card: ApprovalModel;
  locale: Locale;
  swatch: string;
  profile: string;
  stopAction?: ReactNode;
  collapsible?: boolean;
}) {
  const upsertApproval = useDesk((s) => s.upsertApproval);
  const connection = useDesk((s) => s.connection);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (card.status !== "approved" && card.status !== "rejected") return;
    // Persist the first confirmed resolution so replay/reload does not restart the timer.
    if (!card.resolvedAt) {
      upsertApproval({ ...card, resolvedAt: Date.now() });
      return;
    }
    let animation: Animation | undefined;
    const timer = window.setTimeout(() => {
      const element = cardRef.current;
      if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setDismissed(true);
        return;
      }
      animation = element.animate([
        { opacity: 1, transform: "translateY(0) scale(1)", height: `${element.getBoundingClientRect().height}px`, paddingBlock: "16px", borderWidth: "1px", offset: 0 },
        { opacity: 0, transform: "translateY(6px) scale(.985)", height: `${element.getBoundingClientRect().height}px`, paddingBlock: "16px", borderWidth: "1px", offset: .45 },
        { opacity: 0, transform: "translateY(6px) scale(.985)", height: "0px", paddingBlock: "0px", borderWidth: "0px", offset: 1 },
      ], { duration: 720, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });
      animation.onfinish = () => setDismissed(true);
    }, Math.max(0, card.resolvedAt + 30_000 - Date.now()));
    return () => { window.clearTimeout(timer); animation?.cancel(); };
  }, [card.requestId, card.status, card.resolvedAt, upsertApproval]);
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

  if (dismissed) return <span hidden className="approval-dismissed" />;
  return (
    <article ref={cardRef} data-swatch={swatch} className="approval-card rise-in overflow-hidden rounded-2xl border border-border bg-bg-elevated p-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0 opacity-55">
          <BotAvatar swatch={swatch} profile={profile} size={36} state="idle" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-display text-sm font-semibold tracking-tight", card.status === "approved" && "text-[#b1c8bb]", card.status === "rejected" && "text-[#c59b99]")}>
            {t(locale, card.status === "approved" ? "approval.approved" : card.status === "rejected" ? "approval.rejected" : card.status === "expired" ? "approval.expired" : "approval.title")}
          </p>
        </div>
        {collapsible ? <button type="button" className="shrink-0 grid size-11 place-items-center rounded-full text-muted hover:bg-white/5" aria-expanded={!collapsed} aria-label={locale === "en" ? (collapsed ? "Expand approval" : "Collapse approval") : (collapsed ? "展開批准卡" : "收合批准卡")} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button> : null}
      </div>
      <div hidden={collapsed}>
      {card.description ? <p className="mt-3 text-sm leading-relaxed text-muted">{card.description}</p> : null}
      <dl className="approval-timing">
        <div><dt>{locale === "en" ? "Requested" : "送出時間"}</dt><dd><time dateTime={new Date(card.createdAt).toISOString()}>{new Date(card.createdAt).toLocaleString(locale === "en" ? "en-US" : "zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time></dd></div>
        <div><dt>{locale === "en" ? "Timeout" : "逾時時間"}</dt><dd>{card.timeoutSeconds !== undefined ? `${card.timeoutSeconds} ${locale === "en" ? "seconds" : "秒"}` : (locale === "en" ? "Not provided by Hermes" : "Hermes 未提供")}</dd></div>
      </dl>
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

      </div>
      {(!collapsed || !collapsible) && (card.status === "pending" || card.status === "error" || card.status === "submitting") ? (
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
            <div className="approval-actions">
              {(["once", "session", "always", "deny"] as const).filter((choice) => card.choices.includes(choice)).map((choice) => (
                <ChoiceButton
                  key={choice}
                  slot={choice}
                  label={t(locale, CHOICE_KEYS[choice])}
                  onClick={() => void choose(choice)}
                  disabled={disabled}
                  danger={choice === "deny"}
                />
              ))}
              {stopAction ? <div className="approval-stop-slot">{stopAction}</div> : null}
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
      ) : card.status === "approved" || card.status === "rejected" || card.status === "expired" ? (
        null
      ) : <p className="mt-3 text-xs text-muted">{locale === "en" ? "Waiting for approval" : "等待批准"}</p>}
    </article>
  );
}

function ChoiceButton({
  label,
  onClick,
  disabled,
  danger,
  slot,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger: boolean;
  slot?: ApprovalChoice;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-choice={slot}
      className={cn(
        "min-h-11 rounded-xl px-3 text-sm disabled:opacity-40",
        danger ? "bg-danger/15 text-danger" : "bg-bg text-fg",
      )}
    >
      {label}
    </button>
  );
}
