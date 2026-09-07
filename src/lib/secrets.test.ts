import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  boundPasswordOrigin,
  clearPassword,
  memorySecretStores,
  passwordStorageKey,
  readPassword,
  withSecretStores,
  writePassword,
} from "./secrets.ts";

const ORIGIN = "https://machine.example.ts.net";
const OTHER = "https://other.example.ts.net";
const KEY = "device-local-connection-key";

test("connection key survives sessionStorage being cleared", () => {
  const stores = memorySecretStores();
  withSecretStores(stores, () => {
    writePassword(ORIGIN, KEY);
    assert.equal(stores.persistent?.getItem(passwordStorageKey(ORIGIN)), KEY);
    stores.session?.setItem(passwordStorageKey(ORIGIN), "legacy-should-be-ignored");
    stores.session?.removeItem(passwordStorageKey(ORIGIN));
    assert.equal(stores.session?.getItem(passwordStorageKey(ORIGIN)), null);
    assert.equal(readPassword(ORIGIN), KEY);
  });
});

test("legacy session-only key migrates once onto persistent storage", () => {
  const stores = memorySecretStores({
    session: { [passwordStorageKey(ORIGIN)]: KEY },
  });
  withSecretStores(stores, () => {
    assert.equal(readPassword(ORIGIN), KEY);
    assert.equal(stores.persistent?.getItem(passwordStorageKey(ORIGIN)), KEY);
    assert.equal(stores.session?.getItem(passwordStorageKey(ORIGIN)), null);
    assert.equal(stores.session?.getItem(passwordStorageKey(ORIGIN)), null);
    stores.session?.removeItem(passwordStorageKey(ORIGIN));
    assert.equal(readPassword(ORIGIN), KEY);
  });
});

test("a key bound to one origin cannot be reused for another", () => {
  const stores = memorySecretStores();
  withSecretStores(stores, () => {
    writePassword(ORIGIN, KEY);
    assert.equal(readPassword(OTHER), "");
    assert.equal(readPassword("https://machine.example.ts.net:8443"), "");
    assert.equal(readPassword(ORIGIN), KEY);
    writePassword(OTHER, "other-key");
    assert.equal(readPassword(ORIGIN), KEY);
    assert.equal(readPassword(OTHER), "other-key");
  });
});

test("clearing the connection deletes persistent and legacy session values", () => {
  const stores = memorySecretStores({
    persistent: { [passwordStorageKey(ORIGIN)]: KEY },
    session: { [passwordStorageKey(ORIGIN)]: "legacy" },
  });
  withSecretStores(stores, () => {
    clearPassword(ORIGIN);
    assert.equal(stores.persistent?.getItem(passwordStorageKey(ORIGIN)), null);
    assert.equal(stores.session?.getItem(passwordStorageKey(ORIGIN)), null);
    assert.equal(readPassword(ORIGIN), "");
  });
});

test("keys are stored under the exact normalized HTTPS origin", () => {
  const stores = memorySecretStores();
  withSecretStores(stores, () => {
    writePassword("https://machine.example.ts.net/", KEY);
    assert.equal(boundPasswordOrigin("https://machine.example.ts.net/"), ORIGIN);
    assert.equal(stores.persistent?.getItem(passwordStorageKey(ORIGIN)), KEY);
    assert.equal(readPassword("https://machine.example.ts.net/api/bot"), KEY);
  });
});

test("source never puts the connection key in a URL cookie log or remote persist slice", () => {
  const secrets = readFileSync(new URL("./secrets.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const desk = readFileSync(new URL("../components/desk-app.tsx", import.meta.url), "utf8");
  const origin = readFileSync(new URL("./origin.ts", import.meta.url), "utf8");
  assert.equal(secrets.includes("localStorage"), true);
  assert.equal(secrets.includes("sessionStorage"), true);
  assert.equal(secrets.includes("document.cookie"), false);
  assert.equal(store.includes("persistConnectionSlice"), true);
  assert.equal(store.includes("clearPassword"), true);
  assert.equal(store.includes("connection: persistConnectionSlice"), true);
  assert.equal(desk.includes("sanitizeHydratedConnection"), true);
  assert.equal(desk.includes("readPassword"), true);
  assert.equal(origin.includes("connectionFromPwaSearch"), true);
  assert.match(origin, /origin:\s*""/);
  assert.match(origin, /apiKey:\s*""/);
  assert.equal(secrets.includes("console.log"), false);
  assert.equal(store.includes("document.cookie"), false);
});
