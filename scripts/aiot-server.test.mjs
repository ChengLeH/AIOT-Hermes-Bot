import test from "node:test";
import assert from "node:assert/strict";
import { previewArgs } from "./aiot-server.mjs";

test("preview keeps paths as arguments and refuses a fallback port", () => {
  const vite = "C:\\Users\\Example User\\AIOT\\node_modules\\vite\\bin\\vite.js";
  assert.deepEqual(previewArgs(vite, 8888), [vite, "preview", "--host", "127.0.0.1", "--port", "8888", "--strictPort"]);
});
