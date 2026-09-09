export type RemoteAsset = {
  url: string;
  name: string;
  kind: "image" | "file";
};

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif)$/i;
const FILE_EXT = /\.(?:pdf|txt|md|doc|docx|xls|xlsx|ppt|pptx|csv|tsv|zip)$/i;

function safeBasename(pathname: string, kind: RemoteAsset["kind"], extension: string): string {
  const raw = pathname.split("/").at(-1) || "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the encoded basename rather than rejecting an otherwise valid URL.
  }
  const unsafe = decoded.includes("/") || decoded.includes("\\") || [...decoded].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
  if (!decoded || decoded === extension || unsafe) {
    return `${kind === "image" ? "image" : "file"}${extension.toLowerCase()}`;
  }
  return decoded.slice(0, 240);
}

export function remoteAssetFromUrl(value: string): RemoteAsset | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const match = /\.[A-Za-z0-9]{2,5}$/.exec(parsed.pathname);
  if (!match) return null;
  const extension = match[0];
  const kind = IMAGE_EXT.test(extension) ? "image" : FILE_EXT.test(extension) ? "file" : null;
  if (!kind) return null;
  return { url: parsed.href, name: safeBasename(parsed.pathname, kind, extension), kind };
}
