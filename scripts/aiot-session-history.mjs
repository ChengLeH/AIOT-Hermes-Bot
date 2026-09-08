// Only public chat content crosses from the Session API to the browser.
export function sessionMessages(value, profile = "", conversation = "") {
  return (Array.isArray(value?.data) ? value.data : []).flatMap((row) => {
    if (!row || !["user", "assistant"].includes(row.role) || row.id == null) return [];
    const text =
      typeof row.content === "string"
        ? row.content
        : Array.isArray(row.content)
          ? row.content
              .filter((part) => part?.type === "text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("\n")
          : "";
    if (!text) return [];
    const stamp =
      typeof row.timestamp === "number"
        ? row.timestamp < 1e12
          ? row.timestamp * 1000
          : row.timestamp
        : Date.parse(row.timestamp || "");
    return [
      {
        messageId: `hermes-${encodeURIComponent(profile)}:${encodeURIComponent(conversation)}:${row.id}`,
        role: row.role,
        text,
        ...(Number.isFinite(stamp) ? { createdAt: stamp } : {}),
      },
    ];
  });
}
