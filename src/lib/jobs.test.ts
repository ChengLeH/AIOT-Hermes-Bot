import test from "node:test";
import assert from "node:assert/strict";
import { shouldRevealJob, freshTerminal, type ScheduleJob } from "./jobs.ts";
const now = Date.now();
const job: ScheduleJob = {
  id: "j",
  name: "demo",
  prompt: "",
  enabled: true,
  next_run_at: null,
  latest_execution: {
    id: "e",
    status: "completed",
    started_at: null,
    finished_at: new Date(now).toISOString(),
    error: null,
  },
};
test("baseline completion does not pop; real running and transition do", () => {
  assert.equal(shouldRevealJob(job, undefined, false, now), false);
  const running = {
    ...job,
    latest_execution: { ...job.latest_execution!, status: "running" as const },
  };
  assert.equal(shouldRevealJob(running, undefined, false, now), true);
  assert.equal(shouldRevealJob(job, running, true, now), true);
  assert.equal(shouldRevealJob(job, job, true, now), false);
});
test("terminal visibility anchored to finished time, not polling", () => {
  assert.equal(freshTerminal(job, now + 29999), true);
  assert.equal(freshTerminal(job, now + 30000), false);
  assert.equal(
    freshTerminal(
      { ...job, latest_execution: { ...job.latest_execution!, finished_at: null } },
      now,
    ),
    false,
  );
});
