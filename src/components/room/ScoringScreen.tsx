"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

interface ScoringScreenProps {
  /** Required for the host TV-mode CTA — passed from the room page. */
  roomId?: string;
  isAdmin?: boolean;
  announcementMode?: "live" | "instant";
}

/**
 * SPEC §6.3 / L9 — "Tallying results…" surface shown to every client
 * during the brief `scoring` status.
 *
 * Host-only extension (2026-05-14): when `announcement_mode === 'live'`,
 * surface a prominent CTA to launch `/room/{id}/present` on the TV. The
 * scoring screen is the last calm moment before announcement begins, so
 * it's the right beat to remind the host to cast.
 */
export default function ScoringScreen({
  roomId,
  isAdmin = false,
  announcementMode,
}: ScoringScreenProps = {}) {
  const t = useTranslations();
  const showTvCta = isAdmin && announcementMode === "live" && !!roomId;

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
        {showTvCta ? <TvModeCta roomId={roomId} /> : null}
      </div>
    </main>
  );
}

function TvModeCta({ roomId }: { roomId: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  const presentPath = `/room/${roomId}/present`;
  const absoluteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${presentPath}`
      : presentPath;

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — silently no-op (browser will log). */
    }
  }, [absoluteUrl]);

  return (
    <section
      data-testid="scoring-tv-mode-cta"
      className="rounded-2xl border-2 border-primary/40 bg-primary/5 px-5 py-5 text-left space-y-3"
    >
      <h2 className="text-base font-semibold">{t("scoring.tvMode.title")}</h2>
      <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
        <li>{t("scoring.tvMode.bullet1")}</li>
        <li>{t("scoring.tvMode.bullet2")}</li>
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={presentPath}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("scoring.tvMode.openButtonAria")}
          className="inline-flex flex-1 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          {t("scoring.tvMode.openButton")}
        </a>
        <button
          type="button"
          onClick={onCopy}
          aria-label={t("scoring.tvMode.copyButton")}
          className="inline-flex flex-1 items-center justify-center rounded-xl border-2 border-primary/40 bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary"
        >
          {copied
            ? t("scoring.tvMode.copyConfirm")
            : t("scoring.tvMode.copyButton")}
        </button>
      </div>
    </section>
  );
}
