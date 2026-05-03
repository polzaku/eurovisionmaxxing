"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import AwardCeremonyCard from "./AwardCeremonyCard";
import type { CeremonyCard } from "@/lib/awards/awardCeremonySequence";

interface AwardsCeremonyProps {
  sequence: CeremonyCard[];
  onAllRevealed: () => void;
}

/**
 * SPEC §11.3 cinematic awards reveal driver. Renders one card at a time,
 * with three advance affordances: tap anywhere on the screen, the always-
 * visible "Next award" corner button (Phase U L14), or the Space / Enter
 * key. Fires `onAllRevealed` exactly once after the user advances past
 * the final card. Empty sequence → fires immediately on mount.
 */
export default function AwardsCeremony({
  sequence,
  onAllRevealed,
}: AwardsCeremonyProps) {
  const t = useTranslations();
  const [index, setIndex] = useState(0);
  const firedRef = useRef(false);

  // index moves from 0 to sequence.length. When it reaches sequence.length
  // (i.e. the user has advanced past the final card), we fire onAllRevealed
  // exactly once. Side-effects on parent state are kept out of the setIndex
  // updater per React's "no setState-in-render" rule (firing during the
  // updater fn ran into a "Cannot update component during render" warning
  // when DoneCeremony was the parent).
  useEffect(() => {
    if (firedRef.current) return;
    if (sequence.length === 0) {
      firedRef.current = true;
      onAllRevealed();
      return;
    }
    if (index >= sequence.length) {
      firedRef.current = true;
      onAllRevealed();
    }
  }, [index, sequence.length, onAllRevealed]);

  const advance = useCallback(() => {
    if (firedRef.current) return;
    setIndex((i) => Math.min(i + 1, sequence.length));
  }, [sequence.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance]);

  if (sequence.length === 0) return null;

  const card = sequence[Math.min(index, sequence.length - 1)];
  const total = sequence.length;
  const human = Math.min(index + 1, total);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <button
        type="button"
        data-testid="awards-tap-zone"
        aria-label={t("awards.ceremony.advanceHint")}
        onClick={advance}
        className="absolute inset-0 z-0 cursor-pointer bg-transparent"
      />
      <div className="relative z-10 w-full max-w-md">
        <AwardCeremonyCard key={card.award.awardKey} card={card} />
      </div>
      <button
        type="button"
        data-testid="awards-next-button"
        onClick={advance}
        aria-label={t("awards.ceremony.nextAwardAria", {
          current: human,
          total,
        })}
        className="absolute bottom-6 right-6 z-10 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        {t("awards.ceremony.nextAward")} · {human} / {total}
      </button>
    </main>
  );
}
