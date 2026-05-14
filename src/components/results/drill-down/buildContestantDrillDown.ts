import { computeWeightedScore } from "@/lib/scoring";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ContestantDrillDownRow {
  userId: string;
  displayName: string;
  avatarSeed: string;
  scores: Record<string, number>;
  missed: boolean;
  weightedScore: number;
  pointsAwarded: number;
  hotTake: string | null;
  hotTakeEditedAt: string | null;
}

export interface ContestantDrillDownAggregateActor {
  userId: string;
  displayName: string;
  avatarSeed: string;
  weightedScore: number;
}

export interface ContestantDrillDownAggregates {
  mean: number | null;
  median: number | null;
  highest: ContestantDrillDownAggregateActor | null;
  lowest: ContestantDrillDownAggregateActor | null;
}

export interface ContestantDrillDownResult {
  rows: ContestantDrillDownRow[];
  aggregates: ContestantDrillDownAggregates;
}

export interface ContestantDrillDownInput {
  categories: DonePayload["categories"];
  members: DonePayload["members"];
  voteDetails: DonePayload["voteDetails"];
}

/**
 * SPEC §12.6.1 — derive per-voter rows + aggregates for a single contestant.
 *
 * Rows sorted by pointsAwarded desc (12-point givers first). Missed votes
 * are surfaced as rows with missed=true at the bottom of the list and are
 * EXCLUDED from aggregates — the question "what did the room rate this
 * contestant" is answered only by those who actually voted.
 */
export function buildContestantDrillDown(
  contestantId: string,
  { categories, members, voteDetails }: ContestantDrillDownInput,
): ContestantDrillDownResult {
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const relevant = voteDetails.filter((v) => v.contestantId === contestantId);

  const rows: ContestantDrillDownRow[] = relevant
    .map((v) => {
      const member = memberById.get(v.userId);
      if (!member) return null;
      return {
        userId: v.userId,
        displayName: member.displayName,
        avatarSeed: member.avatarSeed,
        scores: v.scores,
        missed: v.missed,
        weightedScore: computeWeightedScore(v.scores, categories),
        pointsAwarded: v.pointsAwarded,
        hotTake: v.hotTake,
        hotTakeEditedAt: v.hotTakeEditedAt,
      };
    })
    .filter((r): r is ContestantDrillDownRow => r !== null)
    .sort((a, b) => b.pointsAwarded - a.pointsAwarded);

  const scoring = rows.filter((r) => !r.missed);
  const aggregates: ContestantDrillDownAggregates =
    scoring.length === 0
      ? { mean: null, median: null, highest: null, lowest: null }
      : {
          mean:
            scoring.reduce((acc, r) => acc + r.weightedScore, 0) /
            scoring.length,
          median: medianOf(scoring.map((r) => r.weightedScore)),
          highest: pickByWeighted(scoring, (a, b) => b - a),
          lowest: pickByWeighted(scoring, (a, b) => a - b),
        };

  return { rows, aggregates };
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pickByWeighted(
  rows: ContestantDrillDownRow[],
  cmp: (a: number, b: number) => number,
): ContestantDrillDownAggregateActor {
  const top = [...rows].sort((a, b) =>
    cmp(a.weightedScore, b.weightedScore),
  )[0];
  return {
    userId: top.userId,
    displayName: top.displayName,
    avatarSeed: top.avatarSeed,
    weightedScore: top.weightedScore,
  };
}
