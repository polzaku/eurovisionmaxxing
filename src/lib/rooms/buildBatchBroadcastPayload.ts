import type { AnnouncerResultRow } from "./advanceAnnouncement";

/**
 * Build the per-contestant payload for a score_batch_revealed broadcast.
 * Computes each row's newTotal + competition rank from the post-batch
 * leaderboard snapshot (only announced=true rows count toward totals).
 *
 * Shared by runScoring (first-turn batch) and advanceAnnouncement
 * (rotation batch + batch-reveal-mode current-user batch).
 */
export function buildBatchBroadcastPayload(
  batchRows: AnnouncerResultRow[],
  allResults: Array<{
    contestant_id: string;
    points_awarded: number;
    announced: boolean;
  }>,
): Array<{
  contestantId: string;
  points: number;
  newTotal: number;
  newRank: number;
}> {
  const totals = new Map<string, number>();
  for (const r of allResults) {
    if (!r.announced) continue;
    totals.set(
      r.contestant_id,
      (totals.get(r.contestant_id) ?? 0) + r.points_awarded,
    );
  }
  const distinctSorted = [...new Set(totals.values())].sort((a, b) => b - a);
  return batchRows.map((r) => {
    const total = totals.get(r.contestant_id) ?? r.points_awarded;
    let rank = 1;
    for (const v of distinctSorted) {
      if (v > total) rank += 1;
      else break;
    }
    return {
      contestantId: r.contestant_id,
      points: r.points_awarded,
      newTotal: total,
      newRank: rank,
    };
  });
}
