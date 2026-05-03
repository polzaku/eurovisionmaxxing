"use client";

import { useTranslations } from "next-intl";

/**
 * SPEC §6.3 / L9 — "Tallying results…" surface shown to every client
 * during the brief `scoring` status. Replaces the apologetic generic
 * StatusStub for this transition. Uses the shared `animate-shimmer`
 * (reduced-motion gated in globals.css) and a stage-light backdrop
 * via the body's existing radial gradient.
 *
 * The scoring transition is short (`runScoring` is one orchestrator
 * call) but every guest sees this screen; making it feel deliberate
 * sets up the announcement reveal that follows.
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
