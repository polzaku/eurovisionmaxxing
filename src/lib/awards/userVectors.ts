import type { ComputeAwardsInput } from "./computeAwards";

/**
 * Build a per-user vector indexed by contestant. Each entry is the mean of
 * that user's category scores for the contestant; missing or missed votes
 * substitute 0. Users whose entire vector is all zeros are dropped — they
 * carry no signal for correlation-based awards.
 *
 * Shared by `buildNeighbourhoodVoters` (room-wide Pearson) and
 * `buildPersonalNeighbours` (per-viewer Pearson).
 */
export function buildUserVectors(
  input: ComputeAwardsInput,
): Map<string, number[]> {
  const vectors = new Map<string, number[]>();
  for (const u of input.users) {
    const vec = input.contestants.map((c) =>
      userContestantMeanLocal(u.userId, c.id, input.votes) ?? 0,
    );
    if (vec.some((x) => x !== 0)) vectors.set(u.userId, vec);
  }
  return vectors;
}

function userContestantMeanLocal(
  userId: string,
  contestantId: string,
  votes: ComputeAwardsInput["votes"],
): number | null {
  const v = votes.find(
    (x) => x.userId === userId && x.contestantId === contestantId && !x.missed,
  );
  if (!v || !v.scores) return null;
  const values = Object.values(v.scores);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
