// One in-memory navigation intent, scoped to its parent Bot. Never carries credentials.
type TaskLink = { profile: string; conversation: string; taskId: string };
let pending: TaskLink | null = null;
const listeners = new Set<() => void>();
export function requestTaskDeepLink(profile: string, conversation: string, taskId: unknown): boolean {
  if (!profile || !conversation || typeof taskId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(taskId)) return false;
  pending = { profile, conversation, taskId };
  for (const listener of listeners) listener();
  return true;
}
export function takeTaskDeepLink(profile: string, conversation: string): { taskId: string } | null {
  if (!pending || pending.profile !== profile || pending.conversation !== conversation) return null;
  const taskId = pending.taskId; pending = null; return { taskId };
}
export function subscribeTaskDeepLink(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
