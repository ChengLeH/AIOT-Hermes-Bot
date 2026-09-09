export const CARD_MOTION_MS = 280;
export const CARD_MOTION_FALLBACK_MS = CARD_MOTION_MS + 80;

export function afterCardStartPaint(start: () => void) {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(start);
  });
  return () => {
    cancelAnimationFrame(first);
    if (second) cancelAnimationFrame(second);
  };
}

export function waitForCardAnimation(
  element: HTMLElement | null,
  animationName: string,
  complete: () => void,
) {
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    element?.removeEventListener("animationend", onAnimationEnd);
    element?.removeEventListener("animationcancel", onAnimationCancel);
    complete();
  };
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.target === element && event.animationName === animationName) done();
  };
  const onAnimationCancel = (event: AnimationEvent) => {
    if (event.target === element && event.animationName === animationName) done();
  };
  element?.addEventListener("animationend", onAnimationEnd);
  element?.addEventListener("animationcancel", onAnimationCancel);
  const timer = setTimeout(done, CARD_MOTION_FALLBACK_MS);
  return () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    element?.removeEventListener("animationend", onAnimationEnd);
    element?.removeEventListener("animationcancel", onAnimationCancel);
  };
}
