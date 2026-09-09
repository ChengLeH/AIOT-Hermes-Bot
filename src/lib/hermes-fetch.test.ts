import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONNECTION_PROBE_TIMEOUT_MS, hermesFetch, isAbortError } from "./hermes-fetch.ts";

test("connection probe timeout is bounded and skips uploads and long work", () => {
  assert.equal(CONNECTION_PROBE_TIMEOUT_MS, 6_000);
  assert.equal(CONNECTION_PROBE_TIMEOUT_MS < 15_000, true);
  const native = readFileSync(new URL("./native-bot.ts", import.meta.url), "utf8");
  const attachments = readFileSync(new URL("./attachments.ts", import.meta.url), "utf8");
  function fn(name: string): string {
    const start = native.indexOf(`export async function ${name}`);
    assert.equal(start >= 0, true, name);
    const next = native.indexOf("export async function", start + 1);
    return next === -1 ? native.slice(start) : native.slice(start, next);
  }
  assert.equal(fn("getBotProfiles").includes("timeoutMs: CONNECTION_PROBE_TIMEOUT_MS"), true);
  assert.equal(fn("getBotEvents").includes("timeoutMs: CONNECTION_PROBE_TIMEOUT_MS"), true);
  assert.equal(fn("postBotMessage").includes("timeoutMs"), false);
  assert.equal(fn("getBotAttachment").includes("timeoutMs"), false);
  assert.equal(fn("postBotCompletions").includes("timeoutMs"), false);
  assert.equal(fn("postBotApproval").includes("timeoutMs"), false);
  assert.equal(fn("postBotInterrupt").includes("timeoutMs"), false);
  assert.equal(attachments.includes("timeoutMs"), false);
});

test("hung probe aborts within the timeout window", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }) as typeof fetch;
  const started = Date.now();
  try {
    await assert.rejects(() => hermesFetch("https://machine.example.ts.net/api/bot/profiles", { timeoutMs: 40 }));
    assert.equal(Date.now() - started < 1000, true);
  } finally {
    globalThis.fetch = real;
  }
});

test("abort errors are detected without treating them as missing keys", () => {
  const err = new Error("aborted");
  err.name = "AbortError";
  assert.equal(isAbortError(err), true);
  assert.equal(isAbortError(new Error("profiles 401")), false);
});

test("completed or failed timed fetch removes the caller's abort listener", async () => {
  const real = globalThis.fetch;
  try {
    for (const failure of [false, true]) {
      const caller = new AbortController();
      let added: EventListenerOrEventListenerObject | null = null;
      let removed: EventListenerOrEventListenerObject | null = null;
      const add = caller.signal.addEventListener.bind(caller.signal);
      const remove = caller.signal.removeEventListener.bind(caller.signal);
      caller.signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === "abort") added = listener;
        add(type, listener, options);
      }) as typeof caller.signal.addEventListener;
      caller.signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        if (type === "abort") removed = listener;
        remove(type, listener, options);
      }) as typeof caller.signal.removeEventListener;
      globalThis.fetch = async () => {
        if (failure) throw new Error("network failed");
        return new Response("ok");
      };
      const request = hermesFetch("https://example.test/profiles", { signal: caller.signal, timeoutMs: 1000 });
      if (failure) await assert.rejects(request, /network failed/);
      else await request;
      assert.ok(added);
      assert.equal(removed, added, "remove the same abort callback on every settlement path");
    }
  } finally {
    globalThis.fetch = real;
  }
});

test("external cancellation still reaches a timed fetch", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
    });
    const caller = new AbortController();
    const request = hermesFetch("https://example.test/profiles", { signal: caller.signal, timeoutMs: 1000 });
    caller.abort();
    await assert.rejects(request, { name: "AbortError" });
  } finally {
    globalThis.fetch = real;
  }
});
