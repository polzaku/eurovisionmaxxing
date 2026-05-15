import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";
import type { Contestant } from "@/types";

export interface AnnouncerPick {
  contestantId: string;
  country: string;
  flagEmoji: string;
  /** The number of points the current announcer has contributed (live − committed). */
  points: number;
}

/**
 * TODO #8 + #11 — derive the current announcer's per-pick contribution
 * from the difference between the live leaderboard and the snapshot
 * taken when this announcer started their batch. Returns one entry per
 * contestant whose live total exceeds the committed total; the
 * differences are the points the announcer has revealed so far.
 *
 * Sorted ascending by `points` so the panel reads in the same order
 * the announcer reveals (1, 2, 3, …, 10, 12).
 *
 * Returns [] when either input is undefined, or when no picks have
 * been revealed since the snapshot (degenerate live === committed).
 */
export function derivePicks(
  committed: LeaderboardEntry[] | undefined,
  live: LeaderboardEntry[] | undefined,
  contestantById: Map<string, Contestant>,
): AnnouncerPick[] {
  if (!committed || !live) return [];
  const committedById = new Map(
    committed.map((e) => [e.contestantId, e.totalPoints]),
  );
  const picks: AnnouncerPick[] = [];
  for (const entry of live) {
    const prev = committedById.get(entry.contestantId) ?? 0;
    const delta = entry.totalPoints - prev;
    if (delta <= 0) continue;
    const c = contestantById.get(entry.contestantId);
    picks.push({
      contestantId: entry.contestantId,
      country: c?.country ?? entry.contestantId,
      flagEmoji: c?.flagEmoji ?? "🏳️",
      points: delta,
    });
  }
  picks.sort((a, b) => a.points - b.points);
  return picks;
}
