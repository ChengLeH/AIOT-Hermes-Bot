import { AiotHead } from "./bot-avatar";
import { BrandMark } from "./brand-mark";
import { APP_SLOGAN, BRAND_EYE, launchDuration } from "@/lib/brand";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function LaunchScreen({ onDone }: { onDone: () => void }) {
  const [reduced, setReduced] = useState(false);
  const screen = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = screen.current;
    if (!element) return;
    // Keep the first rendered geometry while PWA chrome and the app viewport settle.
    const height = element.getBoundingClientRect().height;
    if (height <= 0) return;
    const style = window.getComputedStyle(element);
    const top = style.paddingTop;
    const bottom = style.paddingBottom;
    element.style.setProperty("--launch-height", `${height}px`);
    element.style.setProperty("--launch-unit", `${height / 100}px`);
    element.style.setProperty("--launch-safe-top", top);
    element.style.setProperty("--launch-safe-bottom", bottom);
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(motion.matches);
    const ms = launchDuration(motion.matches);
    const timer = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      ref={screen}
      className={reduced ? "launch-screen launch-screen-reduced" : "launch-screen"}
      role="presentation"
      aria-hidden
    >
      <div className="launch-lockup">
        <AiotHead className="launch-mark" eye={BRAND_EYE} />
        <BrandMark className="launch-brand text-base text-fg" />
        <p className="launch-slogan">{APP_SLOGAN}</p>
      </div>
    </div>
  );
}
