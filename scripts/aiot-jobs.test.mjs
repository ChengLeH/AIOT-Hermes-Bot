import test from "node:test";
import assert from "node:assert/strict";
import { handleJobs, sanitizeJob } from "./aiot-jobs.mjs";
const options = {
  req: { method: "GET" },
  incoming: new URL("http://local/api/bot/native/jobs?profile=demo"),
  ep: { base: "http://local/p/demo", headers: {}, capabilities: { jobs_admin: false } },
  profile: "demo",
  readBody: async () => ({}),
};
test("probe jobs despite false capabilities and discard private fields", async () => {
  let url;
  const result = await handleJobs({
    ...options,
    fetchImpl: async (u) => {
      url = u;
      return new Response(
        JSON.stringify({
          jobs: [
            {
              id: "job1",
              name: "Demo",
              pid: 123,
              output_path: "/private",
              latest_execution: {
                id: "run1",
                status: "completed",
                finished_at: "2026-01-01T00:00:00Z",
                error: "/private/key",
              },
            },
          ],
        }),
      );
    },
  });
  assert.equal(url, "http://local/p/demo/api/jobs?include_disabled=true");
  assert.equal(result.status, 200);
  assert.equal(result.value.jobs[0].pid, undefined);
  assert.equal(result.value.jobs[0].latest_execution.error, "execution_failed");
});
test("HTML 200 and missing list never imply jobs support", async () => {
  for (const body of ["<html>login</html>", "{}"])
    assert.equal(
      (await handleJobs({ ...options, fetchImpl: async () => new Response(body) })).status,
      502,
    );
});
test("do not infer execution from due time", () =>
  assert.equal(sanitizeJob({ id: "j", next_run_at: "2000-01-01" }).latest_execution, null));
test("creation rejects arbitrary backend parameters", async () => {
  let called = false;
  const result = await handleJobs({
    ...options,
    req: { method: "POST" },
    readBody: async () => ({ name: "x", prompt: "x", schedule: "2099-01-01", command: "bad" }),
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(result.status, 400);
  assert.equal(called, false);
});
test("create recurring schedule forwards safe fields and delete uses correct endpoint", async () => {
  let sent;
  const created = await handleJobs({
    ...options,
    req: { method: "POST" },
    readBody: async () => ({ name: " Demo ", prompt: "Say hello", schedule: "every 60m" }),
    fetchImpl: async (url, init) => {
      sent = { url, init };
      return Response.json({ job: { id: "j" } });
    },
  });
  assert.equal(created.status, 200);
  assert.deepEqual(JSON.parse(sent.init.body), {
    name: "Demo",
    prompt: "Say hello",
    schedule: "every 60m",
    deliver: "bot-chat:demo",
  });
  const deleted = await handleJobs({
    ...options,
    req: { method: "DELETE" },
    incoming: new URL("http://local/api/bot/native/jobs/j?profile=demo"),
    fetchImpl: async (url, init) => {
      assert.equal(url, "http://local/p/demo/api/jobs/j");
      assert.equal(init.method, "DELETE");
      return Response.json({ ok: true });
    },
  });
  assert.equal(deleted.status, 200);
});
test("null and oversized creation bodies fail without upstream request", async () => {
  for (const input of [
    null,
    [],
    { name: "demo", prompt: "x".repeat(5001), schedule: "every 60m" },
  ]) {
    const result = await handleJobs({
      ...options,
      req: { method: "POST" },
      readBody: async () => input,
      fetchImpl: async () => {
        throw new Error("must not fetch");
      },
    });
    assert.equal(result.status, 400);
  }
});
test("manual run does not synthesize running and preserves dependency failure", async () => {
  const request = {
    ...options,
    req: { method: "POST" },
    incoming: new URL("http://local/api/bot/native/jobs/j/run?profile=demo"),
  };
  const result = await handleJobs({
    ...request,
    fetchImpl: async () => Response.json({ job: { id: "j", next_run_at: "2020-01-01" } }),
  });
  assert.equal(result.value.job.latest_execution, null);
  assert.equal(
    (await handleJobs({ ...request, fetchImpl: async () => new Response("", { status: 424 }) }))
      .status,
    424,
  );
});
