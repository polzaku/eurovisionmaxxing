"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const VISIBLE_MS = 1000;

interface CatchingUpPillProps {
  /** When this prop flips to true, the pill mounts and auto-fades after ~1 s. */
  active: boolean;
}

/**
 * SPEC §10.2 / TODO L10 — when a user joins or refreshes during the
 * announcing phase, surface a brief "Catching up…" pill at the top of
 * the screen so they understand they're landing into an in-flight reveal
 * rather than seeing a misleading "fresh state".
 *
 * Auto-clears after 1 second. Reduced-motion users skip the shimmer
 * (animate-shimmer is gated in globals.css).
 */
export default function CatchingUpPill({ active }: CatchingUpPillProps) {
  const t = useTranslations();
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (!active) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!visible) return null;

  return (
    <div
      data-testid="catching-up-pill"
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border bg-background/90 px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-md motion-safe:animate-fade-in"
    >
      <span className="motion-safe:animate-shimmer">
        {t("room.catchingUp")}
      </span>
    </div>
  );
}
