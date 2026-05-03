"use client";

import { useTranslations } from "next-intl";

interface ScoredByChipProps {
  /** Number of room members fully scored on this contestant (per §8.2 scored definition). */
  count: number;
  /** Total room members. */
  total: number;
  /** "md" (default) for the contestant card header; "sm" for jump-to drawer rows. */
  size?: "md" | "sm";
}

/**
 * SPEC §8.8 per-contestant "scored by N / M" chip. Three visual states
 * along the colour ladder:
 * - `0 / M` → muted neutral.
 * - `1 ≤ N < M` → muted with the N highlighted as foreground.
 * - `N = M` → primary (gold) badge with a check glyph + "all scored".
 *
 * Source data is the existing `voting_progress` realtime broadcast
 * accumulated client-side via `votingProgressReducer`. No new endpoint.
 */
export default function ScoredByChip({
  count,
  total,
  size = "md",
}: ScoredByChipProps) {
  const t = useTranslations();

  if (total <= 0) {
    return null;
  }

  const allScored = count === total;
  const baseClass =
    size === "sm"
      ? "text-[10px] tabular-nums whitespace-nowrap"
      : "text-xs tabular-nums whitespace-nowrap";

  if (allScored) {
    return (
      <span
        data-testid="scored-by-chip"
        className={`${baseClass} font-medium text-primary`}
      >
        ✓ {t("voting.scoredChip.all")}
      </span>
    );
  }

  return (
    <span
      data-testid="scored-by-chip"
      className={`${baseClass} text-muted-foreground`}
    >
      <span className={count > 0 ? "text-foreground font-medium" : ""}>
        {`${count} / ${total}`}
      </span>{" "}
      {t("voting.scoredChip.partial")}
    </span>
  );
}
