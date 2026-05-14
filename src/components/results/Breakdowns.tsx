"use client";

import Avatar from "@/components/ui/Avatar";
import type { Contestant } from "@/types";
import type { UserBreakdown } from "@/lib/results/loadResults";

export interface BreakdownsLabels {
  title: string;
  picksLabel: (n: number) => string;
  openParticipantAria: (displayName: string) => string;
}

export interface BreakdownsProps {
  breakdowns: UserBreakdown[];
  contestants: Contestant[];
  labels: BreakdownsLabels;
  /**
   * SPEC §12.6.2 — invoked when the avatar button is tapped. When undefined
   * (e.g. server-rendered fallback consumers), the avatar still renders
   * but is non-interactive.
   */
  onOpenParticipant?: (userId: string) => void;
}

export default function Breakdowns({
  breakdowns,
  contestants,
  labels,
  onOpenParticipant,
}: BreakdownsProps) {
  const contestantById = new Map(contestants.map((c) => [c.id, c]));

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{labels.title}</h2>
      <div className="space-y-3">
        {breakdowns.map((b) => (
          <details
            key={b.userId}
            data-testid={`breakdown-${b.userId}`}
            className="rounded-xl border-2 border-border overflow-hidden"
          >
            <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                {onOpenParticipant ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onOpenParticipant(b.userId);
                    }}
                    aria-label={labels.openParticipantAria(b.displayName)}
                    className="rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <Avatar seed={b.avatarSeed} size={32} />
                  </button>
                ) : (
                  <Avatar seed={b.avatarSeed} size={32} />
                )}
                <span className="font-medium">{b.displayName}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {labels.picksLabel(b.picks.length)}
              </span>
            </summary>
            <ul className="border-t border-border divide-y divide-border">
              {b.picks.map((p) => {
                const c = contestantById.get(p.contestantId);
                return (
                  <li
                    key={p.contestantId}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{c?.flagEmoji ?? "🏳️"}</span>
                      <span>{c?.country ?? p.contestantId}</span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {p.pointsAwarded}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
