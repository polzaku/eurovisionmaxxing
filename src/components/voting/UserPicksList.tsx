import type { Contestant } from "@/types";

interface Pick {
  contestantId: string;
  pointsAwarded: number;
}

interface UserPicksListProps {
  picks: Pick[];
  contestants: Contestant[];
}

/**
 * TODO #10 (slice A) — renders a list of "your picks" rows for the
 * peek sheet: each row shows the points awarded, the country flag,
 * the country name, and the song title. Sorted by points descending
 * (12 at top). Pure presentational; the parent owns data fetching
 * and the sheet/dialog chrome around it.
 *
 * Reused later by the calibration view (slice B) — same shape, same
 * "your picks" semantic.
 */
export default function UserPicksList({
  picks,
  contestants,
}: UserPicksListProps) {
  const contestantById = new Map(contestants.map((c) => [c.id, c]));
  const sorted = [...picks].sort((a, b) => b.pointsAwarded - a.pointsAwarded);

  if (sorted.length === 0) {
    return (
      <p
        data-testid="user-picks-list-empty"
        className="text-sm italic text-muted-foreground"
      >
        No picks yet.
      </p>
    );
  }

  return (
    <ol data-testid="user-picks-list" className="space-y-2">
      {sorted.map((pick) => {
        const c = contestantById.get(pick.contestantId);
        return (
          <li
            key={pick.contestantId}
            data-testid={`user-pick-${pick.contestantId}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
          >
            <span className="w-10 flex-shrink-0 text-right font-mono text-lg font-bold tabular-nums text-primary">
              {pick.pointsAwarded}
            </span>
            <span className="text-2xl" aria-hidden>
              {c?.flagEmoji ?? "🏳️"}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block truncate font-medium">
                {c?.country ?? pick.contestantId}
              </span>
              {c?.song ? (
                <span className="block truncate text-xs text-muted-foreground">
                  &ldquo;{c.song}&rdquo;
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
