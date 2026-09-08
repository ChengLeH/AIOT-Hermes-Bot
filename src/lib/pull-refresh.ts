import { useRef, useState, type TouchEvent } from "react";

/** Refresh only a deliberate downward gesture at the top of a scroll area. */
export function usePullRefresh() {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [distance, setDistance] = useState(0);
  const reset = () => { start.current = null; setDistance(0); };
  return {
    distance,
    handlers: {
      onTouchStart(e: TouchEvent<HTMLElement>) {
        if (e.touches.length !== 1 || (e.target as HTMLElement).closest("input, textarea, button, select, a")) return reset();
        let node = e.target as HTMLElement | null;
        while (node) {
          if (node.scrollTop > 0) return reset();
          if (node === e.currentTarget) break;
          node = node.parentElement;
        }
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      },
      onTouchMove(e: TouchEvent<HTMLElement>) {
        if (!start.current || e.touches.length !== 1) return;
        const dx = Math.abs(e.touches[0].clientX - start.current.x);
        const dy = e.touches[0].clientY - start.current.y;
        if (dx > 35 || dy < 0) return reset();
        setDistance(Math.min(dy, 120));
      },
      onTouchEnd() {
        if (distance >= 90) window.location.reload();
        reset();
      },
      onTouchCancel: reset,
    },
  };
}
