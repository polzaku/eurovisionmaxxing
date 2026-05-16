"use client";

import { useTranslations } from "next-intl";

interface SkippedCategoriesPillProps {
  /** Number of categories the user has NOT scored for this contestant. */
  skipped: number;
  /** Total number of voting categories in this room. */
  total: number;
  /** "md" (default) for the contestant card header; "sm" for jump-to rows. */
  size?: "md" | "sm";
}

/**
 * TODO #3 — a soft warning that surfaces when a user has set ≥1 category
 * score on a contestant and left ≥1 unset (i.e. partial). Renders
 * nothing for fully-scored (skipped=0) or fully-unscored (would be
 * the "Not scored" status, handled elsewhere) rows.
 *
 * Informational only — does not block save or submission. The current
 * `computeWeightedScore` silently renormalises across given categories,
 * so partial scores still count; the pill just makes the gap visible
 * so users decide whether to fill in or accept the partial weight.
 */
export default function SkippedCategoriesPill({
  skipped,
  total,
  size = "md",
}: SkippedCategoriesPillProps) {
  const t = useTranslations("voting.skipped");
  if (skipped <= 0 || skipped >= total) return null;

  const baseClass =
    size === "sm"
      ? "text-[10px] tabular-nums whitespace-nowrap"
      : "text-xs tabular-nums whitespace-nowrap";

  return (
    <span
      data-testid="skipped-categories-pill"
      className={`${baseClass} text-muted-foreground`}
    >
      {t("pill", { skipped, total })}
    </span>
  );
}
