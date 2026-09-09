import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteAssetFromUrl } from "./session-output-media.ts";

test("classifies HTTPS Session result images and documents without trusting credentials", () => {
  assert.deepEqual(remoteAssetFromUrl("https://cdn.example.test/result/photo.PNG?token=short"), {
    url: "https://cdn.example.test/result/photo.PNG?token=short",
    name: "photo.PNG",
    kind: "image",
  });
  assert.deepEqual(remoteAssetFromUrl("https://cdn.example.test/files/report.pdf"), {
    url: "https://cdn.example.test/files/report.pdf",
    name: "report.pdf",
    kind: "file",
  });
  assert.equal(remoteAssetFromUrl("http://cdn.example.test/photo.png"), null);
  assert.equal(remoteAssetFromUrl("https://user:secret@cdn.example.test/photo.png"), null);
  assert.equal(remoteAssetFromUrl("https://cdn.example.test/page"), null);
});

test("uses a neutral filename when the safe path has no usable basename", () => {
  assert.deepEqual(remoteAssetFromUrl("https://cdn.example.test/.png"), {
    url: "https://cdn.example.test/.png",
    name: "image.png",
    kind: "image",
  });
});
