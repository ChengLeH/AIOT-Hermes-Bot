import test from "node:test";
import assert from "node:assert/strict";
import { sessionMessages } from "./aiot-session-history.mjs";
test("session history exposes visible text only with stable row identities", () => {
  assert.deepEqual(
    sessionMessages({
      data: [
        { id: 1, role: "system", content: "secret" },
        { id: 2, role: "user", content: "hello" },
        { id: 3, role: "assistant", content: "", tool_calls: [{}] },
        {
          id: 4,
          role: "assistant",
          content: [
            { type: "text", text: "reply" },
            { type: "image_url", image_url: { url: "secret" } },
          ],
        },
      ],
    }),
    [
      { messageId: "hermes-::2", role: "user", text: "hello" },
      { messageId: "hermes-::4", role: "assistant", text: "reply" },
    ],
  );
});

test("session row identities are isolated across profiles and conversations", () => {
  const raw = { data: [{ id: 1, role: "assistant", content: "reply" }] };
  const a = sessionMessages(raw, "demo", "chat-a")[0];
  assert.notEqual(a.messageId, sessionMessages(raw, "other", "chat-a")[0].messageId);
  assert.notEqual(a.messageId, sessionMessages(raw, "demo", "chat-b")[0].messageId);
});
