export type ViewportMetrics = {
  visualHeight?: number;
  visualOffsetTop?: number;
  innerHeight: number;
  standalone?: boolean;
  statusBarOffset?: number;
  appleTouch?: boolean;
  textInputFocused?: boolean;
};

export type ViewportBox = {
  height: number;
  top: number;
  minHeight: 0;
  maxHeight: number;
};

export type AppLayout = "setup" | "desk";

export const SETUP_TOOLBAR_SPACER = "clamp(5rem, 12dvh, 7rem)";

export function appLayoutFromState(onboarded: boolean, hydrated = true): AppLayout {
  return hydrated && onboarded ? "desk" : "setup";
}

export function isDeskLayout(layout: string | null | undefined): boolean {
  return layout === "desk";
}

export function standaloneStatusBarOffset(input: { standalone: boolean; appleTouch: boolean; screenHeight: number; innerHeight: number; safeAreaTop: number }): number {
  if (!input.standalone || !input.appleTouch) return 0;
  const { screenHeight, innerHeight, safeAreaTop } = input;
  if (![screenHeight, innerHeight, safeAreaTop].every(Number.isFinite) || innerHeight <= 0 || safeAreaTop <= 0) return 0;
  const gap = screenHeight - innerHeight;
  // Some standalone WebKit versions exclude the status bar from innerHeight,
  // but still place fixed elements at the physical screen origin. Only correct
  // the measured one-status-bar discrepancy, never a keyboard/browser gap.
  return gap > 0 && Math.abs(gap - safeAreaTop) <= 1 ? gap : 0;
}

export function correctedStandaloneMetrics(metrics: ViewportMetrics, screenHeight: number, statusBarOffset: number): ViewportMetrics {
  if (!metrics.standalone || statusBarOffset <= 0) return metrics;
  const height = Math.min(metrics.innerHeight, screenHeight - statusBarOffset);
  return { ...metrics, innerHeight: height, visualHeight: metrics.visualHeight === undefined ? undefined : Math.min(metrics.visualHeight, height), statusBarOffset };
}

export function resolveAppViewport(metrics: ViewportMetrics): { height: number; top: number } {
  const visual = metrics.visualHeight;
  const validVisual = typeof visual === "number" && Number.isFinite(visual) && visual > 0;
  const keyboardGap = validVisual ? metrics.innerHeight - visual : 0;
  // In standalone iOS, visualViewport may settle one safe-area/chrome inset
  // shorter than innerHeight. Treat only a proportional, keyboard-sized gap
  // as a real resize; Safari tabs keep their native visual viewport behavior.
  const standaloneSettlingGap = metrics.standalone && validVisual && keyboardGap > 0 && keyboardGap < metrics.innerHeight * 0.18;
  const height = validVisual && !standaloneSettlingGap ? visual : metrics.innerHeight;
  const keyboardOpen = metrics.appleTouch && metrics.textInputFocused && keyboardGap >= metrics.innerHeight * 0.18;
  const visualTop = metrics.visualOffsetTop;
  const keyboardPan = keyboardOpen && typeof visualTop === "number" && Number.isFinite(visualTop)
    ? Math.max(0, Math.min(visualTop, metrics.innerHeight - height)) : 0;
  return {
    height,
    // Follow actual keyboard panning only during text input. Ignore retained
    // offsets after dismissal so the closed-keyboard layout stays unchanged.
    top: keyboardPan + (metrics.standalone && Number.isFinite(metrics.statusBarOffset) ? Math.max(0, metrics.statusBarOffset ?? 0) : 0),
  };
}

export function viewportRootBox(metrics: ViewportMetrics): ViewportBox {
  const next = resolveAppViewport(metrics);
  return {
    height: next.height,
    top: next.top,
    minHeight: 0,
    maxHeight: next.height,
  };
}

export function usedBlockSize(height: number, minHeight: number, maxHeight?: number): number {
  let used = Math.max(height, minHeight);
  if (typeof maxHeight === "number") used = Math.min(used, maxHeight);
  return used;
}

export function usedViewportRootSize(metrics: ViewportMetrics): number {
  const box = viewportRootBox(metrics);
  return usedBlockSize(box.height, box.minHeight, box.maxHeight);
}

export function applyViewportBox(el: HTMLElement, height: number, top = 0): void {
  const h = `${height}px`;
  el.style.setProperty("min-height", "0px", "important");
  el.style.setProperty("height", h);
  el.style.setProperty("max-height", h);
  if (el === document.documentElement) return;
  el.style.setProperty("top", `${top}px`);
  el.style.setProperty("bottom", "auto");
}

export function clearViewportBox(el: HTMLElement): void {
  el.style.removeProperty("min-height");
  el.style.removeProperty("height");
  el.style.removeProperty("max-height");
  el.style.removeProperty("top");
  el.style.removeProperty("bottom");
}

export function setAppLayout(mode: AppLayout): void {
  document.documentElement.dataset.appLayout = mode;
}

const ROOT_SELECTOR = ".viewport-root";

export function bindVisualViewport(): () => void {
  const root = document.documentElement;
  let measuredStatusBarOffset = 0;
  let measuredScreen = "";
  const apply = () => {
    // iOS Quick Look briefly changes visualViewport while the installed PWA is
    // hidden. Persisting that transitional box leaves the app shifted after
    // the preview closes, so only visible viewport metrics may own the shell.
    if (document.visibilityState === "hidden") return;
    if (!isDeskLayout(root.dataset.appLayout)) {
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-top");
      root.style.removeProperty("min-height");
      clearViewportBox(document.body);
      return;
    }
    const vv = window.visualViewport;
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const appleTouch = /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const shell = document.querySelector<HTMLElement>(ROOT_SELECTOR);
    const screenKey = `${window.screen.width}x${window.screen.height}`;
    if (screenKey !== measuredScreen || !standalone || !appleTouch) {
      measuredStatusBarOffset = 0;
      measuredScreen = screenKey;
    }
    // Expanding the body's clip box can change WebKit's reported innerHeight.
    // Retain the native inset measured before that write for this orientation,
    // otherwise each resize undoes the preceding correction.
    measuredStatusBarOffset ||= standaloneStatusBarOffset({
      standalone, appleTouch,
      screenHeight: window.screen.height,
      innerHeight: window.innerHeight,
      safeAreaTop: shell ? parseFloat(getComputedStyle(shell).paddingTop) : 0,
    });
    const statusBarOffset = measuredStatusBarOffset;
    root.dataset.iosStatusOffset = statusBarOffset > 0 ? "true" : "false";
    const box = viewportRootBox(correctedStandaloneMetrics({
      appleTouch,
      textInputFocused: document.activeElement?.matches("textarea, input:not([type=button]):not([type=submit]), [contenteditable=true]") === true,
      visualHeight: vv?.height,
      visualOffsetTop: vv?.offsetTop,
      innerHeight: window.innerHeight,
      standalone,
      statusBarOffset,
    }, window.screen.height, statusBarOffset));
    root.style.setProperty("--app-height", `${box.height}px`);
    root.style.setProperty("--app-top", `${box.top}px`);
    root.style.setProperty("min-height", "0px", "important");
    for (const el of document.querySelectorAll<HTMLElement>(ROOT_SELECTOR)) {
      applyViewportBox(el, box.height, box.top);
    }
  };
  apply();
  const vv = window.visualViewport;
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  window.addEventListener("focusin", apply);
  window.addEventListener("focusout", apply);
  const restoreVisibleViewport = () => {
    if (document.visibilityState !== "hidden") apply();
  };
  window.addEventListener("pageshow", restoreVisibleViewport);
  document.addEventListener("visibilitychange", restoreVisibleViewport);
  const mo = new MutationObserver(apply);
  mo.observe(root, { attributes: true, attributeFilter: ["data-app-layout"] });
  const preventZoomGesture = (event: Event) => event.preventDefault();
  document.addEventListener("gesturestart", preventZoomGesture, { passive: false });
  document.addEventListener("gesturechange", preventZoomGesture, { passive: false });
  document.addEventListener("gestureend", preventZoomGesture, { passive: false });
  return () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    window.removeEventListener("focusin", apply);
    window.removeEventListener("focusout", apply);
    window.removeEventListener("pageshow", restoreVisibleViewport);
    document.removeEventListener("visibilitychange", restoreVisibleViewport);
    document.removeEventListener("gesturestart", preventZoomGesture);
    document.removeEventListener("gesturechange", preventZoomGesture);
    document.removeEventListener("gestureend", preventZoomGesture);
    mo.disconnect();
  };
}
