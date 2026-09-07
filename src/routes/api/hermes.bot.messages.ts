import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/hermes/bot/messages")({
  server: {
    handlers: {
      POST: async () => Response.json({ error: "直連閘道，不經本站代理" }, { status: 410 }),
    },
  },
});
