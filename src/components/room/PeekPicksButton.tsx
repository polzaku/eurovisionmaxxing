"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import UserPicksList from "@/components/voting/UserPicksList";
import type { Contestant } from "@/types";

interface PeekPicksButtonProps {
  picks: Array<{ contestantId: string; pointsAwarded: number }>;
  contestants: Contestant[];
}

/**
 * TODO #10 (slice A) — "Peek your picks" button + bottom sheet for the
 * active announcer. The sheet renders the announcer's own 1→12 list so
 * they can prep before reveals and check at any point during their
 * turn. ESC + tap-outside + close-button all dismiss.
 *
 * Visibility gating (active announcer only) is the parent's
 * responsibility. This component just renders the button + sheet
 * machinery.
 */
export default function PeekPicksButton({
  picks,
  contestants,
}: PeekPicksButtonProps) {
  const t = useTranslations("announcing.peek");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        data-testid="peek-picks-button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-all hover:bg-muted active:scale-[0.98]"
      >
        <span aria-hidden>👀</span>
        <span>{t("button")}</span>
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="peek-picks-title"
        >
          <div
            className="fixed inset-0 z-30 bg-foreground/40 animate-fade-in"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div
            data-testid="peek-picks-sheet"
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-background shadow-2xl"
          >
            <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
              <h3 id="peek-picks-title" className="text-lg font-semibold">
                {t("sheetTitle")}
              </h3>
              <button
                type="button"
                data-testid="peek-picks-close"
                aria-label={t("closeAria")}
                onClick={() => setIsOpen(false)}
                className="rounded px-2 py-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <UserPicksList picks={picks} contestants={contestants} />
              <p className="mt-4 text-center text-xs italic text-muted-foreground">
                {t("privacyNote")}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
