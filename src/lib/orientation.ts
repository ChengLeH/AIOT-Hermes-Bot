export function shouldShowPortraitFallback(input: { standalone: boolean; touch: boolean; landscape: boolean; lockUnavailable: boolean }): boolean {
  return input.standalone && input.touch && input.landscape && input.lockUnavailable;
}

export function bindPortraitOrientation(onFallbackChange: (visible: boolean) => void): () => void {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const touch = navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches;
  const landscape = window.matchMedia("(orientation: landscape)");
  const orientation = window.screen?.orientation as (ScreenOrientation & { lock?: (value: string) => Promise<void> }) | undefined;
  let lockUnavailable = typeof orientation?.lock !== "function";
  let disposed = false;
  let locking = false;
  const publish = () => onFallbackChange(shouldShowPortraitFallback({ standalone, touch, landscape: landscape.matches, lockUnavailable }));
  const lock = () => {
    if (disposed || !standalone || !touch || document.visibilityState === "hidden") { publish(); return; }
    if (!orientation?.lock) { lockUnavailable = true; publish(); return; }
    if (locking) return;
    locking = true;
    try {
      void orientation.lock("portrait-primary").then(() => { lockUnavailable = false; }).catch(() => { lockUnavailable = true; }).finally(() => {
        locking = false;
        if (!disposed) publish();
      });
    } catch {
      locking = false;
      lockUnavailable = true;
      publish();
    }
  };
  const visible = () => { if (document.visibilityState !== "hidden") lock(); };
  publish();
  lock();
  window.addEventListener("pageshow", lock);
  window.addEventListener("orientationchange", lock);
  document.addEventListener("visibilitychange", visible);
  landscape.addEventListener("change", lock);
  return () => {
    disposed = true;
    window.removeEventListener("pageshow", lock);
    window.removeEventListener("orientationchange", lock);
    document.removeEventListener("visibilitychange", visible);
    landscape.removeEventListener("change", lock);
  };
}
