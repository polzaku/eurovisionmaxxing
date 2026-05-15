"use client";

import { useTranslations } from "next-intl";

/**
 * SPEC §6.3 / L9 — "Tallying results…" surface shown to every client
 * during the brief `scoring` status. The scoring transition is short
 * (`runScoring` is one orchestrator call), so we keep this surface
 * intentionally minimal — anything that the host needs to interact with
 * has to live somewhere that lasts longer than a sub-second flash.
 *
 * The host TV-mode CTA used to live here (Fix 6, 2026-05-14) but flashed
 * by too quickly to be useful. It now lives as a persistent modal-style
 * chooser on `<AnnouncingView>` (2026-05-15) so the host gets an
 * explicit "Open TV mode" / "Continue on phone" decision before the
 * reveals begin.
 */
export default function ScoringScreen() {
  const t = useTranslations();
  return (
    <main
      data-testid="scoring-screen"
      className="flex min-h-screen flex-col items-center justify-center px-6 py-12"
    >
      <div className="max-w-md w-full space-y-6 text-center motion-safe:animate-fade-in">
        <p className="text-5xl" aria-hidden>
          🎼
        </p>
        <h1
          className="text-2xl font-bold tracking-tight motion-safe:animate-shimmer"
          role="status"
          aria-live="polite"
        >
          {t("scoring.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("scoring.subtitle")}</p>
      </div>
    </main>
  );
}
