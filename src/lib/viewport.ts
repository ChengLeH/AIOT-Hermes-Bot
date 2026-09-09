export type ViewportMetrics = {
  visualHeight?: number;
  visualOffsetTop?: number;
  innerHeight: number;
  standalone?: boolean;
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

export function resolveAppViewport(metrics: ViewportMetrics): { height: number; top: number } {
  const visual = metrics.visualHeight;
  const validVisual = typeof visual === "number" && Number.isFinite(visual) && visual > 0;
  const keyboardGap = validVisual ? metrics.innerHeight - visual : 0;
  // In standalone iOS, visualViewport may settle one safe-area/chrome inset
  // shorter than innerHeight. Treat only a proportional, keyboard-sized gap
  // as a real resize; Safari tabs keep their native visual viewport behavior.
  const standaloneSettlingGap = metrics.standalone && validVisual && keyboardGap > 0 && keyboardGap < metrics.innerHeight * 0.18;
  const height = validVisual && !standaloneSettlingGap ? visual : metrics.innerHeight;
  return {
    height,
    // Standalone iOS can retain a transient visualViewport offset after its
    // browser chrome or keyboard settles. Safe-area padding already owns the
    // top inset, so translating the fixed app root would apply it twice.
    top: 0,
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
  const apply = () => {
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
    const box = viewportRootBox({
      visualHeight: vv?.height,
      visualOffsetTop: vv?.offsetTop,
      innerHeight: window.innerHeight,
      standalone,
    });
    root.style.setProperty("--app-height", `${box.height}px`);
    root.style.setProperty("--app-top", `${box.top}px`);
    root.style.setProperty("min-height", "0px", "important");
    applyViewportBox(document.body, box.height, box.top);
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
    document.removeEventListener("gesturestart", preventZoomGesture);
    document.removeEventListener("gesturechange", preventZoomGesture);
    document.removeEventListener("gestureend", preventZoomGesture);
    mo.disconnect();
  };
}
