import type { VoteView } from "@/lib/rooms/get";

/**
 * Build the missed-by-contestant map from the server's VoteView[].
 * Only contestants flagged missed are included; non-missed and unknown
 * contestants are omitted (callers treat absence as `false`).
 */
export function seedMissedFromVotes(
  votes: readonly VoteView[],
  contestantIds: readonly string[]
): Record<string, boolean> {
  const validContestants = new Set(contestantIds);
  const out: Record<string, boolean> = {};
  for (const v of votes) {
    if (!validContestants.has(v.contestantId)) continue;
    if (v.missed) out[v.contestantId] = true;
  }
  return out;
}
