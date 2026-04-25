export type ContestantStatus = "unscored" | "scored" | "missed";

/**
 * Compute a single user's per-contestant status for the jump-to drawer.
 * Pure function — operates on the local maps already in VotingView state.
 *
 * "missed" wins over "scored" because the spec treats missed-flag as the
 * authoritative state regardless of any stale scores still in the map
 * (matches scoring engine semantics in computeMissedFill).
 */
export function summarizeContestantStatus(
  contestantId: string,
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categoryNames: readonly string[]
): ContestantStatus {
  if (missedByContestant[contestantId]) return "missed";
  if (categoryNames.length === 0) return "unscored";
  const scores = scoresByContestant[contestantId] ?? {};
  const allScored = categoryNames.every(
    (name) => typeof scores[name] === "number"
  );
  return allScored ? "scored" : "unscored";
}
