import test from "node:test";
import assert from "node:assert/strict";
import { projectTaskPlan } from "./task-plan.ts";

const ended = Date.parse("2026-09-09T00:00:00Z");
const state = { revision: 2, updatedAt: "2026-09-08T23:59:00Z", todos: [
  { id: "one", content: "Read inputs", status: "completed" },
  { id: "two", content: "Write result", status: "in_progress" },
] };

test("a completed run does not fabricate success for an unfinished todo snapshot", () => {
  const source = structuredClone(state);
  const view = projectTaskPlan({ status: "completed", terminalAt: new Date(ended).toISOString(), todoState: source }, ended + 1000);
  assert.equal(view.completed, 1);
  assert.equal(view.notCompleted, 1);
  assert.equal(view.todos[1].displayStatus, "not_completed");
  assert.equal(view.todos[1].status, "in_progress");
  assert.deepEqual(source, state);
  assert.equal(view.fadeRemainingMs, 4000);
});

test("failed and stopped runs stop active todo appearance without calling the todo successful", () => {
  assert.equal(projectTaskPlan({ status: "failed", todoState: state }, ended).todos[1].displayStatus, "run_failed");
  assert.equal(projectTaskPlan({ status: "interrupted", todoState: state }, ended).todos[1].displayStatus, "run_stopped");
  const active = projectTaskPlan({ status: "running", todoState: state }, ended);
  assert.equal(active.todos[1].displayStatus, "in_progress");
  assert.equal(active.settled, false);
});

test("remounts and late todo snapshots cannot restart the terminal fade deadline", () => {
  const task = { status: "completed", terminalAt: new Date(ended).toISOString(), todoState: state };
  assert.equal(projectTaskPlan(task, ended + 3000).fadeRemainingMs, 2000);
  assert.equal(projectTaskPlan(task, ended + 3000).opacity, 0.4);
  assert.equal(projectTaskPlan({ ...task, todoState: { ...state, updatedAt: new Date(ended + 60_000).toISOString() } }, ended + 6000).fadeRemainingMs, 0);
  assert.equal(projectTaskPlan({ status: "completed", todoState: state }, ended).fadeRemainingMs, 0);
});

test("all-done todo plans retain their own stable fade while a run finishes its reply", () => {
  const todoState = { ...state, updatedAt: new Date(ended).toISOString(), todos: state.todos.map((todo) => ({ ...todo, status: "completed" })) };
  const view = projectTaskPlan({ status: "running", todoState }, ended + 2000);
  assert.equal(view.completed, 2);
  assert.equal(view.fadeRemainingMs, 3000);
});
