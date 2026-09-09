// /v1/runs session_id correlates records; it does not restore conversation history.
// Use backend history, never a browser's possibly incomplete transcript.
export async function loadRunContext(fetchImpl, endpoint, conversation) {
  const response = await fetchImpl(`${endpoint.base}/api/sessions/${encodeURIComponent(conversation)}/messages?order=latest&limit=500`, {
    headers: endpoint.headers, redirect: "error", signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error("context_unavailable");
  const value = await response.json();
  if (!Array.isArray(value?.data)) throw new Error("context_unavailable");
  const history = value.data.flatMap((message) => {
    // Runs accepts role/content pairs, not tool-call envelopes. Keep the public
    // conversation; isolated tool results would be invalid without tool_call_id.
    if (!["user", "assistant"].includes(message?.role)) return [];
    const content = typeof message.content === "string" ? message.content
      : Array.isArray(message.content) ? message.content.filter(p => p?.type === "text" && typeof p.text === "string").map(p => p.text).join("\n") : "";
    return content ? [{ role: message.role, content }] : [];
  });
  if (JSON.stringify(history).length > 256 * 1024) throw new Error("context_too_large");
  return history;
}
