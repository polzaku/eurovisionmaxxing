import type { ComputeAwardsInput } from "./computeAwards";
import { buildUserVectors } from "./userVectors";
import { pearsonCorrelation } from "@/lib/scoring";

const EPS = 1e-9;

export interface PersonalNeighbour {
  userId: string;
  neighbourUserId: string;
  /** Pearson correlation, rounded to 3 decimals. Range: [-1, 1]. */
  pearson: number;
  /** True iff the pair is mutually each other's top-1 nearest. */
  isReciprocal: boolean;
}

/**
 * For every signal-bearing user in the room, compute their nearest neighbour
 * (highest pairwise Pearson correlation across per-contestant mean vectors).
 * Returns one row per viewer; the corresponding card is spliced into the
 * cinematic awards sequence after `neighbourhood_voters`. Members without
 * a row (zero-signal voters, or rooms with <3 signal-bearing users) skip
 * the slot in their reveal.
 *
 * Pure function — same inputs always produce the same output. Ties are
 * broken alphabetically by neighbour displayName so the choice is stable
 * across reloads.
 *
 * Skip rule: when fewer than 3 users have signal vectors, the room-wide
 * `neighbourhood_voters` award already covers the only meaningful pair
 * and the personalized version would just duplicate it.
 */
export function buildPersonalNeighbours(
  input: ComputeAwardsInput,
): PersonalNeighbour[] {
  const vectors = buildUserVectors(input);
  if (vectors.size < 3) return [];

  const userIds = [...vectors.keys()];
  const nameById = new Map(input.users.map((u) => [u.userId, u.displayName]));

  type Pick = {
    userId: string;
    neighbourUserId: string;
    pearson: number;
  };

  const picks: Pick[] = [];

  for (const a of userIds) {
    const va = vectors.get(a)!;
    let bestNeighbour: string | null = null;
    let bestCorr = -Infinity;
    let bestName = "";

    for (const b of userIds) {
      if (b === a) continue;
      const vb = vectors.get(b)!;
      const corr = pearsonCorrelation(va, vb);
      const name = nameById.get(b) ?? "";
      if (corr > bestCorr + EPS) {
        bestNeighbour = b;
        bestCorr = corr;
        bestName = name;
      } else if (Math.abs(corr - bestCorr) < EPS) {
        // Tie — alphabetical neighbour displayName wins.
        if (name.localeCompare(bestName) < 0) {
          bestNeighbour = b;
          bestName = name;
        }
      }
    }

    if (bestNeighbour !== null) {
      picks.push({
        userId: a,
        neighbourUserId: bestNeighbour,
        pearson: Number(bestCorr.toFixed(3)),
      });
    }
  }

  // Reciprocity pass: a pair (a→b, b→a) is mutual.
  const neighbourOf = new Map(
    picks.map((p) => [p.userId, p.neighbourUserId]),
  );
  return picks.map((p) => ({
    ...p,
    isReciprocal: neighbourOf.get(p.neighbourUserId) === p.userId,
  }));
}
