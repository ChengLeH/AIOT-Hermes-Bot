import { encryptedBrowserStorage } from "./encrypted-storage.ts";
import { useEffect, useSyncExternalStore } from "react";
import type { Locale } from "./locale";

export const BACKGROUND_THEME_STORAGE_KEY = "aiot-background-theme-v1";
export const MAX_BACKGROUND_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_BACKGROUND_LONG_EDGE = 1920;
export const MAX_SOURCE_DIMENSION = 16_384;
export const MAX_SOURCE_PIXELS = 40_000_000;

export type BackgroundTheme = { dataUrl: string; mime: "image/webp" | "image/jpeg"; width: number; height: number; updatedAt: number };
type ImageKind = "image/png" | "image/jpeg" | "image/webp";
type Dimensions = { width: number; height: number };

let current: BackgroundTheme | null = null;
let loaded = false;
let operations: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function notify() { for (const listener of listeners) listener(); }
function fail(code: string): never { throw new Error(code); }
function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

export function detectBackgroundImage(bytes: Uint8Array): ImageKind {
  if (bytes.length >= 24 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return "image/jpeg";
  if (bytes.length >= 16 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return fail("background_invalid_type");
}

export function backgroundImageDimensions(bytes: Uint8Array, kind = detectBackgroundImage(bytes)): Dimensions {
  const data = view(bytes);
  if (kind === "image/png") {
    if (new TextDecoder().decode(bytes.slice(12, 16)) !== "IHDR") return fail("background_invalid_image");
    return { width: data.getUint32(16), height: data.getUint32(20) };
  }
  if (kind === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9) continue;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { height: data.getUint16(offset + 3), width: data.getUint16(offset + 5) };
      offset += length;
    }
    return fail("background_invalid_image");
  }
  const chunk = new TextDecoder().decode(bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = data.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff };
  return fail("background_invalid_image");
}

export function backgroundOutputDimensions({ width, height }: Dimensions): Dimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION || width * height > MAX_SOURCE_PIXELS) return fail("background_dimensions_too_large");
  const scale = Math.min(1, MAX_BACKGROUND_LONG_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("background_encode_failed")); reader.readAsDataURL(blob); });
}

export async function prepareBackgroundImage(file: File, codecs: {
  createBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  createCanvas?: () => HTMLCanvasElement;
  toDataUrl?: (blob: Blob) => Promise<string>;
  now?: () => number;
} = {}): Promise<BackgroundTheme> {
  if (file.size < 1 || file.size > MAX_BACKGROUND_FILE_BYTES) return fail(file.size > MAX_BACKGROUND_FILE_BYTES ? "background_too_large" : "background_invalid_image");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectBackgroundImage(bytes);
  const source = backgroundImageDimensions(bytes, kind);
  backgroundOutputDimensions(source); // Reject decompression bombs before decoding.
  let bitmap: ImageBitmap;
  try { bitmap = await (codecs.createBitmap ?? createImageBitmap)(new Blob([bytes], { type: kind })); } catch { return fail("background_invalid_image"); }
  try {
    // EXIF orientation can legitimately swap decoded JPEG width and height.
    const output = backgroundOutputDimensions({ width: bitmap.width, height: bitmap.height });
    const canvas = codecs.createCanvas?.() ?? document.createElement("canvas"); canvas.width = output.width; canvas.height = output.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return fail("background_encode_failed");
    context.drawImage(bitmap, 0, 0, output.width, output.height);
    let encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!encoded || encoded.type !== "image/webp") encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!encoded || encoded.type !== "image/jpeg" && encoded.type !== "image/webp") return fail("background_encode_failed");
    const mime = encoded.type as BackgroundTheme["mime"];
    return { dataUrl: await (codecs.toDataUrl ?? blobDataUrl)(encoded), mime, ...output, updatedAt: (codecs.now ?? Date.now)() };
  } finally { bitmap.close(); }
}

function validStored(value: unknown): value is BackgroundTheme {
  const item = value as BackgroundTheme;
  return Boolean(item && item.mime && ["image/webp", "image/jpeg"].includes(item.mime) && typeof item.dataUrl === "string" && new RegExp(`^data:${item.mime.replace("/", "\\/")};base64,[A-Za-z0-9+/]+={0,2}$`).test(item.dataUrl) && item.dataUrl.length <= 8_000_000 && Number.isInteger(item.width) && Number.isInteger(item.height) && item.width > 0 && item.height > 0 && item.width <= MAX_BACKGROUND_LONG_EDGE && item.height <= MAX_BACKGROUND_LONG_EDGE && Number.isFinite(item.updatedAt));
}

function serialized<T>(operation: () => Promise<T>): Promise<T> { const next = operations.then(operation, operation); operations = next.catch(() => undefined); return next; }
export function loadBackgroundTheme(): Promise<BackgroundTheme | null> {
  return serialized(async () => { const raw = await encryptedBrowserStorage().getItem(BACKGROUND_THEME_STORAGE_KEY); let next: unknown = null; try { next = raw ? JSON.parse(raw) : null; } catch { next = null; } current = validStored(next) ? next : null; loaded = true; notify(); return current; });
}
export function saveBackgroundTheme(file: File): Promise<BackgroundTheme> {
  return serialized(async () => { const next = await prepareBackgroundImage(file); await encryptedBrowserStorage().setItem(BACKGROUND_THEME_STORAGE_KEY, JSON.stringify(next)); current = next; loaded = true; notify(); return next; });
}
export function savePreparedBackgroundTheme(next: BackgroundTheme): Promise<BackgroundTheme> {
  return serialized(async () => { if (!validStored(next)) return fail("background_invalid_image"); await encryptedBrowserStorage().setItem(BACKGROUND_THEME_STORAGE_KEY, JSON.stringify(next)); current = next; loaded = true; notify(); return next; });
}
export function removeBackgroundTheme(): Promise<void> {
  return serialized(async () => { await encryptedBrowserStorage().removeItem(BACKGROUND_THEME_STORAGE_KEY); current = null; loaded = true; notify(); });
}
export function getBackgroundThemeSnapshot() { return current; }
export function backgroundThemeLoaded() { return loaded; }
export function subscribeBackgroundTheme(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useBackgroundTheme() {
  const theme = useSyncExternalStore(subscribeBackgroundTheme, getBackgroundThemeSnapshot, () => null);
  useEffect(() => { if (!loaded) void loadBackgroundTheme().catch(() => {}); }, []);
  return theme;
}
export function backgroundThemeError(error: unknown, locale: Locale) {
  const code = error instanceof Error ? error.message : ""; const en = locale === "en";
  if (code === "background_too_large") return en ? "Choose an image no larger than 5 MB." : "請選擇不超過 5 MB 的圖片。";
  if (code === "background_dimensions_too_large") return en ? "This image is too large to process safely." : "這張圖片的尺寸過大，無法安全處理。";
  if (code === "background_invalid_type" || code === "background_invalid_image") return en ? "Choose a valid PNG, JPEG, or WebP image." : "請選擇有效的 PNG、JPEG 或 WebP 圖片。";
  return en ? "The background could not be saved securely. Please try again." : "無法安全儲存背景，請再試一次。";
}
