export type JobExecution = {
  id: string;
  status: "claimed" | "running" | "completed" | "failed" | "unknown";
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};
export type ScheduleJob = {
  id: string;
  name: string;
  prompt: string;
  schedule_display?: string;
  enabled: boolean;
  next_run_at: string | null;
  latest_execution: JobExecution | null;
};
export function executionKey(job: ScheduleJob) {
  return `${job.id}:${job.latest_execution?.id ?? ""}`;
}
export function activeExecution(job: ScheduleJob) {
  return ["claimed", "running"].includes(job.latest_execution?.status ?? "");
}
export function freshTerminal(job: ScheduleJob, now: number) {
  const e = job.latest_execution;
  const finished = Date.parse(e?.finished_at ?? "");
  return (
    !!e &&
    ["completed", "failed"].includes(e.status) &&
    Number.isFinite(finished) &&
    now >= finished &&
    now - finished < 30000
  );
}
export function shouldRevealJob(
  job: ScheduleJob,
  previous: ScheduleJob | undefined,
  initialized: boolean,
  now: number,
) {
  if (activeExecution(job)) return true;
  return (
    initialized &&
    freshTerminal(job, now) &&
    (!previous ||
      executionKey(previous) !== executionKey(job) ||
      previous.latest_execution?.status !== job.latest_execution?.status)
  );
}
