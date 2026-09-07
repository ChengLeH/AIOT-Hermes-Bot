export function vapidToBytes(publicKey: string): Uint8Array {
  const padded = publicKey.trim().replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (padded.length % 4)) % 4);
  const raw = atob(padded + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
