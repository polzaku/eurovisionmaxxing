"use client";

import { useTranslations } from "next-intl";
import { stillToGive } from "@/lib/announce/stillToGive";

export interface StillToGiveLineProps {
  /** Server's current pointer into the per-announcer points queue (0–10). */
  currentAnnounceIdx: number;
}

/**
 * SPEC §10.2 — full-style active-driver "Still to give: 7, 8, 10, 12" line.
 * Renders the canonical 10-point sequence with already-given values
 * struck through and remaining values bolded. Mounted by AnnouncingView
 * only when isActiveDriver && announcementStyle === 'full'.
 */
export default function StillToGiveLine({
  currentAnnounceIdx,
}: StillToGiveLineProps) {
  const t = useTranslations("announcing.stillToGive");
  const { given, remaining } = stillToGive(currentAnnounceIdx);
  return (
    <p
      className="font-mono text-xs tabular-nums text-muted-foreground text-center"
      aria-label={t("aria", { remaining: remaining.join(", ") })}
      data-testid="still-to-give-line"
    >
      <span className="mr-2 text-[10px] uppercase tracking-wider">
        {t("label")}
      </span>
      {given.map((p) => (
        <span
          key={`g-${p}`}
          data-testid={`stg-given-${p}`}
          className="mx-0.5 line-through text-muted-foreground/40"
        >
          {p}
        </span>
      ))}
      {remaining.map((p) => (
        <span
          key={`r-${p}`}
          data-testid={`stg-remaining-${p}`}
          className="mx-0.5 font-semibold text-foreground"
        >
          {p}
        </span>
      ))}
    </p>
  );
}
