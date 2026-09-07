export const JUMP_LATEST_PX = 96;

export function transcriptAwayFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, gap = JUMP_LATEST_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight > gap;
}

export function jumpLatestBottomPx(composerHeight: number, gapPx = 12): number {
  return Math.max(0, composerHeight) + gapPx;
}
