"use client";

import { useEffect, useRef } from "react";

/**
 * Count-up number for KPI tiles. Renders the final value in markup (so SSR,
 * no-JS, and reduced-motion all show the truth immediately) and only animates
 * the presentation when motion is allowed.
 */
export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dur = 700;
    let t0: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (value * eased).toFixed(decimals);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, decimals]);

  return (
    <span ref={ref} className={className}>
      {value.toFixed(decimals)}
    </span>
  );
}
