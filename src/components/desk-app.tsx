import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { MessageSquare, Settings } from "lucide-react";
import { Onboarding } from "./onboarding";
import { Roster } from "./roster";
import { ChatView } from "./chat-view";
import { SettingsView } from "./settings-view";
import { LaunchScreen } from "./launch-screen";
import { useDesk } from "@/lib/store";
import { readPassword, stripKeysFromPersist } from "@/lib/secrets";
import { registerHermesServiceWorker } from "@/lib/api-helper";
import { startHermesRuntime, resetEventCursor } from "@/lib/runtime";
import { bindVisualViewport, setAppLayout, appLayoutFromState } from "@/lib/viewport";
import {
  browserStorage,
  captureDeskSession,
  readDeskSession,
  restoreAfterProfiles,
  sessionWritesEnabled,
  writeDeskSession,
} from "@/lib/session";
import { MISSING_KEY_NOTICE, sanitizeHydratedConnection } from "@/lib/credential-gate";
import { APP_BRAND, detectLocale, htmlLang, resolveLocale, t } from "@/lib/locale";
import { sanitizeStoredMessages } from "@/lib/history";
import { sanitizeStoredApprovals } from "@/lib/approvals";
import { cn } from "@/lib/utils";
import { deepLinkFromPwaSearch, stripPwaLocationSecrets } from "@/lib/origin";
import { consumeSetupBootstrap } from "@/lib/local-setup";
import { getBotProfiles } from "@/lib/native-bot";

export function DeskApp() {
  const onboarded = useDesk((s) => s.onboarded);
  const view = useDesk((s) => s.view);
  const setView = useDesk((s) => s.setView);
  const bots = useDesk((s) => s.bots);
  const locale = resolveLocale(useDesk((s) => s.locale));
  const [hydrated, setHydrated] = useState(false);
  const [launch, setLaunch] = useState(true);
  const dismissLaunch = useCallback(() => setLaunch(false), []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = APP_BRAND;
    document.documentElement.lang = htmlLang(locale);
  }, [locale]);

  useEffect(() => {
    stripKeysFromPersist();
    const persist = useDesk.persist;
    if (!persist) {
      setHydrated(true);
      return;
    }
    let finishing = false;
    const finish = () => {
      if (finishing) return;
      finishing = true;
      void (async () => {
      const bootstrap = await consumeSetupBootstrap();
      if (bootstrap) {
        const catalog = await getBotProfiles(bootstrap.origin, bootstrap.apiKey);
        useDesk.getState().setConnection({ origin: bootstrap.origin, apiKey: bootstrap.apiKey });
        useDesk.getState().syncHermesProfiles(catalog.profiles, catalog.capabilities);
        useDesk.getState().setProbe({
          ok: true,
          at: Date.now(),
          transport: "native-bot",
          profiles: catalog.profiles,
          capabilities: catalog.capabilities,
        });
        useDesk.getState().completeOnboarding();
      }
      const origin = useDesk.getState().connection.origin;
      const secret = readPassword(origin);
      useDesk.setState((s) => ({
        connection: sanitizeHydratedConnection(s.connection, secret),
        messages: sanitizeStoredMessages(s.messages),
        approvals: sanitizeStoredApprovals(s.approvals),
      }));
      const storage = browserStorage();
      const stored = storage && origin ? readDeskSession(origin, storage) : null;
      const query = deepLinkFromPwaSearch(typeof window !== "undefined" ? window.location.search : "");
      if (stored || query.profile) {
        useDesk.getState().restoreDesk(
          restoreAfterProfiles({
            profiles: useDesk.getState().bots.map((b) => ({ name: b.profile })),
            stored,
            query,
          }),
        );
      }
      stripPwaLocationSecrets();
      if (origin && !secret.trim()) useDesk.getState().markDisconnected();
      const current = useDesk.getState();
      if (current.locale !== "en" && current.locale !== "zh-Hant") {
        useDesk.setState({
          locale: detectLocale({
            language: typeof navigator !== "undefined" ? navigator.language : "",
            onboarded: current.onboarded,
          }),
        });
      }
      const locale = resolveLocale(useDesk.getState().locale);
      if (typeof document !== "undefined") {
        document.title = APP_BRAND;
        document.documentElement.lang = htmlLang(locale);
      }
      resetEventCursor();
      setHydrated(true);
      })().catch(() => {
        setHydrated(true);
      });
    };
    const unsub = persist.onFinishHydration(finish);
    if (persist.hasHydrated()) finish();
    else void persist.rehydrate();
    void registerHermesServiceWorker();
    return unsub;
  }, []);

  useLayoutEffect(() => {
    setAppLayout(appLayoutFromState(onboarded, hydrated));
  }, [onboarded, hydrated]);

  useEffect(() => bindVisualViewport(), []);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    return useDesk.subscribe((s) => {
      if (!sessionWritesEnabled()) return;
      if (!s.connection.apiKey.trim()) return;
      if (s.sessionNotice === MISSING_KEY_NOTICE) return;
      const storage = browserStorage();
      if (!storage || !s.connection.origin) return;
      const bot = s.bots.find((b) => b.id === s.activeBotId);
      writeDeskSession(
        captureDeskSession({
          origin: s.connection.origin,
          view: s.view,
          profile: bot?.profile ?? null,
          conversation: bot?.conversation ?? null,
          conversations: Object.fromEntries(
            s.bots.filter((b) => b.conversation).map((b) => [b.profile, b.conversation]),
          ),
          drafts: Object.fromEntries(
            s.bots
              .map((b) => [b.profile, s.composerDrafts[b.id] ?? ""] as const)
              .filter((entry) => entry[1]),
          ),
        }),
        storage,
      );
    });
  }, [hydrated, onboarded]);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    return startHermesRuntime();
  }, [hydrated, onboarded]);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    const apply = (profile: string, session?: string) => {
      if (!profile) return;
      const ok = useDesk.getState().openFromPush(profile, session);
      if (ok && session) resetEventCursor();
    };
    const params = deepLinkFromPwaSearch(window.location.search);
    apply(params.profile ?? "", params.session ?? undefined);
    stripPwaLocationSecrets();
    const onMsg = (event: MessageEvent) => {
      const data = event.data as { type?: string; profile?: string; sessionId?: string };
      if (data?.type !== "open-session") return;
      apply(data.profile ?? "", data.sessionId);
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [hydrated, onboarded, bots.length]);

  const showTabs = hydrated && onboarded && view !== "chat";

  let main: ReactNode;
  if (!hydrated) {
    main = <div className="setup-page bg-bg" aria-hidden />;
  } else if (!onboarded) {
    main = <Onboarding />;
  } else {
    main = (
      <div className="app-shell viewport-root mx-auto flex max-w-6xl flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <Roster
            className={
              view === "roster"
                ? "flex h-full min-h-0 w-full md:w-80 md:shrink-0 md:border-r md:border-border"
                : "hidden h-full min-h-0 md:flex md:w-80 md:shrink-0 md:border-r md:border-border"
            }
          />
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {view === "settings" ? (
              <SettingsView />
            ) : view === "chat" ? (
              <ChatView />
            ) : (
              <div className="hidden h-full items-center justify-center md:flex">
                <p className="max-w-xs text-center text-sm text-muted">{t(locale, "chat.pickToStart")}</p>
              </div>
            )}
          </div>
        </div>
        {showTabs ? (
          <nav className="z-30 flex shrink-0 border-t border-border bg-bg/95 px-4 py-1 md:hidden">
            <TabButton
              label={t(locale, "desk.tabRoster")}
              active={view === "roster"}
              onClick={() => setView("roster")}
              icon={<MessageSquare className="size-5" strokeWidth={1.8} />}
            />
            <TabButton
              label={t(locale, "desk.tabSettings")}
              active={view === "settings"}
              onClick={() => setView("settings")}
              icon={<Settings className="size-5" strokeWidth={1.8} />}
            />
          </nav>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {launch ? <LaunchScreen onDone={dismissLaunch} /> : null}
      {main}
    </>
  );
}

function TabButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium",
        active ? "text-fg" : "text-subtle",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
