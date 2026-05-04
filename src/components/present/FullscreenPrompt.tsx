"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * SPEC §10.3 / L13 — iOS Safari fullscreen fallback. When the present
 * route loads but the document isn't in fullscreen (common on iOS
 * Safari unless the page was launched from the home screen as a PWA),
 * we surface a small "Enter fullscreen" pill that triggers
 * `requestFullscreen()` on the user gesture.
 *
 * Behaviour:
 * - Mounted state checks `document.fullscreenElement` and any vendor
 *   prefixes; if already fullscreen, renders nothing.
 * - On exit-fullscreen (`fullscreenchange` event), the pill reappears.
 * - Dismissible — tapping the × hides it for the rest of the session
 *   (a flag in component state, not localStorage; reload re-arms it).
 * - On browsers without the Fullscreen API, the pill does not render
 *   (silently no-op per spec).
 */
export default function FullscreenPrompt() {
  const t = useTranslations();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (typeof document.documentElement.requestFullscreen !== "function") {
      setSupported(false);
      return;
    }
    setSupported(true);

    const update = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  if (!supported) return null;
  if (isFullscreen) return null;
  if (dismissed) return null;

  const handleEnter = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* user-rejected or browser blocked — silently no-op */
    }
  };

  return (
    <div
      data-testid="fullscreen-prompt"
      role="dialog"
      aria-label={t("present.fullscreen.aria")}
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background/95 px-4 py-2 shadow-lg motion-safe:animate-fade-in"
    >
      <button
        type="button"
        onClick={() => void handleEnter()}
        className="text-sm font-semibold text-foreground hover:text-primary"
      >
        {t("present.fullscreen.enter")}
      </button>
      <button
        type="button"
        aria-label={t("present.fullscreen.dismissAria")}
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground px-1"
      >
        ×
      </button>
    </div>
  );
}
