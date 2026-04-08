import { EUROVISION_POINTS } from "@/types";
import type { VotingCategory, Vote } from "@/types";

/**
 * Compute the weighted score for a single user×contestant vote.
 * weightedScore = Σ(categoryScore[C] × weight[C]) / Σ(weight[C])
 */
export function computeWeightedScore(
  scores: Record<string, number>,
  categories: VotingCategory[]
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const cat of categories) {
    const score = scores[cat.name];
    if (score !== undefined) {
      const weight = cat.weight || 1;
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

/**
 * Map a 1-indexed rank to Eurovision points.
 * Ranks 1–10 get points; rank 11+ get 0.
 */
export function rankToPoints(rank: number): number {
  return EUROVISION_POINTS[rank] ?? 0;
}

/**
 * Tie-breaking for a single user's ranking.
 * Returns negative if a should rank higher (better) than b.
 */
export function tiebreak(
  a: { scores: Record<string, number>; country: string },
  b: { scores: Record<string, number>; country: string }
): number {
  // 1. Highest single-category score
  const maxA = Math.max(...Object.values(a.scores));
  const maxB = Math.max(...Object.values(b.scores));
  if (maxA !== maxB) return maxB - maxA; // higher is better

  // 2. Count of categories scored above 7
  const above7A = Object.values(a.scores).filter((s) => s > 7).length;
  const above7B = Object.values(b.scores).filter((s) => s > 7).length;
  if (above7A !== above7B) return above7B - above7A;

  // 3. Alphabetical by country name
  return a.country.localeCompare(b.country);
}

/**
 * Fill missed entries with the user's average score per category.
 */
export function computeMissedFill(
  userVotes: Vote[],
  categories: VotingCategory[]
): Record<string, number> {
  const fill: Record<string, number> = {};

  for (const cat of categories) {
    const scores = userVotes
      .filter((v) => !v.missed && v.scores?.[cat.name] !== undefined)
      .map((v) => v.scores![cat.name]);

    fill[cat.name] = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 5;
  }

  return fill;
}

/**
 * Spearman rank correlation coefficient.
 * Returns value between -1 and 1.
 */
export function spearmanCorrelation(
  rankA: number[],
  rankB: number[]
): number {
  const n = rankA.length;
  if (n < 2) return 0;

  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rankA[i] - rankB[i];
    sumD2 += d * d;
  }

  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

/**
 * Pearson correlation coefficient.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}
