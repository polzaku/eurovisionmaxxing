import { computeWeightedScore, spearmanCorrelation } from "@/lib/scoring";
import type { ResultsData } from "@/lib/results/loadResults";
import type { Contestant } from "@/types";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ParticipantDrillDownRow {
  contestantId: string;
  country: string;
  flagEmoji: string;
  song: string;
  scores: Record<string, number>;
  missed: boolean;
  weightedScore: number;
  pointsAwarded: number;
  hotTake: string | null;
  hotTakeEditedAt: string | null;
}

export interface ParticipantDrillDownHeader {
  userId: string;
  displayName: string;
  avatarSeed: string;
  totalPointsAwarded: number;
  hotTakeCount: number;
}

export interface ParticipantDrillDownAggregates {
  /** Mean of this user's non-missed weighted scores. */
  mean: number | null;
  /** Signed delta vs room mean. Negative = harsher than room. */
  harshness: number | null;
  /**
   * Spearman correlation between (the leaderboard order) and
   * (this user's per-contestant weighted score order). 1 = perfect
   * alignment with the room; -1 = inverted; near 0 = uncorrelated.
   */
  alignment: number | null;
}

export interface ParticipantDrillDownResult {
  header: ParticipantDrillDownHeader;
  rows: ParticipantDrillDownRow[];
  aggregates: ParticipantDrillDownAggregates;
}

export interface ParticipantDrillDownInput {
  categories: DonePayload["categories"];
  members: DonePayload["members"];
  contestants: Contestant[];
  leaderboard: DonePayload["leaderboard"];
  voteDetails: DonePayload["voteDetails"];
}

/**
 * SPEC §12.6.2 — derive per-contestant rows + aggregates for a single user.
 *
 * Rows are this user's votes, sorted by their weighted score desc.
 * Aggregates compare against the rest of the room:
 *  - mean: their own non-missed average
 *  - harshness: (their mean) − (room mean across everyone's non-missed votes)
 *  - alignment: Spearman between the room leaderboard order and the user's
 *    per-contestant weighted score order, evaluated over contestants this
 *    user voted on.
 */
export function buildParticipantDrillDown(
  userId: string,
  {
    categories,
    members,
    contestants,
    leaderboard,
    voteDetails,
  }: ParticipantDrillDownInput,
): ParticipantDrillDownResult {
  const member = members.find((m) => m.userId === userId);
  const memberHeader = member ?? {
    userId,
    displayName: userId,
    avatarSeed: userId,
  };
  const contestantById = new Map(contestants.map((c) => [c.id, c]));

  const own = voteDetails.filter((v) => v.userId === userId);

  const rows: ParticipantDrillDownRow[] = own
    .map((v) => {
      const c = contestantById.get(v.contestantId);
      if (!c) return null;
      return {
        contestantId: v.contestantId,
        country: c.country,
        flagEmoji: c.flagEmoji,
        song: c.song,
        scores: v.scores,
        missed: v.missed,
        weightedScore: computeWeightedScore(v.scores, categories),
        pointsAwarded: v.pointsAwarded,
        hotTake: v.hotTake,
        hotTakeEditedAt: v.hotTakeEditedAt,
      };
    })
    .filter((r): r is ParticipantDrillDownRow => r !== null)
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const totalPointsAwarded = own.reduce((s, v) => s + v.pointsAwarded, 0);
  const hotTakeCount = own.filter(
    (v) => v.hotTake !== null && v.hotTake.trim() !== "",
  ).length;

  const scoring = rows.filter((r) => !r.missed);
  const mean =
    scoring.length === 0
      ? null
      : scoring.reduce((s, r) => s + r.weightedScore, 0) / scoring.length;

  const roomScores = voteDetails
    .filter((v) => !v.missed)
    .map((v) => computeWeightedScore(v.scores, categories));
  const roomMean =
    roomScores.length === 0
      ? null
      : roomScores.reduce((s, x) => s + x, 0) / roomScores.length;
  const harshness =
    mean === null || roomMean === null ? null : mean - roomMean;

  const leaderboardRankById = new Map(
    leaderboard.map((row, idx) => [row.contestantId, idx + 1]),
  );
  const ownRankedIds = [...scoring]
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .map((r) => r.contestantId);
  const ownRankById = new Map(
    ownRankedIds.map((id, idx) => [id, idx + 1] as const),
  );
  const paired = ownRankedIds.flatMap((id) => {
    const lbRank = leaderboardRankById.get(id);
    const ownRank = ownRankById.get(id);
    if (lbRank === undefined || ownRank === undefined) return [];
    return [{ lbRank, ownRank }];
  });
  const alignment =
    paired.length < 2
      ? null
      : spearmanCorrelation(
          paired.map((p) => p.lbRank),
          paired.map((p) => p.ownRank),
        );

  return {
    header: {
      userId: memberHeader.userId,
      displayName: memberHeader.displayName,
      avatarSeed: memberHeader.avatarSeed,
      totalPointsAwarded,
      hotTakeCount,
    },
    rows,
    aggregates: { mean, harshness, alignment },
  };
}
