import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  connectionFromPwaSearch,
  deepLinkFromPwaSearch,
  normalizeHttpsOrigin,
  sanitizedPwaSearch,
} from "./origin.ts";

test("Hermes origin keeps a typed custom port and never stores a key or profile", () => {
  assert.equal(normalizeHttpsOrigin("https://your-machine.ts.net"), "https://your-machine.ts.net");
  assert.equal(normalizeHttpsOrigin("https://your-machine.ts.net:8443"), "https://your-machine.ts.net:8443");
  assert.equal(normalizeHttpsOrigin("https://your-machine.ts.net:443"), "https://your-machine.ts.net");
  assert.equal(
    normalizeHttpsOrigin("https://user:secret-key@your-machine.ts.net:8443/profile/alpha?key=shh"),
    "https://your-machine.ts.net:8443",
  );
  assert.equal(normalizeHttpsOrigin("https://your-machine.ts.net/api/bot").includes("/api"), false);
  assert.throws(() => normalizeHttpsOrigin("http://your-machine.ts.net"), /httpsRequired/);
});

test("PWA URL never supplies Hermes url key profile or port", () => {
  const fromQuery = connectionFromPwaSearch(
    "?url=https://secret-host.ts.net:18789&key=shh&profile=alpha&port=18789&origin=https://evil.example",
  );
  assert.deepEqual(fromQuery, { origin: "", apiKey: "" });
  const link = deepLinkFromPwaSearch("?profile=alpha&session=c1&key=shh&port=9&url=https://x.ts.net");
  assert.deepEqual(link, { profile: "alpha", session: "c1" });
  assert.equal(sanitizedPwaSearch("?profile=alpha&session=c1&key=shh&port=9&install=1"), "?install=1");
  assert.equal(sanitizedPwaSearch("?url=https://x.ts.net&apiKey=z&token=t"), "");
  assert.equal(sanitizedPwaSearch(""), "");
});

test("app source does not hardcode a user URL key profile or Hermes port", () => {
  const onboard = readFileSync(new URL("../components/onboarding.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../components/settings-view.tsx", import.meta.url), "utf8");
  const desk = readFileSync(new URL("../components/desk-app.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const native = readFileSync(new URL("./native-bot.ts", import.meta.url), "utf8");
  assert.equal(onboard.includes("https://your-machine.ts.net"), true);
  assert.equal(settings.includes("https://your-machine.ts.net"), true);
  assert.equal(/https:\/\/(?!your-machine\.ts\.net)[a-z0-9.-]+\.ts\.net/.test(onboard + settings + desk), false);
  assert.equal(store.includes('origin: ""'), true);
  assert.equal(store.includes('apiKey: ""'), true);
  assert.equal(desk.includes("deepLinkFromPwaSearch"), true);
  assert.equal(desk.includes("stripPwaLocationSecrets"), true);
  assert.equal(desk.includes('params.get("key")'), false);
  assert.equal(desk.includes('params.get("url")'), false);
  assert.equal(desk.includes('params.get("port")'), false);
  assert.equal(/:\d{4,5}/.test(native), false);
});
