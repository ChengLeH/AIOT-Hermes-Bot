import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeSystemNotice } from "./system-notice.ts";
test("known stop notice follows UI language without translating conversation prose", () => {
 const text = "⚡ Stopped. You can continue this session.";
 assert.equal(localizeSystemNotice(text, "zh-Hant"), "⚡ 已停止，你可以繼續這段對話。");
 assert.equal(localizeSystemNotice(text, "en"), text);
 const prose = "He said: Stopped. You can continue this session.";
 assert.equal(localizeSystemNotice(prose, "zh-Hant"), prose);
});
