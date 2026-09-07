import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canDownloadAttachments,
  canUploadAttachments,
  fileKindError,
  MAX_ATTACHMENTS,
  parseAttachmentList,
} from "./attachment-rules.ts";
import { parseBotCatalog } from "./bot-catalog.ts";

test("attachments stay off unless both flags are true", () => {
  const off = parseBotCatalog({ profiles: [{ name: "a", available: true }] });
  assert.equal(off.capabilities.attachments, false);
  assert.equal(off.capabilities.attachment_uploads, false);
  assert.equal(canUploadAttachments(off.capabilities), false);
  const on = parseBotCatalog({
    profiles: [{ name: "a", available: true }],
    capabilities: {
      attachments: true,
      attachment_uploads: true,
      attachment_downloads: false,
      max_attachment_bytes: 10485760,
    },
  });
  assert.equal(canUploadAttachments(on.capabilities), true);
  assert.equal(canDownloadAttachments(on.capabilities), false);
  assert.equal(on.capabilities.attachment_downloads, false);
  assert.equal(on.capabilities.max_attachment_bytes, 10485760);
});

test("rejects audio and video, allows images and documents", () => {
  assert.equal(fileKindError({ name: "a.mp3", type: "audio/mpeg" } as File), "error.audioVideo");
  assert.equal(fileKindError({ name: "a.mp4", type: "video/mp4" } as File), "error.audioVideo");
  assert.equal(fileKindError({ name: "pic.png", type: "image/png" } as File), null);
  assert.equal(fileKindError({ name: "doc.pdf", type: "application/pdf" } as File), null);
  assert.equal(MAX_ATTACHMENTS, 5);
});

test("parses attachment descriptors and message payload keys", () => {
  const list = parseAttachmentList([
    { id: "1", name: "a.png", mime: "image/png", size: 12 },
    { id: "", name: "skip" },
  ]);
  assert.deepEqual(list, [{ id: "1", name: "a.png", mime: "image/png", size: 12 }]);
  const withFiles = {
    profile: "alpha",
    conversation: "c1",
    text: "",
    attachment_ids: ["1"],
  };
  assert.deepEqual(Object.keys(withFiles).sort(), ["attachment_ids", "conversation", "profile", "text"]);
  const plain = { profile: "alpha", conversation: "c1", text: "hi" };
  assert.equal("attachment_ids" in plain, false);
});
