export type SessionTodoState = {
  todos: { id: string; content: string; status: string }[];
  revision?: string | number;
  updatedAt?: string;
};

export const PLAN_FADE_MS = 5000;

/** Project stale todo snapshots against execution state without changing source outcomes. */
export function projectTaskPlan(task: {
  status: string;
  terminalAt?: string;
  todoState: SessionTodoState;
}, now = Date.now()) {
  const terminal = ["completed", "done", "failed", "error", "interrupted", "cancelled", "canceled"].includes(task.status);
  const todos = (Array.isArray(task.todoState.todos) ? task.todoState.todos : []).map((todo) => ({
    ...todo,
    displayStatus: terminal && !["completed", "cancelled"].includes(todo.status)
      ? ["failed", "error"].includes(task.status) ? "run_failed"
        : ["interrupted", "cancelled", "canceled"].includes(task.status) ? "run_stopped" : "not_completed"
      : todo.status,
  }));
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const cancelled = todos.filter((todo) => todo.status === "cancelled").length;
  const notCompleted = terminal ? todos.length - completed - cancelled : 0;
  const settled = terminal || (todos.length > 0 && completed + cancelled === todos.length);
  const endedAt = Date.parse((terminal ? task.terminalAt : task.todoState.updatedAt) || "");
  const fadeRemainingMs = settled && Number.isFinite(endedAt) ? Math.max(0, Math.min(PLAN_FADE_MS, endedAt + PLAN_FADE_MS - now)) : 0;
  return { todos, completed, cancelled, notCompleted, settled, endedAt,
    fadeRemainingMs, opacity: settled ? fadeRemainingMs / PLAN_FADE_MS : 1 };
}
