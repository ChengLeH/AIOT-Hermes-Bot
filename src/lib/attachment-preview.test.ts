import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containsUnsafePayload,
  createPreviewUrl,
  formatFileSize,
  isImageAttachment,
  persistableAttachment,
  queueFromFile,
  rememberSessionImage,
  resetPreviewCaches,
  revokeQueuedPreview,
  sessionImageUrl,
  transferQueueToSession,
  botMessageBody,
  type QueuedAttachment,
} from "./attachment-preview.ts";

test("image files get object URLs and documents do not", () => {
  const created: string[] = [];
  const revoked: string[] = [];
  const prev = globalThis.URL;
  globalThis.URL = {
    createObjectURL: () => {
      const url = `blob:preview-${created.length}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  } as unknown as typeof URL;
  const image = createPreviewUrl({} as Blob, { name: "cat.png", type: "image/png" });
  const doc = createPreviewUrl({} as Blob, { name: "notes.pdf", type: "application/pdf" });
  assert.equal(image, "blob:preview-0");
  assert.equal(doc, undefined);
  const queued = queueFromFile({ name: "cat.png", type: "image/png", size: 12 }, "local-1", image);
  assert.equal(isImageAttachment(queued), true);
  const persisted = persistableAttachment(queued);
  assert.equal(persisted, null);
  queued.attachment = { id: "att-1", name: "cat.png", mime: "image/png", size: 12 };
  const safe = persistableAttachment(queued);
  assert.deepEqual(safe, { id: "att-1", name: "cat.png", mime: "image/png", size: 12 });
  assert.equal(containsUnsafePayload(safe), false);
  revokeQueuedPreview(queued);
  assert.deepEqual(revoked, ["blob:preview-0"]);
  globalThis.URL = prev;
  resetPreviewCaches();
});

test("queue stays until accept then session preview is kept without persisting blobs", () => {
  resetPreviewCaches();
  const revoked: string[] = [];
  const prev = globalThis.URL;
  globalThis.URL = {
    createObjectURL: () => "blob:kept",
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  } as unknown as typeof URL;
  const queued: QueuedAttachment[] = [
    {
      localId: "1",
      name: "cat.png",
      mime: "image/png",
      size: 20,
      status: "ready",
      previewUrl: "blob:kept",
      attachment: { id: "att-1", name: "cat.png", mime: "image/png", size: 20 },
    },
  ];
  const accepted = true;
  if (accepted) transferQueueToSession(queued);
  assert.equal(sessionImageUrl("att-1"), "blob:kept");
  assert.deepEqual(revoked, []);
  rememberSessionImage("att-1", "blob:kept");
  const snapshot = { messages: [{ attachments: [persistableAttachment(queued[0]!)] }] };
  assert.equal(containsUnsafePayload(snapshot), false);
  globalThis.URL = prev;
  resetPreviewCaches();
});

test("message payload includes attachment ids only after upload", () => {
  const body = botMessageBody({
    profile: "alpha",
    conversation: "c1",
    text: "see",
    attachmentIds: ["att-1"],
  });
  assert.deepEqual(body, {
    profile: "alpha",
    conversation: "c1",
    text: "see",
    attachment_ids: ["att-1"],
  });
  assert.equal("model" in body, false);
  const plain = botMessageBody({ profile: "alpha", conversation: "c1", text: "hi" });
  assert.equal("attachment_ids" in plain, false);
});

test("file size label is compact", () => {
  assert.equal(formatFileSize(12), "12 B");
  assert.equal(isImageAttachment({ name: "a.PDF", mime: "application/pdf" }), false);
});
