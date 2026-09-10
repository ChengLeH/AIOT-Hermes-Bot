import { useBackgroundTheme } from "@/lib/background-theme";
import { requestTaskDeepLink } from "@/lib/task-deep-link";
import { startPushPresence } from "@/lib/push-presence";
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Bot, Settings } from "lucide-react";
import { Onboarding } from "./onboarding";
import { Roster } from "./roster";
import { ChatView } from "./chat-view";
import { SettingsView } from "./settings-view";
import { LaunchScreen } from "./launch-screen";
import { useDesk } from "@/lib/store";
import { readPassword, stripKeysFromPersist, credentialStorageUnavailable } from "@/lib/secrets";
import { registerHermesServiceWorker } from "@/lib/api-helper";
import { startHermesRuntime, resetEventCursor } from "@/lib/runtime";
import { bindVisualViewport, setAppLayout, appLayoutFromState } from "@/lib/viewport";
import {
  captureDeskSession,
  readBrowserDeskSession,
  restoreAfterProfiles,
  sessionWritesEnabled,
  writeBrowserDeskSession,
} from "@/lib/session";
import { MISSING_KEY_NOTICE, sanitizeHydratedConnection } from "@/lib/credential-gate";
import { APP_BRAND, detectLocale, htmlLang, resolveLocale, t } from "@/lib/locale";
import { sanitizeStoredMessages } from "@/lib/history";
import { liveBotMessages, settleOrphanPending } from "@/lib/bot-window";
import { sanitizeStoredApprovals } from "@/lib/approvals";
import { cn } from "@/lib/utils";
import { deepLinkFromPwaSearch, stripPwaLocationSecrets } from "@/lib/origin";
import { consumeSetupBootstrap } from "@/lib/local-setup";
import { getBotProfiles } from "@/lib/native-bot";
import { historyView, pushChatHistory, seedAppHistory } from "@/lib/app-history";
import { bindPortraitOrientation } from "@/lib/orientation";

export function DeskApp() {
  const wallpaper = useBackgroundTheme();
  useEffect(() => {
    document.documentElement.style.setProperty("--aiot-wallpaper-image", wallpaper ? `url("${wallpaper.dataUrl}")` : "none");
    document.body.dataset.aiotWallpaper = wallpaper ? "true" : "false";
    return () => {
      document.documentElement.style.removeProperty("--aiot-wallpaper-image");
      delete document.body.dataset.aiotWallpaper;
    };
  }, [wallpaper]);
  const [hydrated, setHydrated] = useState(false);
  const pushOrigin = useDesk((s) => s.connection.origin);
  const pushKey = useDesk((s) => s.connection.apiKey);
  useEffect(() => {
    if (!hydrated) return;
    return startPushPresence(pushOrigin, pushKey);
  }, [hydrated, pushOrigin, pushKey]);
  const onboarded = useDesk((s) => s.onboarded);
  const view = useDesk((s) => s.view);
  const setView = useDesk((s) => s.setView);
  const bots = useDesk((s) => s.bots);
  const locale = resolveLocale(useDesk((s) => s.locale));
  const [launch, setLaunch] = useState(true);
  const [portraitFallback, setPortraitFallback] = useState(false);
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
        useDesk.getState().confirmMessageOrigin(bootstrap.origin);
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
      const secret = await readPassword(origin);
      if (credentialStorageUnavailable()) useDesk.getState().pushNotice(useDesk.getState().locale === "en" ? "Secure key storage is unavailable. Enter your key again after closing this page." : "無法使用安全金鑰儲存；關閉此頁面後需要重新輸入金鑰。");
      useDesk.setState((s) => ({
        view: "roster",
        connection: sanitizeHydratedConnection(s.connection, secret),
        messages: settleOrphanPending(liveBotMessages(sanitizeStoredMessages(s.messages))),
        approvals: sanitizeStoredApprovals(s.approvals),
      }));
      const stored = origin ? await readBrowserDeskSession(origin) : null;
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
  useEffect(() => bindPortraitOrientation(setPortraitFallback), []);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    seedAppHistory(view);
    const onPopState = (event: PopStateEvent) => {
      let target = historyView(event.state);
      // Repair parent entries left by older builds before roster tabs synced history.
      if (target === "settings" && useDesk.getState().view === "chat") {
        seedAppHistory("roster");
        target = "roster";
      }
      if (target === "chat" && useDesk.getState().activeBotId) setView("chat");
      else if (target === "settings") setView("settings");
      else setView("roster");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [hydrated, onboarded, setView, view]);

  useEffect(() => {
    if (!hydrated || !onboarded || view !== "chat") return;
    if (historyView(window.history.state) !== "chat") pushChatHistory();
  }, [hydrated, onboarded, view]);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    return useDesk.subscribe((s) => {
      if (!sessionWritesEnabled()) return;
      if (!s.connection.apiKey.trim()) return;
      if (s.sessionNotice === MISSING_KEY_NOTICE) return;
      if (!s.connection.origin) return;
      const bot = s.bots.find((b) => b.id === s.activeBotId);
      void writeBrowserDeskSession(
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
      ).catch(() => {
        // Fail closed: the in-memory desk keeps working without a plaintext fallback.
      });
    });
  }, [hydrated, onboarded]);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    return startHermesRuntime();
  }, [hydrated, onboarded]);

  useEffect(() => {
    if (!hydrated || !onboarded) return;
    const apply = (profile: string, session?: string, taskId?: unknown) => {
      if (!profile) return false;
      const ok = useDesk.getState().openFromPush(profile, session);
      if (ok && session) { resetEventCursor(); requestTaskDeepLink(profile, session, taskId); }
      return ok;
    };
    const params = deepLinkFromPwaSearch(window.location.search);
    const taskId = new URLSearchParams(window.location.search).get("task");
    const opened = apply(params.profile ?? "", params.session ?? undefined, taskId);
    if (taskId && opened) { const url = new URL(window.location.href); url.searchParams.delete("task"); window.history.replaceState(window.history.state, "", url); }
    stripPwaLocationSecrets();
    const onMsg = (event: MessageEvent) => {
      const data = event.data as { type?: string; profile?: string; sessionId?: string; taskId?: string };
      if (data?.type !== "open-session") return;
      apply(data.profile ?? "", data.sessionId, data.taskId);
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
      <div className="app-shell viewport-root flex w-full min-w-0 flex-col overflow-hidden">
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
              icon={<Bot className="size-6" strokeWidth={1.7} />}
            />
            <TabButton
              label={t(locale, "desk.tabSettings")}
              active={view === "settings"}
              onClick={() => setView("settings")}
              icon={<Settings className="size-6" strokeWidth={1.7} />}
            />
          </nav>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {launch ? <LaunchScreen onDone={dismissLaunch} /> : null}
      {portraitFallback ? <div className="fixed inset-0 z-[200] grid place-items-center bg-black px-8 text-center text-white" style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }} role="status" aria-live="polite">
        <p className="max-w-sm text-base font-medium">{locale === "en" ? "Rotate your device to portrait to continue." : "請將裝置轉回直向以繼續使用。"}</p>
      </div> : null}
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
      aria-label={label}
      className={cn(
        "grid h-12 flex-1 place-items-center",
        active ? "text-fg" : "text-subtle",
      )}
    >
      {icon}
    </button>
  );
}
