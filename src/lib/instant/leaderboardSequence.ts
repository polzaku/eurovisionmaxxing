import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

export interface LeaderboardSnapshot {
  contestantId: string;
  pointsAwarded: number;
  rank: number | null;
}

/**
 * Sort revealed-and-unrevealed rows by points desc, then contestantId asc.
 * Mirrors loadResults.buildLeaderboard's secondary sort.
 */
function sortSnapshot(rows: LeaderboardSnapshot[]): LeaderboardSnapshot[] {
  return [...rows].sort((a, b) => {
    if (a.pointsAwarded !== b.pointsAwarded) {
      return b.pointsAwarded - a.pointsAwarded;
    }
    return a.contestantId.localeCompare(b.contestantId);
  });
}

/**
 * Build the ceremony's snapshot timeline.
 *
 * Step 0: every contestant at 0 pts, null rank, sorted alphabetically.
 * Step k (k ∈ 1..N): the k worst leaderboard entries are "revealed" (their
 * pointsAwarded + rank applied); the rest stay at 0 pts / null rank.
 * Step N: matches the input leaderboard.
 *
 * Walk order is the input leaderboard reversed — i.e. worst rank first.
 * Ties are broken by contestantId asc (same as loadResults).
 */
export function leaderboardSequence(
  finalLeaderboard: LeaderboardEntry[],
  contestants: Contestant[],
): LeaderboardSnapshot[][] {
  // Map every contestant to a starting (0 pts, null rank) snapshot.
  const baseRows: LeaderboardSnapshot[] = contestants.map((c) => ({
    contestantId: c.id,
    pointsAwarded: 0,
    rank: null,
  }));

  // The reveal walk: leaderboard reversed — worst rank first.
  // Within tied final ranks, walk worst-to-best by contestantId desc so
  // that "earlier in the walk = worse" stays consistent.
  const walk = [...finalLeaderboard].sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank; // higher rank number = worse
    return b.contestantId.localeCompare(a.contestantId); // tie: desc by id
  });

  const snapshots: LeaderboardSnapshot[][] = [];

  // Step 0: initial.
  snapshots.push(sortSnapshot(baseRows));

  // Apply each reveal sequentially.
  const revealed = new Map<string, LeaderboardSnapshot>();
  for (const entry of walk) {
    revealed.set(entry.contestantId, {
      contestantId: entry.contestantId,
      pointsAwarded: entry.totalPoints,
      rank: entry.rank,
    });
    const next: LeaderboardSnapshot[] = baseRows.map((r) =>
      revealed.get(r.contestantId) ?? r,
    );
    snapshots.push(sortSnapshot(next));
  }

  return snapshots;
}
