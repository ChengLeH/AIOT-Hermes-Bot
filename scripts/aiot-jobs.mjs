const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const text = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
const date = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
export function sanitizeJob(j) {
  if (!j || !ID.test(j.id || "")) return null;
  const e = j.latest_execution;
  return {
    id: j.id,
    name: text(j.name),
    enabled: j.enabled !== false,
    prompt: text(j.prompt, 5000),
    schedule_display: text(j.schedule_display),
    next_run_at: date(j.next_run_at),
    latest_execution:
      e && ID.test(e.id || "")
        ? {
            id: e.id,
            status: ["claimed", "running", "completed", "failed"].includes(e.status)
              ? e.status
              : "unknown",
            started_at: date(e.started_at),
            finished_at: date(e.finished_at),
            error: e.error ? "execution_failed" : null,
          }
        : null,
  };
}
export async function handleJobs({ req, incoming, ep, profile, fetchImpl, readBody }) {
  if (!ep) return { status: 404, value: { error: "jobs_unavailable" } };
  const match = incoming.pathname.match(
    /^\/api\/bot\/native\/jobs(?:\/([a-zA-Z0-9_-]{1,128})(?:\/(pause|resume|run))?)?$/,
  );
  if (!match) return { status: 404, value: { error: "not_found" } };
  let method = req.method,
    payload;
  if (method === "POST") {
    const input = await readBody(req);
    if (!input || typeof input !== "object" || Array.isArray(input))
      return { status: 400, value: { error: "invalid_request" } };
    if (match[1] && !match[2]) return { status: 405, value: { error: "method_not_allowed" } };
    if (match[1]) {
      if (Object.keys(input).length) return { status: 400, value: { error: "invalid_request" } };
      payload = {};
    } else {
      if (
        Object.keys(input).some((k) => !["name", "prompt", "schedule"].includes(k)) ||
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 200 ||
        typeof input.prompt !== "string" ||
        !input.prompt.trim() ||
        input.prompt.length > 5000 ||
        typeof input.schedule !== "string" ||
        !validSchedule(input.schedule)
      )
        return { status: 400, value: { error: "invalid_request" } };
      payload = {
        name: input.name.trim(),
        prompt: input.prompt,
        schedule: input.schedule,
        // Hermes 0.21.1+ routes this execution result back through the
        // selected profile's canonical Bot Chat. The target is derived from
        // the authenticated route, never accepted from browser input.
        deliver: `bot-chat:${profile}`,
      };
    }
  } else if (!(method === "DELETE" && match[1] && !match[2]) && (method !== "GET" || match[1]))
    return { status: 405, value: { error: "method_not_allowed" } };
  const path = match[1]
    ? `/api/jobs/${match[1]}${match[2] ? `/${match[2]}` : ""}`
    : `/api/jobs${method === "GET" ? "?include_disabled=true" : ""}`;
  try {
    const res = await fetchImpl(`${ep.base}${path}`, {
      method,
      headers: { ...ep.headers, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { status: res.status, value: { error: "jobs_request_failed" } };
    const raw = await res.json();
    if (method === "GET") {
      if (!raw || !Array.isArray(raw.jobs))
        return { status: 502, value: { error: "invalid_jobs_response" } };
      return { status: 200, value: { jobs: raw.jobs.map(sanitizeJob).filter(Boolean) } };
    }
    if (method === "DELETE")
      return raw?.ok === true
        ? { status: 200, value: { ok: true } }
        : { status: 502, value: { error: "invalid_jobs_response" } };
    const job = sanitizeJob(raw?.job);
    return job
      ? { status: res.status, value: { job } }
      : { status: 502, value: { error: "invalid_jobs_response" } };
  } catch {
    return { status: 502, value: { error: "jobs_unavailable" } };
  }
}

export function validSchedule(value) {
  if (typeof value !== "string" || value.length > 100) return false;
  const interval = value.match(/^every ([1-9][0-9]{0,4})m$/);
  if (interval) return Number(interval[1]) <= 43200;
  return (
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) > Date.now()
  );
}
