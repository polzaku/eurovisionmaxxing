"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";
import Button from "@/components/ui/Button";

export interface OwnBreakdownEntry {
  contestantId: string;
  pointsAwarded: number;
  hotTake: string | null;
}

export interface OwnPointsCeremonyProps {
  entries: OwnBreakdownEntry[];
  contestants: Contestant[];
  /** Fires when the user has seen all of their picks (12 revealed, or
   *  no 12 to reveal — i.e. degenerate cases that don't gate Ready). */
  onAllRevealed: () => void;
}

export default function OwnPointsCeremony({
  entries,
  contestants,
  onAllRevealed,
}: OwnPointsCeremonyProps) {
  const t = useTranslations();

  const byId = useMemo(() => {
    const m = new Map<string, Contestant>();
    for (const c of contestants) m.set(c.id, c);
    return m;
  }, [contestants]);

  const scored = useMemo(
    () => entries.filter((e) => e.pointsAwarded > 0),
    [entries],
  );
  const top = useMemo(
    () => scored.find((e) => e.pointsAwarded === 12) ?? null,
    [scored],
  );
  const lower = useMemo(
    () =>
      scored
        .filter((e) => e.pointsAwarded !== 12)
        .sort((a, b) => b.pointsAwarded - a.pointsAwarded),
    [scored],
  );

  // Degenerate cases (no entries scored, or no 12-pt pick): no ceremony
  // gate — the parent's Ready CTA is enabled immediately.
  const hasCeremony = top !== null;
  const [topRevealed, setTopRevealed] = useState(!hasCeremony);

  // Fire onAllRevealed exactly once: either on mount when there's no
  // ceremony, or after the user reveals/skips the 12.
  // (Parent gates Ready on this signal.)
  useEffect(() => {
    if (topRevealed) onAllRevealed();
    // onAllRevealed deliberately omitted: parent passes a fresh callback
    // each render; we only want to fire once on the topRevealed flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topRevealed]);

  const handleReveal = () => setTopRevealed(true);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          {t("instantAnnounce.ownResults.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("instantAnnounce.ownResults.subtitle")}
        </p>
      </div>

      {scored.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instantAnnounce.ownResults.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {topRevealed && top ? (
            <PickRow
              key={top.contestantId}
              entry={top}
              contestant={byId.get(top.contestantId) ?? null}
              isTop
              twelveLabel={t("instantAnnounce.ownResults.twelveLabel")}
            />
          ) : null}
          {lower.map((entry) => (
            <PickRow
              key={entry.contestantId}
              entry={entry}
              contestant={byId.get(entry.contestantId) ?? null}
            />
          ))}
        </ul>
      )}

      {!topRevealed ? (
        <div className="space-y-2 pt-2">
          <Button
            variant="primary"
            onClick={handleReveal}
            className="w-full"
          >
            {t("instantAnnounce.ownResults.revealTwelveButton")}
          </Button>
          <button
            type="button"
            onClick={handleReveal}
            className="block mx-auto text-xs text-muted-foreground underline hover:text-foreground"
          >
            {t("instantAnnounce.ownResults.revealTwelveSkip")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface PickRowProps {
  entry: OwnBreakdownEntry;
  contestant: Contestant | null;
  isTop?: boolean;
  twelveLabel?: string;
}

function PickRow({ entry, contestant, isTop, twelveLabel }: PickRowProps) {
  return (
    <li
      className={
        "flex items-start gap-3 rounded-lg border px-3 py-2 " +
        (isTop
          ? "border-primary motion-safe:animate-fade-in motion-safe:emx-glow-gold"
          : "border-border")
      }
    >
      <span
        className={
          "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums " +
          (isTop
            ? "bg-primary text-primary-foreground"
            : "bg-primary/10 text-primary")
        }
      >
        {entry.pointsAwarded}
      </span>
      <div className="flex-1 min-w-0">
        {isTop && twelveLabel ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
            {twelveLabel}
          </p>
        ) : null}
        <p className="text-sm font-medium text-foreground truncate">
          {contestant?.flagEmoji ?? "🏳️"} {contestant?.country ?? entry.contestantId}
          {contestant ? ` — ${contestant.song}` : ""}
        </p>
        {entry.hotTake ? (
          <p className="text-xs text-muted-foreground italic mt-1">
            &ldquo;{entry.hotTake}&rdquo;
          </p>
        ) : null}
      </div>
    </li>
  );
}
