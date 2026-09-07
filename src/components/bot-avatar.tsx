import { cn } from "@/lib/utils";
import {
  EYE_CX_LEFT,
  EYE_CX_RIGHT,
  EYE_CY,
  EYE_RX,
  EYE_RY,
  HEAD_OUTLINE,
  HEAD_SIZE,
  HEAD_X,
  resolveEyeSwatch,
  type EyeSwatch,
} from "@/lib/brand";

type Props = {
  swatch: string;
  profile?: string;
  state?: "idle" | "working" | "waiting" | "done";
  size?: number;
  className?: string;
};

export function BotAvatar({ swatch, profile = "", state = "idle", size = 44, className }: Props) {
  const eye = resolveEyeSwatch(swatch, profile);
  const cls =
    state === "working" ? "avatar-working" : state === "waiting" ? "avatar-waiting" : "avatar-idle";
  return (
    <span
      data-swatch={eye}
      className={cn("relative inline-flex shrink-0", state === "working" ? "avatar-spin" : "", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <AiotHead className={cn("h-full w-full", cls)} />
    </span>
  );
}

export function AiotHead({ className = "", eye }: { className?: string; eye?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none">
      <rect
        x={HEAD_X}
        y={HEAD_X}
        width={HEAD_SIZE}
        height={HEAD_SIZE}
        rx="13.5"
        ry="13.5"
        stroke={HEAD_OUTLINE}
        strokeWidth="2.6"
      />
      <g className="aiot-eyes lid" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <ellipse className="pupil" cx={EYE_CX_LEFT} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} fill={eye || "var(--bot-eye)"} />
        <ellipse className="pupil" cx={EYE_CX_RIGHT} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} fill={eye || "var(--bot-eye)"} />
      </g>
    </svg>
  );
}

export function WorkTicker({
  swatch,
  label,
  className,
}: {
  swatch: EyeSwatch | string;
  label: string;
  className?: string;
}) {
  return (
    <div data-swatch={swatch} className={cn("flex w-40 flex-col gap-2", className)}>
      <span className="work-track" aria-hidden>
        <i />
      </span>
      <p className="text-xs tracking-wide text-muted">{label}</p>
    </div>
  );
}
