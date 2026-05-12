"use client";

import { useTranslations } from "next-intl";

export interface OfflineBannerProps {
  visible: boolean;
}

/**
 * Sticky top-of-screen banner shown when the browser is offline.
 * SPEC §8.5 copy: "You're offline — changes will sync when you reconnect."
 */
export default function OfflineBanner({ visible }: OfflineBannerProps) {
  const t = useTranslations("voting.offline");
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-2 mx-4 z-10 rounded-lg border border-accent/30 bg-accent/10 text-accent text-center px-4 py-2 text-sm font-medium backdrop-blur-sm"
    >
      {t("banner")}
    </div>
  );
}
