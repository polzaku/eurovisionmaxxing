"use client";

import { useTranslations } from "next-intl";
import { writeTvModeChoice, type TvModeChoice } from "@/lib/room/tvModeChoice";

interface TvModeChooserProps {
  roomId: string;
  /**
   * Fires after the host commits to either choice. The parent dismisses
   * the chooser by removing it from the render tree (typical pattern:
   * track `tvChoice !== null` in state).
   */
  onChosen: (choice: TvModeChoice) => void;
}

/**
 * Host-only banner at the top of the AnnouncingView. The previous Fix 6
 * (2026-05-14) only surfaced the TV CTA on the sub-second scoring screen —
 * host had no real chance to interact with it before being whisked into
 * the live announcement.
 *
 * Renders as a non-modal banner so it never blocks the host from
 * driving an in-progress reveal (the active-announcer / delegate case).
 * The host picks "Open TV mode" or "Continue on phone"; either way the
 * choice is persisted to sessionStorage keyed by roomId so a refresh
 * mid-show doesn't re-prompt.
 */
export default function TvModeChooser({
  roomId,
  onChosen,
}: TvModeChooserProps) {
  const t = useTranslations("tvMode");
  const presentPath = `/room/${roomId}/present`;

  const choose = (choice: TvModeChoice) => {
    writeTvModeChoice(roomId, choice);
    onChosen(choice);
  };

  return (
    <section
      role="region"
      aria-labelledby="tv-mode-chooser-title"
      data-testid="tv-mode-chooser"
      className="rounded-2xl border-2 border-primary bg-primary/5 px-5 py-5 space-y-4 motion-safe:animate-fade-in"
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none" aria-hidden>
          📺
        </span>
        <div className="flex-1 space-y-1.5">
          <h2
            id="tv-mode-chooser-title"
            className="text-base font-semibold leading-tight"
          >
            {t("chooser.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("chooser.body")}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={presentPath}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("chooser.openButtonAria")}
          onClick={() => choose("tv")}
          className="inline-flex flex-1 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          {t("chooser.openButton")}
        </a>
        <button
          type="button"
          onClick={() => choose("skip")}
          className="inline-flex flex-1 items-center justify-center rounded-xl border-2 border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary"
        >
          {t("chooser.skipButton")}
        </button>
      </div>
    </section>
  );
}
