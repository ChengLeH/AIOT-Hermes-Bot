import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader2, Smartphone } from "lucide-react";
import { getBotEvents, getBotProfiles } from "@/lib/native-bot";
import { friendlyConnectError, normalizeHttpsOrigin } from "@/lib/origin";
import { useDesk } from "@/lib/store";
import { resetEventCursor } from "@/lib/runtime";
import {
  browserStorage,
  enableSessionWrites,
  markRestorePending,
  readDeskSession,
  restoreAfterProfiles,
} from "@/lib/session";
import { isUnauthorizedError, MISSING_KEY_NOTICE } from "@/lib/credential-gate";
import { countLabel, detectLocale, resolveLocale, t } from "@/lib/locale";
import { LanguageSwitcher } from "./language-switcher";
import {
  disableWebPush,
  enableWebPush,
  getPushStatus,
  postPushLookup,
  postPushTest,
  readPushId,
  writePushId,
  type PushStatus,
} from "@/lib/push";
import { canRegisterServiceWorker } from "@/lib/api-helper";

export function SettingsView() {
  const setView = useDesk((s) => s.setView);
  const connection = useDesk((s) => s.connection);
  const setConnection = useDesk((s) => s.setConnection);
  const setProbe = useDesk((s) => s.setProbe);
  const syncHermesProfiles = useDesk((s) => s.syncHermesProfiles);
  const sessionNotice = useDesk((s) => s.sessionNotice);
  const restoreDesk = useDesk((s) => s.restoreDesk);
  const markDisconnected = useDesk((s) => s.markDisconnected);
  const resetOnboarding = useDesk((s) => s.resetOnboarding);
  const locale = resolveLocale(useDesk((s) => s.locale));
  const setLocale = useDesk((s) => s.setLocale);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function test() {
    setBusy(true);
    setNotice(null);
    try {
      const origin = normalizeHttpsOrigin(connection.origin);
      setConnection({ origin, apiKey: connection.apiKey });
      const [catalog, events] = await Promise.all([
        getBotProfiles(origin, connection.apiKey),
        getBotEvents(origin, connection.apiKey, 0),
      ]);
      syncHermesProfiles(catalog.profiles, catalog.capabilities);
      setProbe({
        ok: true,
        at: Date.now(),
        transport: "native-bot",
        profiles: catalog.profiles,
        capabilities: catalog.capabilities,
      });
      resetEventCursor();
      useDesk.setState({ messages: [] });
      markRestorePending();
      const storage = browserStorage();
      const stored = storage ? readDeskSession(origin, storage) : null;
      enableSessionWrites();
      restoreDesk(restoreAfterProfiles({ profiles: catalog.profiles, stored }));
      setNotice(countLabel(locale, catalog.profiles.length, "settings.connectedOne", "settings.connected"));
    } catch (err) {
      if (isUnauthorizedError(err)) markDisconnected();
      setNotice(isUnauthorizedError(err) ? t(locale, "error.missingKey") : friendlyConnectError(err, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-bg px-5 pt-4 pb-4">
      <header className="mb-6">
        <h1 className="title-glyph font-display text-2xl font-semibold">{t(locale, "settings.title")}</h1>
      </header>

      <section className="rounded-2xl border border-border bg-bg-elevated p-4">
        <h2 className="text-sm font-medium">{t(locale, "settings.connection")}</h2>
        <p className="hermes-copy mt-1 text-xs text-muted">{t(locale, "settings.connectionBody")}</p>
        {sessionNotice === MISSING_KEY_NOTICE ? (
          <p className="mt-2 text-sm text-danger">{t(locale, "error.missingKey")}</p>
        ) : null}
        <p className="mt-2 text-xs leading-relaxed text-muted">{t(locale, "settings.lanHelp")}</p>
        <label className="mt-4 block text-xs text-muted">{t(locale, "settings.origin")}</label>
        <input
          value={connection.origin}
          onChange={(e) => setConnection({ origin: e.target.value })}
          placeholder="https://your-machine.ts.net"
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
        />
        <label className="mt-3 block text-xs text-muted">{t(locale, "settings.key")}</label>
        <input
          type="password"
          value={connection.apiKey}
          onChange={(e) => setConnection({ apiKey: e.target.value })}
          placeholder={t(locale, "settings.key")}
          autoComplete="off"
          className="mt-1 h-11 w-full rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
        />
        <button
          type="button"
          onClick={() => void test()}
          disabled={busy}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t(locale, "settings.connect")}
        </button>
        {notice ? <p className="mt-3 text-xs leading-relaxed text-muted">{notice}</p> : null}
        {connection.lastProbe ? (
          <p className="mt-2 text-xs text-subtle">
            {connection.lastProbe.ok
              ? countLabel(
                  locale,
                  connection.lastProbe.profiles.length,
                  "settings.connectedOne",
                  "settings.connected",
                )
              : t(locale, "settings.notConnected")}
          </p>
        ) : null}
        <p className="mt-3 text-xs leading-relaxed text-subtle">{t(locale, "settings.keyHelp")}</p>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-bg-elevated p-4">
        <LanguageSwitcher
          locale={locale}
          onChange={(next) => setLocale(detectLocale({ stored: next }))}
          label={t(locale, "settings.language")}
        />
      </section>

      <PushPanel origin={connection.origin} apiKey={connection.apiKey} locale={locale} />

      <section className="mt-4 rounded-2xl border border-border bg-bg-elevated p-4">
        <h2 className="text-sm font-medium">{t(locale, "settings.about")}</h2>
        <p className="hermes-copy mt-2 text-xs text-muted">{t(locale, "settings.aboutBody")}</p>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-bg-elevated p-4">
        <h2 className="text-sm font-medium">{t(locale, "settings.how")}</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          <li>{t(locale, "settings.howOffline")}</li>
          <li>{t(locale, "settings.howAttach")}</li>
          <li>{t(locale, "settings.howPush")}</li>
        </ul>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-bg-elevated p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="size-4" />
          {t(locale, "settings.install")}
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-muted">
          <li>
            <span className="text-fg">Android · Chrome</span>
            {t(locale, "settings.android")}
          </li>
          <li>
            <span className="text-fg">iPhone · Safari</span>
            {t(locale, "settings.ios")}
          </li>
        </ol>
      </section>

      <button
        type="button"
        onClick={() => {
          resetOnboarding();
          setView("roster");
        }}
        className="mt-4 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
      >
        {t(locale, "settings.reconnect")}
      </button>
    </section>
  );
}

function PushPanel({
  origin,
  apiKey,
  locale,
}: {
  origin: string;
  apiKey: string;
  locale: ReturnType<typeof resolveLocale>;
}) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ready = Boolean(origin && apiKey);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const st = await getPushStatus(origin, apiKey);
        if (cancelled) return;
        setStatus(st);
        let found = readPushId(origin);
        if (!found && canRegisterServiceWorker()) {
          const reg = await navigator.serviceWorker.getRegistration("/");
          const sub = await reg?.pushManager.getSubscription();
          if (sub?.endpoint) {
            const looked = await postPushLookup(origin, apiKey, sub.endpoint);
            if (looked?.id) {
              found = looked.id;
              writePushId(origin, found);
            }
          }
        }
        if (!cancelled) setId(found);
      } catch (err) {
        if (!cancelled) setNote(err instanceof Error ? err.message : t(locale, "push.readFail"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [origin, apiKey, ready]);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const result = await enableWebPush(origin, apiKey);
      setId(result.id);
      setStatus((s) =>
        s
          ? { ...s, sourceReady: result.sourceReady, subscriptions: s.subscriptions + (id ? 0 : 1) }
          : { publicKey: "", sourceReady: result.sourceReady, subscriptions: 1, failedDeliveries: 0 },
      );
      setNote(result.sourceReady ? t(locale, "push.enabledReady") : t(locale, "push.enabledNotReady"));
    } catch (err) {
      setNote(err instanceof Error ? err.message : t(locale, "push.enableFail"));
    } finally {
      setBusy(false);
    }
  }

  async function testPush() {
    if (!id) return;
    setBusy(true);
    setNote(null);
    try {
      await postPushTest(origin, apiKey, id);
      setNote(t(locale, "push.testSent"));
    } catch (err) {
      setNote(err instanceof Error ? err.message : t(locale, "push.testFail"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote(null);
    try {
      await disableWebPush(origin, apiKey, id);
      setId("");
      setNote(t(locale, "push.disabledNote"));
    } catch (err) {
      setNote(err instanceof Error ? err.message : t(locale, "push.unsubFail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-border bg-bg-elevated p-4">
      <h2 className="text-sm font-medium">{t(locale, "push.title")}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">{t(locale, "push.body")}</p>
      {status ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {id ? t(locale, "push.enabled") : t(locale, "push.disabled")}{" "}
          {status.sourceReady ? t(locale, "push.serverReady") : t(locale, "push.serverNotReady")}
        </p>
      ) : (
        <p className="mt-3 text-xs text-subtle">
          {ready ? t(locale, "push.checking") : t(locale, "push.connectFirst")}
        </p>
      )}
      {status && !status.sourceReady ? (
        <p className="mt-2 text-xs text-danger">{t(locale, "push.serverWarn")}</p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2">
        {id ? (
          <>
            <button
              type="button"
              onClick={() => void testPush()}
              disabled={busy || !status?.sourceReady}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
              {t(locale, "push.test")}
            </button>
            <button
              type="button"
              onClick={() => void disable()}
              disabled={busy}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm text-muted"
            >
              <BellOff className="size-4" />
              {t(locale, "push.disable")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy || !ready}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
            {t(locale, "push.enable")}
          </button>
        )}
      </div>
      {note ? <p className="mt-2 text-xs leading-relaxed text-muted">{note}</p> : null}
    </section>
  );
}
