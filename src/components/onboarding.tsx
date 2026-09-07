import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { BotAvatar } from "./bot-avatar";
import { BrandMark } from "./brand-mark";
import { LanguageSwitcher } from "./language-switcher";
import { getBotProfiles } from "@/lib/native-bot";
import { friendlyConnectError, normalizeHttpsOrigin } from "@/lib/origin";
import { useDesk } from "@/lib/store";
import { detectLocale, resolveLocale, t } from "@/lib/locale";
import { CONNECT_HEADING_CLASS, CONNECT_HEADING_LINE_CLASS, splitConnectHeading } from "@/lib/brand";
import { finishLocalSetup } from "@/lib/local-setup";

export function Onboarding() {
  const setConnection = useDesk((s) => s.setConnection);
  const setProbe = useDesk((s) => s.setProbe);
  const syncHermesProfiles = useDesk((s) => s.syncHermesProfiles);
  const completeOnboarding = useDesk((s) => s.completeOnboarding);
  const locale = resolveLocale(useDesk((s) => s.locale));
  const setLocale = useDesk((s) => s.setLocale);
  const [origin, setOrigin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const https = normalizeHttpsOrigin(origin);
      const catalog = await getBotProfiles(https, password);
      setConnection({ origin: https, apiKey: password });
      syncHermesProfiles(catalog.profiles, catalog.capabilities);
      setProbe({
        ok: true,
        at: Date.now(),
        transport: "native-bot",
        profiles: catalog.profiles,
        capabilities: catalog.capabilities,
      });
      if (await finishLocalSetup(https, password)) return;
      completeOnboarding();
    } catch (err) {
      setError(friendlyConnectError(err, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup-page">
      <BrandMark className="text-sm" />
      <h1 className={CONNECT_HEADING_CLASS}>
        {splitConnectHeading(t(locale, "onboard.headline")).map((line) => (
          <span key={line} className={CONNECT_HEADING_LINE_CLASS}>
            {line}
          </span>
        ))}
      </h1>
      <p className="hermes-copy mt-4 max-w-[36ch] text-base text-muted">{t(locale, "onboard.body")}</p>

      <div className="mt-8 flex items-center gap-3">
        <BotAvatar swatch="moss" profile="moss" size={56} state="idle" />
        <BotAvatar swatch="steel" profile="steel" size={56} state="working" />
        <BotAvatar swatch="plum" profile="plum" size={56} state="idle" />
      </div>

      <form
        className="mt-auto flex flex-col gap-3 pt-12"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <label className="text-xs text-muted">{t(locale, "onboard.origin")}</label>
        <input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder="https://your-machine.ts.net"
          autoComplete="off"
          className="h-12 rounded-xl border border-border bg-bg-elevated px-4 font-mono text-sm outline-none focus:border-border-strong"
        />
        <label className="text-xs text-muted">{t(locale, "onboard.key")}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t(locale, "onboard.key")}
          autoComplete="off"
          className="h-12 rounded-xl border border-border bg-bg-elevated px-4 font-mono text-sm outline-none focus:border-border-strong"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex min-h-12 items-center justify-between rounded-xl bg-accent px-5 text-base font-medium text-accent-fg disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t(locale, "onboard.connect")}
          </span>
          <ArrowRight className="size-4" />
        </button>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <LanguageSwitcher
          locale={locale}
          onChange={(next) => setLocale(detectLocale({ stored: next }))}
          label={t(locale, "onboard.language")}
        />
        <p className="px-1 pt-1 text-xs leading-relaxed text-subtle">{t(locale, "onboard.keyHelp")}</p>
        <p id="onboard-help-last" className="px-1 text-xs leading-relaxed text-subtle">{t(locale, "onboard.lanHelp")}</p>
      </form>
    </main>
  );
}
