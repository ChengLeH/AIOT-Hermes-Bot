import { useMemo } from "react";
import { Search, Settings } from "lucide-react";
import { BotAvatar } from "./bot-avatar";
import { BrandMark } from "./brand-mark";
import { lastMessageFor, useDesk } from "@/lib/store";
import { cn, formatAge } from "@/lib/utils";
import { countLabel, localizeNotice, resolveLocale, t } from "@/lib/locale";
import type { Bot } from "@/lib/bots";
import type { ChatMessage } from "@/lib/types";
import {
  botPresenceOnline,
  connectionLive,
  MISSING_KEY_NOTICE,
  OFFLINE_STATUS_CLASS,
  resolveCredentialGate,
} from "@/lib/credential-gate";

type Row = {
  bot: Bot;
  last: ChatMessage | undefined;
  state: "idle" | "working" | "waiting";
};

export function Roster({ className = "" }: { className?: string }) {
  const bots = useDesk((s) => s.bots);
  const messages = useDesk((s) => s.messages);
  const botState = useDesk((s) => s.botState);
  const activity = useDesk((s) => s.activity);
  const search = useDesk((s) => s.search);
  const setSearch = useDesk((s) => s.setSearch);
  const openBot = useDesk((s) => s.openBot);
  const setView = useDesk((s) => s.setView);
  const connection = useDesk((s) => s.connection);
  const sessionNotice = useDesk((s) => s.sessionNotice);
  const locale = resolveLocale(useDesk((s) => s.locale));
  const live = connectionLive(connection);
  const gate = resolveCredentialGate(connection);
  const banner =
    gate.missingKey
      ? MISSING_KEY_NOTICE
      : sessionNotice && sessionNotice !== MISSING_KEY_NOTICE
        ? sessionNotice
        : null;

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bots
      .map((bot) => ({
        bot,
        last: lastMessageFor(bot.id, messages),
        state: botState[bot.id] ?? "idle",
      }))
      .filter(({ bot, last }) => {
        if (!q) return true;
        return (
          bot.name.toLowerCase().includes(q) ||
          bot.profile.toLowerCase().includes(q) ||
          (last?.content ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0));
  }, [bots, messages, botState, search]);

  return (
    <section className={`flex h-full min-h-0 flex-col bg-bg ${className}`}>
      <header className="flex shrink-0 items-end justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <BrandMark className="text-xs" />
          <h1 className="title-glyph mt-1 font-display text-3xl font-semibold">{t(locale, "roster.heading")}</h1>
          <p className="subhead-glyph mt-1 text-xs text-subtle">
            {live
              ? countLabel(locale, bots.length, "roster.countOne", "roster.count")
              : connection.origin
                ? t(locale, "roster.disconnected")
                : t(locale, "roster.unset")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setView("settings")}
          className="hidden size-11 place-items-center rounded-lg text-fg transition-colors hover:bg-bg-elevated md:grid"
          aria-label={t(locale, "roster.settingsAria")}
        >
          <Settings className="size-5" strokeWidth={1.8} />
        </button>
      </header>

      <div className="px-4 pb-2">
        {banner ? (
          <p className="mb-2 rounded-xl bg-bg-elevated px-3 py-2 text-sm text-muted">
            {localizeNotice(locale, banner)}
          </p>
        ) : null}
        <label className="flex h-11 items-center gap-2 rounded-xl bg-bg-elevated px-3">
          <Search className="size-4 text-subtle" strokeWidth={1.8} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(locale, "roster.search")}
            className="h-11 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.length === 0 ? (
          <p className="px-3 pt-8 text-sm text-muted">{t(locale, "roster.empty")}</p>
        ) : (
          <ul>
            {list.map((row) => (
              <BotRow
                key={row.bot.id}
                row={row}
                onOpen={openBot}
                activity={localizeNotice(locale, activity[row.bot.id]?.at(-1)?.label)}
                locale={locale}
                live={live}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BotRow({
  row,
  onOpen,
  activity,
  locale,
  live,
}: {
  row: Row;
  onOpen: (id: string) => void;
  activity?: string;
  locale: ReturnType<typeof resolveLocale>;
  live: boolean;
}) {
  const { bot, last, state } = row;
  const working = state === "working";
  const online = botPresenceOnline({ live, available: bot.available });
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(bot.id)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-bg-elevated"
      >
        <BotAvatar swatch={bot.swatch} profile={bot.profile} state={state} size={48} className="mb-1" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`subhead-glyph truncate font-medium ${online ? "" : "text-muted"}`}>
              {bot.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-subtle">
              {working ? t(locale, "roster.working") : last ? formatAge(last.createdAt, Date.now(), locale) : ""}
            </span>
          </span>
          {working ? (
            <span data-swatch={bot.swatch} className="mt-1.5 flex flex-col gap-1.5">
              <span className="work-track max-w-40" aria-hidden>
                <i />
              </span>
              <span className="block truncate text-xs text-muted">
                {activity || t(locale, "roster.workingNamed", { name: bot.name })}
              </span>
            </span>
          ) : (
            <span
              className={cn(
                "subhead-glyph mt-0.5 block truncate text-sm",
                online ? "text-muted" : OFFLINE_STATUS_CLASS,
              )}
            >
              {online ? last?.content || bot.name : t(locale, "roster.offline")}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
