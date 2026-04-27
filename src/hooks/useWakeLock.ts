"use client";

import { useEffect, useRef } from "react";
import { WakeLockController } from "@/lib/wakeLock/WakeLockController";

/**
 * Keeps the screen awake while `active` is true.
 * On unmount, releases the sentinel and removes listeners.
 * Silently no-ops on browsers without Web Wake Lock support.
 *
 * SPEC §8.9.
 */
export function useWakeLock(active: boolean): void {
  const ctrlRef = useRef<WakeLockController | null>(null);

  useEffect(() => {
    const ctrl = new WakeLockController();
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    ctrlRef.current?.setActive(active);
  }, [active]);
}
