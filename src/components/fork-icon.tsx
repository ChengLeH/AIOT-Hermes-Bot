import type { SVGProps } from "react";

/** A shared straight route with a curved branch, both pointing right. */
export function ForkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M3 7H21M18 4L21 7L18 10" />
      <path d="M9 7V12C9 15 11 17 14 17H21M18 14L21 17L18 20" />
    </svg>
  );
}

/** Separate parallel routes: start without bringing the parent conversation. */
export function IndependentTaskIcon(props: SVGProps<SVGSVGElement>) {
  return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d="M3 7H21M18 4L21 7L18 10M3 17H21M18 14L21 17L18 20" />
  </svg>;
}
