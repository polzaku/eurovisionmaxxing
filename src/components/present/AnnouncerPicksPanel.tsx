"use client";

import { useTranslations } from "next-intl";
import type { AnnouncerPick } from "@/lib/present/announcerBatch";

interface AnnouncerPicksPanelProps {
  announcerDisplayName: string;
  picks: AnnouncerPick[];
  /** When true, render the "+12 coming ✨" teaser footer. */
  pendingTwelve?: boolean;
}

/**
 * TODO #8 — the announcer's per-pick "stage". Shown alongside the
 * frozen room leaderboard during an announcer's reveal batch so the
 * room can see the composition (Sweden +1, France +2, …) without the
 * leaderboard collapsing it into the running totals. After the
 * announcer's 12-point reveal closes their batch, the page snapshots
 * the new leaderboard and the picks panel resets for the next
 * announcer.
 */
export default function AnnouncerPicksPanel({
  announcerDisplayName,
  picks,
  pendingTwelve,
}: AnnouncerPicksPanelProps) {
  const t = useTranslations("present.announcerPicks");
  return (
    <aside
      data-testid="present-announcer-picks"
      aria-label={t("title", { name: announcerDisplayName })}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-6"
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        {t("title", { name: announcerDisplayName })}
      </h3>
      {picks.length === 0 && !pendingTwelve ? (
        <p
          data-testid="present-announcer-picks-empty"
          className="text-sm italic text-muted-foreground"
        >
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {picks.map((p) => (
            <li
              key={p.contestantId}
              data-testid={`present-pick-${p.contestantId}`}
              className="flex items-center gap-3 text-2xl"
            >
              <span className="text-3xl" aria-hidden>
                {p.flagEmoji}
              </span>
              <span className="flex-1 truncate font-medium">{p.country}</span>
              <span className="font-mono tabular-nums text-primary">
                +{p.points}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pendingTwelve ? (
        <p
          data-testid="present-announcer-picks-pending-twelve"
          className="mt-2 text-lg font-semibold text-primary"
        >
          {t("pendingTwelve")}
        </p>
      ) : null}
    </aside>
  );
}
