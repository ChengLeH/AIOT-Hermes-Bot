export const APP_BRAND = "aiot";
export const APP_SLOGAN = "your agent, in your pocket";
export const HEAD_OUTLINE = "#7a7d78";
export const BRAND_EYE = "#6a8a7c";

export const EYE_SWATCHES = [
  { id: "moss", hex: "#6a8a7c", label: "苔綠" },
  { id: "steel", hex: "#6a7a88", label: "鋼青" },
  { id: "clay", hex: "#8a6e6e", label: "灰紅" },
  { id: "plum", hex: "#74687c", label: "灰紫" },
  { id: "olive", hex: "#748064", label: "灰橄" },
  { id: "rust", hex: "#8a7464", label: "灰赭" },
  { id: "stone", hex: "#787874", label: "灰石" },
] as const;

type NamedEyeSwatch = (typeof EYE_SWATCHES)[number]["id"];
export type EyeSwatch = NamedEyeSwatch | `#${string}`;

const EYE_IDS: NamedEyeSwatch[] = EYE_SWATCHES.map((item) => item.id);

export function profileHash(profile: string): number {
  let h = 0;
  for (const ch of profile) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function eyeSwatchForProfile(profile: string): NamedEyeSwatch {
  const id = profile.trim();
  return EYE_IDS[profileHash(id) % EYE_IDS.length] ?? "moss";
}

/** Allocate across the catalog so hash collisions never share an eye color. */
export function eyeSwatchesForProfiles(profiles: string[]): Map<string, EyeSwatch> {
  const result = new Map<string, EyeSwatch>();
  const used = new Set<string>();
  for (const profile of [...new Set(profiles)].sort()) {
    const start = profileHash(profile) % EYE_IDS.length;
    let swatch: EyeSwatch | undefined;
    for (let offset = 0; offset < EYE_IDS.length; offset++) {
      const candidate = EYE_IDS[(start + offset) % EYE_IDS.length]!;
      if (!used.has(eyeHex(candidate))) { swatch = candidate; break; }
    }
    // Additional profiles receive low-chroma RGB colors, never a repeated palette entry.
    let seed = profileHash(profile);
    while (!swatch) {
      const channels = [96 + seed % 48, 96 + Math.floor(seed / 48) % 48, 96 + Math.floor(seed / 2304) % 48];
      const candidate = `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}` as EyeSwatch;
      if (!used.has(candidate)) swatch = candidate;
      seed++;
    }
    result.set(profile, swatch);
    used.add(eyeHex(swatch));
  }
  return result;
}

export function isEyeSwatch(value: string | null | undefined): value is EyeSwatch {
  return Boolean(value && (EYE_IDS as string[]).includes(value));
}

export function resolveEyeSwatch(swatch: string | null | undefined, profile: string): EyeSwatch {
  if (isEyeSwatch(swatch)) return swatch;
  if (swatch && /^#[0-9a-f]{6}$/.test(swatch)) return swatch as EyeSwatch;
  return eyeSwatchForProfile(profile);
}

export function eyeHex(swatch: EyeSwatch): string {
  if (/^#[0-9a-f]{6}$/.test(swatch)) return swatch;
  return EYE_SWATCHES.find((item) => item.id === swatch)?.hex ?? BRAND_EYE;
}

export const LAUNCH_MS = 1350;
export const LAUNCH_REDUCED_MS = 420;

export function launchDuration(reducedMotion: boolean): number {
  return reducedMotion ? LAUNCH_REDUCED_MS : LAUNCH_MS;
}

export function launchShouldShow(elapsedMs: number, durationMs: number): boolean {
  return elapsedMs < durationMs;
}

export const EYE_RX = 6.4;
export const EYE_RY = 3.55;
export const EYE_CY = 30.2;
export const EYE_CX_LEFT = 21.4;
export const EYE_CX_RIGHT = 42.6;
export const PREVIOUS_EYE_GAP = 15.6;
export const HEAD_X = 8.5;
export const HEAD_SIZE = 47;

export function eyeGap(): number {
  return EYE_CX_RIGHT - EYE_CX_LEFT;
}

export function eyeGapIncrease(): number {
  return eyeGap() / PREVIOUS_EYE_GAP;
}

export function eyeCenterFractions(): [number, number] {
  return [(EYE_CX_LEFT - HEAD_X) / HEAD_SIZE, (EYE_CX_RIGHT - HEAD_X) / HEAD_SIZE];
}

export const CONNECT_HEADING_CLASS = "connect-heading";
export const CONNECT_HEADING_LINE_CLASS = "connect-heading-line";
export const CONNECT_HEADING_MAX_PX = 34.4;
export const NARROW_MOBILE_CONTENT_PX = 280;

export function latinPhraseWidth(text: string, fontPx: number, trackingEm = 0.01): number {
  return text.length * fontPx * (0.62 + trackingEm);
}

export function hermesAgentUncropped(text: string, contentPx = NARROW_MOBILE_CONTENT_PX): boolean {
  if (!text.includes("Hermes Bot")) return false;
  const fontPx = CONNECT_HEADING_MAX_PX;
  return (
    latinPhraseWidth("Hermes", fontPx) <= contentPx &&
    latinPhraseWidth("Bot", fontPx) <= contentPx &&
    latinPhraseWidth("Hermes Bot", fontPx) <= contentPx * 1.05
  );
}

export function splitConnectHeading(text: string): string[] {
  const match = text.match(/^(.*?)(\s*Hermes Bot[。.!?]?)\s*$/);
  if (match?.[1]?.trim() && match[2]) {
    return [match[1].trim(), match[2].trim()];
  }
  return [text];
}
