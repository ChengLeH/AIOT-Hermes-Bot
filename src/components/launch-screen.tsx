import { AiotHead } from "./bot-avatar";
import { BrandMark } from "./brand-mark";
import { APP_SLOGAN, BRAND_EYE, launchDuration } from "@/lib/brand";
import { useEffect, useState } from "react";

export function LaunchScreen({ onDone }: { onDone: () => void }) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(motion.matches);
    const ms = launchDuration(motion.matches);
    const timer = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div
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
