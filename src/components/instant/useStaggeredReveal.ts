"use client";

import { useEffect, useRef, useState } from "react";
import { staggerTick } from "@/lib/instant/staggerTick";

export interface UseStaggeredRevealOptions {
  totalSteps: number;
  staggerMs: number;
  /** Fires once when currentStep first reaches totalSteps. */
  onComplete?: () => void;
  /** When false, snap to totalSteps immediately (used for prefers-reduced-motion). */
  enabled?: boolean;
}

export interface UseStaggeredRevealResult {
  currentStep: number;
  isComplete: boolean;
}

/**
 * Drives a stepwise stagger over `requestAnimationFrame`. Uses the pure
 * `staggerTick` helper so the arithmetic is testable in isolation.
 */
export function useStaggeredReveal(
  opts: UseStaggeredRevealOptions,
): UseStaggeredRevealResult {
  const { totalSteps, staggerMs, onComplete, enabled = true } = opts;

  const [currentStep, setCurrentStep] = useState(() =>
    enabled ? 0 : totalSteps,
  );
  const completeFiredRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setCurrentStep(totalSteps);
      if (!completeFiredRef.current) {
        completeFiredRef.current = true;
        onComplete?.();
      }
      return;
    }

    cancelledRef.current = false;
    startRef.current = null;
    completeFiredRef.current = false;

    const tick = (now: number) => {
      if (cancelledRef.current) return;
      if (startRef.current === null) startRef.current = now;
      const elapsedMs = now - startRef.current;
      const next = staggerTick({ elapsedMs, staggerMs, totalSteps });
      setCurrentStep((prev) => (prev === next ? prev : next));
      if (next >= totalSteps) {
        if (!completeFiredRef.current) {
          completeFiredRef.current = true;
          onComplete?.();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelledRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // onComplete intentionally not in deps — caller is expected to memoize or
    // tolerate identity churn (we only call it once via completeFiredRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staggerMs, totalSteps]);

  return { currentStep, isComplete: currentStep >= totalSteps };
}
