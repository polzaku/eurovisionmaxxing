"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";

export interface OwnBreakdownEntry {
  contestantId: string;
  pointsAwarded: number;
  hotTake: string | null;
}

export interface InstantOwnBreakdownProps {
  entries: OwnBreakdownEntry[];
  contestants: Contestant[];
}

export default function InstantOwnBreakdown({
  entries,
  contestants,
}: InstantOwnBreakdownProps) {
  const t = useTranslations();
  const byId = useMemo(() => {
    const map = new Map<string, Contestant>();
    for (const c of contestants) map.set(c.id, c);
    return map;
  }, [contestants]);

  const sorted = useMemo(
    () =>
      entries
        .filter((e) => e.pointsAwarded > 0)
        .sort((a, b) => b.pointsAwarded - a.pointsAwarded),
    [entries],
  );

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
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instantAnnounce.ownResults.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((entry) => {
            const c = byId.get(entry.contestantId);
            if (!c) return null;
            return (
              <li
                key={entry.contestantId}
                className="flex items-start gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary tabular-nums">
                  {entry.pointsAwarded}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {c.flagEmoji} {c.country} — {c.song}
                  </p>
                  {entry.hotTake && (
                    <p className="text-xs text-muted-foreground italic mt-1">
                      &ldquo;{entry.hotTake}&rdquo;
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
