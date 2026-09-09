import * as BotSelect from "@radix-ui/react-select";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Pause, Play, Plus, Trash2 } from "lucide-react";
import { BotAvatar } from "./bot-avatar";
import { hermesFetch } from "@/lib/hermes-fetch";
import {
  activeExecution,
  executionKey,
  freshTerminal,
  shouldRevealJob,
  type ScheduleJob,
} from "@/lib/jobs";
import { useDesk } from "@/lib/store";
import type { Locale } from "@/lib/locale";
export type ScheduleDockHandle = { collapse: () => boolean };
export const ScheduleDock = forwardRef<
  ScheduleDockHandle,
  { profile: string; name: string; swatch: string; origin: string; apiKey: string; locale: Locale; onExpandedChange?: (expanded: boolean) => void }
>(function ScheduleDock({ profile, swatch, origin, apiKey, locale, onExpandedChange }, ref) {
  const en = locale === "en";
  const bots = useDesk((s) => s.bots);
  const [targetProfile, setTargetProfile] = useState(profile);
  const [botMenuOpen, setBotMenuOpen] = useState(false);
  const botMenuClosedAt = useRef(0);
  const submitting = useRef(false);
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [available, setAvailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [frequency, setFrequency] = useState("once");
  const [now, setNow] = useState(Date.now());
  const card = useRef<HTMLDivElement>(null);
  const oldJobs = useRef<ScheduleJob[]>([]);
  const initialized = useRef(false);
  const seen = useRef(new Set<string>());
  const expandedRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const url = `${origin}/api/bot/native/jobs?profile=${encodeURIComponent(profile)}`;
  const open = useCallback(() => {
    if (expandedRef.current) return;
    expandedRef.current = true;
    window.history.pushState(
      {
        ...window.history.state,
        aiotView: "chat",
        aiotApprovalDock: undefined,
        aiotScheduleDock: profile,
      },
      "",
    );
    setExpanded(true);
    onExpandedChange?.(true);
  }, [profile, onExpandedChange]);
  const collapse = useCallback(
    (fromHistory = false) => {
      if (
        !expandedRef.current ||
        (!fromHistory && window.history.state?.aiotScheduleDock !== profile)
      )
        return false;
      expandedRef.current = false;
      setExpanded(false);
      onExpandedChange?.(false);
      if (!fromHistory && window.history.state?.aiotScheduleDock === profile) window.history.back();
      return true;
    },
    [profile, onExpandedChange],
  );
  useImperativeHandle(ref, () => ({ collapse: () => collapse() }));
  useEffect(() => {
    const pop = () => {
      if (window.history.state?.aiotScheduleDock !== profile) collapse(true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedRef.current) {
        e.preventDefault();
        collapse();
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", key);
    };
  }, [profile, collapse]);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const res = await hermesFetch(url, { apiKey, timeoutMs: 6500, signal: controller.signal });
        if (disposed) return;
        if (!res.ok) {
          setAvailable(false);
          return;
        }
        const raw = await res.json();
        if (disposed || !Array.isArray(raw.jobs)) return;
        const next = raw.jobs as ScheduleJob[];
        setAvailable(true);
        setJobs(next);
        for (const job of next) {
          const key = executionKey(job);
          if (
            !seen.current.has(key) &&
            shouldRevealJob(
              job,
              oldJobs.current.find((j) => j.id === job.id),
              initialized.current,
              Date.now(),
            )
          ) {
            seen.current.add(key);
            setSelected(job.id);
            open();
          }
        }
        oldJobs.current = next;
        initialized.current = true;
      } catch {
        if (!disposed) setAvailable(false);
      } finally {
        pending = false;
      }
    }
    refreshRef.current = () => void refresh();
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [url, apiKey, open]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = jobs.find((j) => j.id === selected);
  const terminal =
    current?.latest_execution && ["completed", "failed"].includes(current.latest_execution.status);
  useEffect(() => {
    if (current && terminal && !freshTerminal(current, now)) {
      collapse();
      const timer = setTimeout(() => setSelected(null), 650);
      return () => clearTimeout(timer);
    }
  }, [current, terminal, now, collapse]);
  async function action(path: string, payload: Record<string, string> = {}, method = "POST") {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await hermesFetch(path, {
        apiKey,
        method,
        timeoutMs: 7000,
        headers: { "Content-Type": "application/json" },
        ...(method !== "DELETE" ? { body: JSON.stringify(payload) } : {}),
      });
      if (!res.ok) {
        if (res.status === 424) refreshRef.current();
        throw new Error();
      }
      setCreating(false);
      refreshRef.current();
      return true;
    } catch {
      setError(en ? "Could not update schedule. Please try again." : "無法更新排程，請重試。");
      return false;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function removeJob(job: ScheduleJob) {
    if (activeExecution(job)) {
      const paused = await action(
        `${origin}/api/bot/native/jobs/${encodeURIComponent(job.id)}/pause?profile=${encodeURIComponent(profile)}`,
      );
      if (!paused) return;
    }
    await action(
      `${origin}/api/bot/native/jobs/${encodeURIComponent(job.id)}?profile=${encodeURIComponent(profile)}`,
      {},
      "DELETE",
    );
  }
  if (!available) return null;
  const labels = {
    claimed: en ? "Waiting to run" : "等待執行",
    running: en ? "Working" : "工作中",
    completed: en ? "Completed" : "已完成",
    failed: en ? "Failed" : "失敗",
    unknown: en ? "Status unconfirmed" : "狀態未確認",
  };
  const status = current
    ? !current.enabled
      ? en
        ? "Paused"
        : "已暫停"
      : labels[current.latest_execution?.status ?? "unknown"]
    : en
      ? "Schedules"
      : "排程工作";
  return (
    <div
      className={`approval-dock-slot schedule-slot${expanded ? " schedule-slot-expanded" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={card}
        className={`approval-dock ${!current ? "schedule-idle" : ""} ${expanded ? "approval-dock-expanded" : "approval-dock-compact"}`}
      >
        <button
          type="button"
          className="approval-dock-heading"
          onClick={() => (expanded ? collapse() : open())}
          aria-expanded={expanded}
        >
          {current ? (
            <span className="approval-mascot">
              <BotAvatar profile={profile} swatch={swatch} size={expanded ? 38 : 14} />
            </span>
          ) : (
            <CalendarClock size={16} />
          )}
          <span className="approval-dock-label">
            <strong>{current?.name || `${status} (${jobs.length})`}</strong>
            {current && <span role="status">{status}</span>}
          </span>
          {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
        {expanded && (
          <div className="approval-dock-body schedule-body">
            {current && (
              <div
                className={`schedule-result ${current.latest_execution?.status === "failed" ? "schedule-result-failed" : ""}`}
                role="status"
              >
                {status}
                {current.latest_execution?.finished_at && (
                  <time>
                    {" "}
                    ·{" "}
                    {new Date(current.latest_execution.finished_at).toLocaleTimeString(
                      en ? "en" : "zh-TW",
                    )}
                  </time>
                )}
              </div>
            )}
            {current?.prompt && <p className="schedule-prompt">{current.prompt}</p>}
            {jobs.map((job) => (
              <div className="schedule-row" key={job.id}>
                <CalendarClock size={16} />
                <div className="schedule-label">
                  <strong>{job.name}</strong>
                  <small>
                    {job.schedule_display} ·{" "}
                    {!job.enabled
                      ? en
                        ? "Paused"
                        : "已暫停"
                      : job.next_run_at
                        ? new Date(job.next_run_at).toLocaleString(en ? "en" : "zh-TW")
                        : en
                          ? "No next run"
                          : "沒有下次執行時間"}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={job.enabled ? (en ? "Pause" : "暫停") : en ? "Resume" : "恢復"}
                  onClick={() =>
                    void action(
                      `${origin}/api/bot/native/jobs/${encodeURIComponent(job.id)}/${job.enabled ? "pause" : "resume"}?profile=${encodeURIComponent(profile)}`,
                    )
                  }
                >
                  {job.enabled ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  type="button"
                  disabled={busy || activeExecution(job)}
                  onClick={() =>
                    void action(
                      `${origin}/api/bot/native/jobs/${encodeURIComponent(job.id)}/run?profile=${encodeURIComponent(profile)}`,
                    )
                  }
                >
                  {en ? "Run" : "執行"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={en ? "Delete schedule" : "刪除排程"}
                  onClick={() => void removeJob(job)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!jobs.length && <p>{en ? "No scheduled jobs yet." : "目前沒有排程工作。"}</p>}
            <button type="button" onClick={() => setCreating(!creating)}>
              <Plus size={14} />
              {en ? "New schedule" : "新增排程"}
            </button>
            {creating && (
              <form
                className="schedule-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const time = new Date(String(data.get("schedule")));
                  const target = useDesk
                    .getState()
                    .bots.find((b) => b.profile === targetProfile && b.available);
                  if (!target) {
                    setError(en ? "Choose an available Bot." : "請選擇可用的 Bot。");
                    return;
                  }
                  if (!String(data.get("name")).trim() || !String(data.get("prompt")).trim()) {
                    setError(en ? "Enter a name and task." : "請填寫名稱與任務內容。");
                    return;
                  }
                  if (
                    frequency === "once" &&
                    (!Number.isFinite(time.getTime()) || time.getTime() <= Date.now())
                  ) {
                    setError(en ? "Choose a future time." : "請選擇尚未到達的執行時間。");
                    return;
                  }
                  const minutes = Number(data.get("minutes"));
                  if (
                    frequency !== "once" &&
                    (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200)
                  ) {
                    setError(
                      en ? "Enter 1–43200 whole minutes." : "請輸入 1 至 43200 的整數分鐘。",
                    );
                    return;
                  }
                  const created = await action(
                    `${origin}/api/bot/native/jobs?profile=${encodeURIComponent(target.profile)}`,
                    {
                      name: String(data.get("name")),
                      prompt: String(data.get("prompt")),
                      schedule:
                        frequency === "once" ? time.toISOString() : `every ${data.get("minutes")}m`,
                    },
                  );
                  if (created && target.profile !== profile) {
                    collapse();
                    useDesk.getState().openBot(target.id);
                  }
                }}
              >
                <div className="schedule-bot-field">
                  <span id="schedule-bot-label">{en ? "Bot" : "執行的 Bot"}</span>
                  <BotSelect.Root
                    open={botMenuOpen}
                    onOpenChange={(next) => {
                      if (next && Date.now() - botMenuClosedAt.current < 300) return;
                      setBotMenuOpen(next);
                    }}
                    value={targetProfile}
                    onValueChange={setTargetProfile}
                    disabled={busy}
                  >
                    <BotSelect.Trigger
                      onPointerDownCapture={(event) => {
                        if (botMenuOpen || Date.now() - botMenuClosedAt.current < 300) {
                          event.preventDefault();
                          event.stopPropagation();
                          botMenuClosedAt.current = Date.now();
                          setBotMenuOpen(false);
                        }
                      }}
                      aria-labelledby="schedule-bot-label"
                      className="schedule-bot-trigger"
                    >
                      <BotSelect.Value />{" "}
                      <BotSelect.Icon>
                        {botMenuOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </BotSelect.Icon>
                    </BotSelect.Trigger>
                    <BotSelect.Portal>
                      <BotSelect.Content
                        onPointerDownOutside={() => {
                          botMenuClosedAt.current = Date.now();
                          setBotMenuOpen(false);
                        }}
                        className="schedule-bot-menu"
                        position="popper"
                        sideOffset={5}
                      >
                        <BotSelect.Viewport>
                          {bots.map((bot) => (
                            <BotSelect.Item
                              className="schedule-bot-option"
                              key={bot.id}
                              value={bot.profile}
                              disabled={!bot.available}
                            >
                              <BotSelect.ItemText>
                                <span className="schedule-bot-option-label">
                                  <BotAvatar profile={bot.profile} swatch={bot.swatch} size={26} />
                                  <span>
                                    {bot.name}
                                    {!bot.available ? (en ? " (Unavailable)" : "（無法使用）") : ""}
                                  </span>
                                </span>
                              </BotSelect.ItemText>
                            </BotSelect.Item>
                          ))}
                        </BotSelect.Viewport>
                      </BotSelect.Content>
                    </BotSelect.Portal>
                  </BotSelect.Root>
                </div>
                <input
                  name="name"
                  required
                  maxLength={200}
                  aria-label={en ? "Name" : "名稱"}
                  placeholder={en ? "Name" : "名稱"}
                />
                <textarea
                  name="prompt"
                  required
                  maxLength={5000}
                  aria-label={en ? "Task instructions" : "任務內容"}
                  placeholder={en ? "What should this Bot do?" : "要讓這位 Bot 做什麼？"}
                />
                <select
                  aria-label={en ? "Frequency" : "頻率"}
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                >
                  <option value="once">{en ? "Once" : "單次"}</option>
                  <option value="interval">{en ? "Recurring" : "重複執行"}</option>
                </select>
                {frequency === "once" ? (
                  <label>
                    {en ? "Run once at (your local time)" : "單次執行時間（你的當地時間）"}
                    <input
                      name="schedule"
                      type="datetime-local"
                      min={new Date(now - new Date(now).getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16)}
                      required
                    />
                  </label>
                ) : (
                  <label>
                    {en ? "Repeat every (minutes)" : "每隔幾分鐘執行"}
                    <input
                      name="minutes"
                      type="number"
                      min={1}
                      max={43200}
                      defaultValue={60}
                      required
                    />
                  </label>
                )}
                <button type="submit" disabled={busy}>
                  {en ? "Create" : "建立"}
                </button>
              </form>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
});
