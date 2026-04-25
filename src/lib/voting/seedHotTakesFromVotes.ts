import type { VoteView } from "@/lib/rooms/get";

/**
 * Build the hot-takes-by-contestant map from the server's VoteView[].
 * Only contestants with a non-empty hot_take are included; absence
 * is treated as "" by callers. Defensively filters out unknown ids.
 */
export function seedHotTakesFromVotes(
  votes: readonly VoteView[],
  contestantIds: readonly string[]
): Record<string, string> {
  const validContestants = new Set(contestantIds);
  const out: Record<string, string> = {};
  for (const v of votes) {
    if (!validContestants.has(v.contestantId)) continue;
    if (v.hotTake !== null && v.hotTake !== "") {
      out[v.contestantId] = v.hotTake;
    }
  }
  return out;
}
