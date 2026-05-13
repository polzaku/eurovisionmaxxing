"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export interface ToastEvent {
  id: string;
  announcingUserDisplayName: string;
  country: string;
  flagEmoji: string;
  /** Points awarded in this reveal. 12 for short style; 1–8/10/12 for full style. */
  points: number;
  at: number;
}

interface RevealToastProps {
  events: ToastEvent[];
  /** Default 3000ms per SPEC §10.2 surface table (guest-phone toast). */
  dismissAfterMs?: number;
}

/**
 * SPEC §10.2 (full + short styles) — transient toast for guest phones
 * (anyone who isn't the active announcer/delegate) on every announce_next
 * broadcast. Shows the latest event; auto-dismisses after 3s.
 */
export default function RevealToast({
  events,
  dismissAfterMs = 3000,
}: RevealToastProps) {
  const t = useTranslations();
  const [visible, setVisible] = useState<ToastEvent | null>(null);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    setVisible(latest);
    const timer = setTimeout(() => {
      setVisible((prev) => (prev?.id === latest.id ? null : prev));
    }, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [events, dismissAfterMs]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="reveal-toast"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm rounded-full bg-primary/95 px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg motion-safe:animate-fade-in"
    >
      {t("announce.revealToast", {
        name: visible.announcingUserDisplayName,
        points: visible.points,
        country: visible.country,
        flag: visible.flagEmoji,
      })}
    </div>
  );
}
