import assert from "node:assert/strict";
import { test } from "node:test";
import { createUploadBatch } from "./upload-batch.ts";
test("one success only after every attachment completes", () => {
 const complete = createUploadBatch(3);
 assert.deepEqual([complete(true), complete(true), complete(true), complete(true)], [null, null, "success", null]);
});
test("one failure suppresses all later successes and failures", () => {
 const complete = createUploadBatch(4);
 assert.deepEqual([complete(true), complete(false), complete(false), complete(true)], [null, null, null, "failure"]);
 assert.equal(createUploadBatch(0)(true), null);
});
