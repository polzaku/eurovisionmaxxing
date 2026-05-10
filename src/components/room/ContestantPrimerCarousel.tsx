"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";
import { markSeen } from "@/lib/voting/emxHintsSeen";

interface PrimerCardCategory {
  name: string;
  hint?: string;
}

interface ContestantPrimerCarouselProps {
  contestants: Contestant[];
  categories: PrimerCardCategory[];
  roomId: string;
}

/**
 * SPEC §6.6.3 — horizontally scrollable card deck shown in the lobby.
 * Tap a card to flip and reveal category hints + an optional
 * "Preview on YouTube" deep-link. First flip writes the
 * `emx_hints_seen_{roomId}` localStorage flag.
 */
export default function ContestantPrimerCarousel({
  contestants,
  categories,
  roomId,
}: ContestantPrimerCarouselProps) {
  const t = useTranslations();

  if (contestants.length === 0) return null;

  const categoriesWithHints = categories.filter((c) => c.hint);

  return (
    <section
      data-testid="contestant-primer-carousel"
      className="space-y-3"
    >
      <header className="space-y-1">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          {t("lobby.primer.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("lobby.primer.tapHint")}
        </p>
      </header>
      <ol
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4"
        role="list"
      >
        {contestants.map((c) => (
          <li
            key={c.id}
            className="flex-none snap-start"
            style={{ minWidth: "200px", maxWidth: "240px" }}
          >
            <PrimerCard
              contestant={c}
              categoriesWithHints={categoriesWithHints}
              onFirstFlip={() => markSeen(roomId)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

interface PrimerCardProps {
  contestant: Contestant;
  categoriesWithHints: PrimerCardCategory[];
  onFirstFlip: () => void;
}

function PrimerCard({
  contestant,
  categoriesWithHints,
  onFirstFlip,
}: PrimerCardProps) {
  const t = useTranslations();
  const [flipped, setFlipped] = useState(false);

  const handleClick = () => {
    setFlipped((prev) => {
      if (!prev) onFirstFlip(); // front → back transition
      return !prev;
    });
  };

  return (
    <button
      type="button"
      className={`emx-flip-card ${flipped ? "is-flipped" : ""} block w-full aspect-[3/4]`}
      onClick={handleClick}
      data-testid={`primer-card-${contestant.id}`}
      data-flipped={flipped ? "true" : "false"}
      aria-pressed={flipped}
    >
      <div className="emx-flip-card__inner">
        {/* Front */}
        <div
          className="emx-flip-card__face emx-flip-card__front rounded-2xl border-2 border-border bg-card flex flex-col items-center text-center p-4 gap-2 justify-center"
          aria-hidden={flipped}
        >
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            № {contestant.runningOrder}
          </span>
          <span
            className="text-6xl"
            role="img"
            aria-label={t("lobby.primer.flagAria", {
              country: contestant.country,
            })}
          >
            {contestant.flagEmoji}
          </span>
          <p className="text-lg font-bold leading-tight">{contestant.country}</p>
          <p className="text-sm font-medium">{contestant.artist}</p>
          <p className="text-xs italic text-muted-foreground">
            {contestant.song}
          </p>
        </div>

        {/* Back */}
        <div
          className="emx-flip-card__face emx-flip-card__back rounded-2xl border-2 border-border bg-card flex flex-col p-4 gap-2 overflow-y-auto"
          aria-hidden={!flipped}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-2xl"
              role="img"
              aria-label={contestant.country}
            >
              {contestant.flagEmoji}
            </span>
          </div>
          <ul className="space-y-1 text-xs flex-1">
            {categoriesWithHints.map((c) => (
              <li key={c.name}>
                <span className="font-semibold">{c.name}:</span> {c.hint}
              </li>
            ))}
          </ul>
          {contestant.artistPreviewUrl ? (
            <a
              href={contestant.artistPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent underline mt-2"
              onClick={(e) => e.stopPropagation()}
            >
              {t("lobby.primer.previewSong")} ↗
            </a>
          ) : null}
        </div>
      </div>
    </button>
  );
}
