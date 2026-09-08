import { eyeSwatchForProfile, type EyeSwatch } from "./brand.ts";
import type { NativeRunCapabilities } from "./native-runs.ts";

export type BotSwatch = EyeSwatch;
export type BotState = "idle" | "working" | "waiting" | "done";

export type Bot = {
  id: string;
  name: string;
  title: string;
  bio: string;
  swatch: BotSwatch;
  pinned: boolean;
  createdAt: number;
  profile: string;
  available: boolean;
  conversation: string;
  nativeCapabilities?: NativeRunCapabilities;
};

export const SWATCHES: { id: BotSwatch; label: string }[] = [
  { id: "moss", label: "苔綠" },
  { id: "steel", label: "鋼青" },
  { id: "clay", label: "灰紅" },
  { id: "plum", label: "灰紫" },
  { id: "olive", label: "灰橄" },
  { id: "rust", label: "灰赭" },
  { id: "stone", label: "灰石" },
];

export function titleCaseProfileId(profile: string): string {
  return profile
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function botDisplayName(profile: string, displayName?: string | null): string {
  const intentional = displayName?.trim() ?? "";
  if (intentional) return intentional;
  return titleCaseProfileId(profile);
}

export function botFromProfile(
  profile: string,
  available: boolean,
  conversation: string,
  displayName?: string | null,
): Bot {
  const id = profile.trim();
  return {
    id: `hp:${id}`,
    name: botDisplayName(id, displayName),
    title: displayName?.trim() ?? "",
    bio: id,
    swatch: eyeSwatchForProfile(id),
    pinned: false,
    createdAt: Date.now(),
    profile: id,
    available,
    conversation,
  };
}
