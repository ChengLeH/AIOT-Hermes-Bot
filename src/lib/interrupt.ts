const FORBIDDEN_INTERRUPT_KEYS = ["cwd", "owner", "user_id", "chat_id", "session", "session_key", "file_root", "root", "text", "reason"] as const;

export function canInterrupt(caps: { interrupts?: boolean } | null | undefined): boolean {
  return caps?.interrupts === true;
}

export function interruptBody(input: { profile: string; conversation: string }): { profile: string; conversation: string } {
  return {
    profile: input.profile,
    conversation: input.conversation,
  };
}

export function assertInterruptBodySafe(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.length !== 2) return false;
  if (!keys.includes("profile") || !keys.includes("conversation")) return false;
  if (typeof body.profile !== "string" || typeof body.conversation !== "string") return false;
  return FORBIDDEN_INTERRUPT_KEYS.every((key) => !(key in body));
}

export function interruptAccepted(status: number): boolean {
  return status === 202 || status === 200 || status === 204;
}
