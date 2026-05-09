import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";
import type { ContestantBreakdown } from "@/lib/results/buildContestantBreakdowns";

export interface LeaderboardWithDrillDownLabels {
  /** Section heading. */
  title: string;
  /** Sub-heading inside each opened drill-down. */
  drillDownHeading: string;
  /** Empty-state copy when a contestant received 0 points from the room. */
  drillDownEmpty: string;
  /**
   * ARIA label for the `<summary>`. Receives `{country}` so screen readers
   * announce "Show points breakdown for Sweden" rather than a generic toggle.
   */
  toggleAria: (country: string) => string;
  /**
   * Render the per-give points label, e.g. "12 pts" / "1 pt". Receives the
   * raw point count so callers can plug in their pluralisation strategy.
   */
  formatGivePoints: (points: number) => string;
}

interface LeaderboardWithDrillDownProps {
  leaderboard: LeaderboardEntry[];
  contestants: Contestant[];
  /**
   * Phase U country drill-down — per-contestant inversion of `breakdowns`.
   * Contestants with no `contestantBreakdowns` entry render the empty-state
   * copy (rank 11+ in a sparse field).
   */
  contestantBreakdowns: ContestantBreakdown[];
  labels: LeaderboardWithDrillDownLabels;
}

/**
 * /results/[id] leaderboard with tap-to-expand country drill-down (Phase U).
 *
 * Each row is a native `<details>` element so the disclosure works without
 * client-side JS and remains keyboard- and screen-reader accessible. Inside
 * an opened row we list every voter who awarded points to that contestant,
 * sorted desc by points then alphabetically — same ordering the loader
 * already applies in `buildContestantBreakdowns`.
 */
export default function LeaderboardWithDrillDown({
  leaderboard,
  contestants,
  contestantBreakdowns,
  labels,
}: LeaderboardWithDrillDownProps) {
  const contestantLookup = new Map<string, Contestant>(
    contestants.map((c) => [c.id, c]),
  );
  const breakdownLookup = new Map<string, ContestantBreakdown>(
    contestantBreakdowns.map((b) => [b.contestantId, b]),
  );

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{labels.title}</h2>
      <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
        {leaderboard.map((e) => {
          const contestant = contestantLookup.get(e.contestantId);
          const country = contestant?.country ?? e.contestantId;
          const drill = breakdownLookup.get(e.contestantId);
          return (
            <li key={e.contestantId}>
              <details className="group">
                <summary
                  aria-label={labels.toggleAria(country)}
                  className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none select-none transition-colors hover:bg-muted/50"
                >
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums text-sm text-muted-foreground w-6 text-right">
                      {e.rank}
                    </span>
                    <span className="text-2xl" aria-hidden>
                      {contestant?.flagEmoji ?? "🏳️"}
                    </span>
                    <span className="font-medium">{country}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums font-semibold">
                      {e.totalPoints}
                    </span>
                    <span
                      aria-hidden
                      className="text-xs text-muted-foreground transition-transform group-open:rotate-90"
                    >
                      ▸
                    </span>
                  </span>
                </summary>
                <div className="border-t border-border bg-muted/20 px-4 py-3">
                  <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                    {labels.drillDownHeading}
                  </h3>
                  {drill && drill.gives.length > 0 ? (
                    <ul className="space-y-1.5">
                      {drill.gives.map((g) => (
                        <li
                          key={g.userId}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="font-medium">{g.displayName}</span>
                          <span className="tabular-nums font-semibold">
                            {labels.formatGivePoints(g.pointsAwarded)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {labels.drillDownEmpty}
                    </p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
