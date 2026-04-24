import type { VoteView } from "@/lib/rooms/get";

/**
 * Transform the server's VoteView[] into VotingView's sparse
 * Record<contestantId, Record<categoryName, number | null>> shape.
 *
 * Filters out stale contestant ids and category names defensively.
 * Skips rows with `scores: null` (missed-only rows have no scores to seed).
 *
 * See docs/superpowers/specs/2026-04-24-vote-rehydration-design.md §5.2.
 */
export function seedScoresFromVotes(
  votes: readonly VoteView[],
  categoryNames: readonly string[],
  contestantIds: readonly string[]
): Record<string, Record<string, number | null>> {
  const validCats = new Set(categoryNames);
  const validContestants = new Set(contestantIds);
  const out: Record<string, Record<string, number | null>> = {};
  for (const v of votes) {
    if (!validContestants.has(v.contestantId)) continue;
    if (!v.scores) continue;
    const filtered: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(v.scores)) {
      if (validCats.has(key)) {
        filtered[key] = value;
      }
    }
    if (Object.keys(filtered).length > 0) {
      out[v.contestantId] = filtered;
    }
  }
  return out;
}
