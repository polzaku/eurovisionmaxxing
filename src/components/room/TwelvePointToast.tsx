"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export interface ToastEvent {
  id: string;
  announcingUserDisplayName: string;
  country: string;
  flagEmoji: string;
  at: number;
}

interface TwelvePointToastProps {
  events: ToastEvent[];
  /** Default 3000ms per SPEC §10.2.2 surface table. */
  dismissAfterMs?: number;
}

/**
 * SPEC §10.2.2 — transient toast for guest phones (non-announcer, non-
 * owner-watching) when the announcer reveals their 12-point pick.
 * Shows the latest event; auto-dismisses after 3s.
 */
export default function TwelvePointToast({
  events,
  dismissAfterMs = 3000,
}: TwelvePointToastProps) {
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
      data-testid="twelve-point-toast"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm rounded-full bg-primary/95 px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg motion-safe:animate-fade-in"
    >
      {t("announce.shortReveal.guestToast", {
        name: visible.announcingUserDisplayName,
        country: visible.country,
        flag: visible.flagEmoji,
      })}
    </div>
  );
}
