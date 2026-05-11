import type { Vote, VotingCategory } from "@/types";
import {
  pearsonCorrelation,
  spearmanCorrelation,
  type UserResult,
} from "@/lib/scoring";
import {
  PERSONALITY_AWARD_NAMES,
  categoryAwardKey,
  categoryAwardName,
  findOutfitLikeCategory,
} from "@/lib/awards/awardKeys";
import { buildUserVectors } from "./userVectors";

const EPS = 1e-9;

export interface ComputeAwardsInput {
  categories: VotingCategory[];
  contestants: Array<{ id: string; country: string }>;
  users: Array<{ userId: string; displayName: string }>;
  /** Post-fill votes (output of scoreRoom). Missed votes carry filled scores but `missed === true`. */
  votes: Vote[];
  /** UserResult rows from scoreRoom — one per (user, contestant) with rank + pointsAwarded. */
  results: UserResult[];
}

export interface ComputedAward {
  awardKey: string;
  awardName: string;
  winnerUserId: string | null;
  winnerUserIdB: string | null;
  winnerContestantId: string | null;
  statValue: number | null;
  statLabel: string | null;
}

interface UserView {
  userId: string;
  displayName: string;
}

function nonMissed(votes: Vote[]): Vote[] {
  return votes.filter((v) => !v.missed && v.scores !== null);
}

/** Mean of all category scores across all non-missed votes for a user. */
function userOverallMean(userId: string, votes: Vote[]): number | null {
  const own = votes.filter((v) => v.userId === userId);
  const nm = nonMissed(own);
  if (nm.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const v of nm) {
    const scores = v.scores ?? {};
    for (const value of Object.values(scores)) {
      sum += value;
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

/** Mean of one user's category scores for one contestant (non-missed only). */
function userContestantMean(
  userId: string,
  contestantId: string,
  votes: Vote[],
): number | null {
  const v = votes.find(
    (x) => x.userId === userId && x.contestantId === contestantId && !x.missed,
  );
  if (!v || !v.scores) return null;
  const values = Object.values(v.scores);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Per-category × per-contestant mean across non-missed voters. */
function categoryContestantMean(
  categoryName: string,
  contestantId: string,
  votes: Vote[],
): { mean: number | null; aboveEightCount: number } {
  let sum = 0;
  let n = 0;
  let aboveEight = 0;
  for (const v of votes) {
    if (v.contestantId !== contestantId) continue;
    if (v.missed || !v.scores) continue;
    const score = v.scores[categoryName];
    if (typeof score !== "number") continue;
    sum += score;
    n += 1;
    if (score > 8) aboveEight += 1;
  }
  return { mean: n === 0 ? null : sum / n, aboveEightCount: aboveEight };
}

interface PersonalityCandidate {
  userId: string;
  displayName: string;
  metric: number;
}

/**
 * Pick personality-award winners with §11.2 tiebreak rules:
 *  - direction: 'min' for "lowest metric wins" (harshest, hive_mind),
 *               'max' for "highest metric wins" (biggest stan, contrarian)
 *  - 1 winner: solo
 *  - 2 candidates tied at top metric: joint (alphabetical → A,B)
 *  - 3+ tied: top two alphabetical (MVP limitation)
 */
function pickPersonality(
  candidates: PersonalityCandidate[],
  direction: "min" | "max",
): { primary: PersonalityCandidate; partner: PersonalityCandidate | null } | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const cmp =
      direction === "min" ? a.metric - b.metric : b.metric - a.metric;
    if (Math.abs(cmp) > EPS) return cmp;
    return a.displayName.localeCompare(b.displayName);
  });
  const top = sorted[0];
  const tiedAtTop = sorted.filter((c) => Math.abs(c.metric - top.metric) < EPS);
  if (tiedAtTop.length === 1) return { primary: top, partner: null };
  // 2 or more tied — pick the alphabetical top two as joint winners.
  return { primary: tiedAtTop[0], partner: tiedAtTop[1] };
}

/** Group consensus ranking by total contestant mean across all users. */
function consensusRanking(
  contestants: Array<{ id: string; country: string }>,
  users: UserView[],
  votes: Vote[],
): Array<{ contestantId: string; total: number; rank: number }> {
  const totals = contestants.map((c) => {
    let sum = 0;
    for (const u of users) {
      const m = userContestantMean(u.userId, c.id, votes);
      if (m !== null) sum += m;
    }
    return { contestantId: c.id, country: c.country, total: sum };
  });
  // Sort: total desc, country asc as deterministic tiebreak.
  totals.sort((a, b) => {
    if (Math.abs(a.total - b.total) > EPS) return b.total - a.total;
    return a.country.localeCompare(b.country);
  });
  return totals.map((t, i) => ({
    contestantId: t.contestantId,
    total: t.total,
    rank: i + 1,
  }));
}

/** Each user's contestant ranking in `contestants` order (by results.rank). */
function userRankingsByContestant(
  contestants: Array<{ id: string }>,
  results: UserResult[],
): Map<string, number[]> {
  const byUser = new Map<string, Map<string, number>>();
  for (const r of results) {
    const m = byUser.get(r.userId) ?? new Map<string, number>();
    m.set(r.contestantId, r.rank);
    byUser.set(r.userId, m);
  }
  const out = new Map<string, number[]>();
  for (const [userId, perContestant] of byUser.entries()) {
    out.set(
      userId,
      contestants.map((c) => perContestant.get(c.id) ?? contestants.length + 1),
    );
  }
  return out;
}

function buildCategoryAwards(input: ComputeAwardsInput): ComputedAward[] {
  const out: ComputedAward[] = [];
  const ordered = [...input.contestants].sort((a, b) =>
    a.country.localeCompare(b.country),
  );
  for (const cat of input.categories) {
    const stats = ordered.map((c) => ({
      ...c,
      ...categoryContestantMean(cat.name, c.id, input.votes),
    }));
    const eligible = stats.filter((s) => s.mean !== null);
    if (eligible.length === 0) continue;
    eligible.sort((a, b) => {
      const dm = (b.mean as number) - (a.mean as number);
      if (Math.abs(dm) > EPS) return dm;
      // Tiebreak 1: most voters with > 8 in this category.
      if (a.aboveEightCount !== b.aboveEightCount) {
        return b.aboveEightCount - a.aboveEightCount;
      }
      return a.country.localeCompare(b.country);
    });
    const winner = eligible[0];
    out.push({
      awardKey: categoryAwardKey(cat),
      awardName: categoryAwardName(cat),
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: winner.id,
      statValue: Number(((winner.mean as number)).toFixed(3)),
      statLabel: `${winner.country} ${(winner.mean as number).toFixed(1)}/10`,
    });
  }
  return out;
}

function buildBiggestStan(input: ComputeAwardsInput): ComputedAward | null {
  return buildOverallMeanAward(input, "max", "biggest_stan");
}

function buildHarshestCritic(input: ComputeAwardsInput): ComputedAward | null {
  return buildOverallMeanAward(input, "min", "harshest_critic");
}

function buildOverallMeanAward(
  input: ComputeAwardsInput,
  dir: "max" | "min",
  key: "biggest_stan" | "harshest_critic",
): ComputedAward | null {
  const candidates: PersonalityCandidate[] = [];
  for (const u of input.users) {
    const m = userOverallMean(u.userId, input.votes);
    if (m !== null)
      candidates.push({ userId: u.userId, displayName: u.displayName, metric: m });
  }
  const pick = pickPersonality(candidates, dir);
  if (!pick) return null;
  return {
    awardKey: key,
    awardName: PERSONALITY_AWARD_NAMES[key],
    winnerUserId: pick.primary.userId,
    winnerUserIdB: pick.partner?.userId ?? null,
    winnerContestantId: null,
    statValue: Number(pick.primary.metric.toFixed(3)),
    statLabel: `avg ${pick.primary.metric.toFixed(1)}/10`,
  };
}

function buildHiveMindContrarian(
  input: ComputeAwardsInput,
): { hive: ComputedAward | null; contrarian: ComputedAward | null } {
  if (input.users.length < 2)
    return { hive: null, contrarian: null };

  const consensus = consensusRanking(input.contestants, input.users, input.votes);
  const consensusRankByContestant = new Map(
    consensus.map((c) => [c.contestantId, c.rank]),
  );
  const consensusRanks = input.contestants.map(
    (c) => consensusRankByContestant.get(c.id) ?? input.contestants.length + 1,
  );

  const userRankings = userRankingsByContestant(input.contestants, input.results);

  const candidates: PersonalityCandidate[] = [];
  for (const u of input.users) {
    const ranks = userRankings.get(u.userId);
    if (!ranks) continue;
    const corr = spearmanCorrelation(consensusRanks, ranks);
    const distance = 1 - corr;
    candidates.push({
      userId: u.userId,
      displayName: u.displayName,
      metric: distance,
    });
  }

  if (candidates.length === 0) return { hive: null, contrarian: null };

  const hivePick = pickPersonality(candidates, "min");
  const contrarianPick = pickPersonality(candidates, "max");

  const hive = hivePick && {
    awardKey: "hive_mind_master",
    awardName: PERSONALITY_AWARD_NAMES.hive_mind_master,
    winnerUserId: hivePick.primary.userId,
    winnerUserIdB: hivePick.partner?.userId ?? null,
    winnerContestantId: null,
    statValue: Number(hivePick.primary.metric.toFixed(3)),
    statLabel: `Spearman dist ${hivePick.primary.metric.toFixed(2)}`,
  };
  const contrarian = contrarianPick && {
    awardKey: "most_contrarian",
    awardName: PERSONALITY_AWARD_NAMES.most_contrarian,
    winnerUserId: contrarianPick.primary.userId,
    winnerUserIdB: contrarianPick.partner?.userId ?? null,
    winnerContestantId: null,
    statValue: Number(contrarianPick.primary.metric.toFixed(3)),
    statLabel: `Spearman dist ${contrarianPick.primary.metric.toFixed(2)}`,
  };
  return { hive, contrarian };
}

function buildNeighbourhoodVoters(
  input: ComputeAwardsInput,
): ComputedAward | null {
  if (input.users.length < 2) return null;
  const vectors = buildUserVectors(input);
  if (vectors.size < 2) return null;

  let bestPair: { a: UserView; b: UserView; corr: number } | null = null;
  const userIds = [...vectors.keys()];
  for (let i = 0; i < userIds.length; i++) {
    for (let j = i + 1; j < userIds.length; j++) {
      const va = vectors.get(userIds[i])!;
      const vb = vectors.get(userIds[j])!;
      const corr = pearsonCorrelation(va, vb);
      const a = input.users.find((u) => u.userId === userIds[i])!;
      const b = input.users.find((u) => u.userId === userIds[j])!;
      if (!bestPair || corr > bestPair.corr + EPS) {
        bestPair = { a, b, corr };
      } else if (Math.abs(corr - bestPair.corr) < EPS) {
        // Tie: deterministic alphabetical pair selection.
        const cur = [bestPair.a, bestPair.b]
          .map((u) => u.displayName)
          .sort()
          .join("|");
        const cand = [a, b].map((u) => u.displayName).sort().join("|");
        if (cand.localeCompare(cur) < 0) bestPair = { a, b, corr };
      }
    }
  }
  if (!bestPair) return null;

  // Store alphabetical: A then B.
  const [first, second] = [bestPair.a, bestPair.b].sort((u1, u2) =>
    u1.displayName.localeCompare(u2.displayName),
  );
  return {
    awardKey: "neighbourhood_voters",
    awardName: PERSONALITY_AWARD_NAMES.neighbourhood_voters,
    winnerUserId: first.userId,
    winnerUserIdB: second.userId,
    winnerContestantId: null,
    statValue: Number(bestPair.corr.toFixed(3)),
    statLabel: `Pearson ${bestPair.corr.toFixed(2)}`,
  };
}

function buildDarkHorse(input: ComputeAwardsInput): ComputedAward | null {
  if (input.contestants.length === 0 || input.users.length === 0) return null;
  type Stat = { id: string; country: string; variance: number };
  const stats: Stat[] = [];
  for (const c of input.contestants) {
    const userMeans: number[] = [];
    for (const u of input.users) {
      const m = userContestantMean(u.userId, c.id, input.votes);
      if (m !== null) userMeans.push(m);
    }
    if (userMeans.length === 0) continue;
    const mean = userMeans.reduce((a, b) => a + b, 0) / userMeans.length;
    const variance =
      userMeans.reduce((acc, x) => acc + (x - mean) ** 2, 0) / userMeans.length;
    stats.push({ id: c.id, country: c.country, variance });
  }
  if (stats.length === 0) return null;
  stats.sort((a, b) => {
    const dv = b.variance - a.variance;
    if (Math.abs(dv) > EPS) return dv;
    return a.country.localeCompare(b.country);
  });
  const winner = stats[0];
  return {
    awardKey: "the_dark_horse",
    awardName: PERSONALITY_AWARD_NAMES.the_dark_horse,
    winnerUserId: null,
    winnerUserIdB: null,
    winnerContestantId: winner.id,
    statValue: Number(winner.variance.toFixed(3)),
    statLabel: `${winner.country} (variance ${winner.variance.toFixed(1)})`,
  };
}

function buildFashionStan(input: ComputeAwardsInput): ComputedAward | null {
  const outfit = findOutfitLikeCategory(input.categories);
  if (!outfit) return null;
  const candidates: PersonalityCandidate[] = [];
  for (const u of input.users) {
    let max: number | null = null;
    for (const v of input.votes) {
      if (v.userId !== u.userId) continue;
      if (v.missed || !v.scores) continue;
      const s = v.scores[outfit.name];
      if (typeof s !== "number") continue;
      if (max === null || s > max) max = s;
    }
    if (max !== null) {
      candidates.push({
        userId: u.userId,
        displayName: u.displayName,
        metric: max,
      });
    }
  }
  const pick = pickPersonality(candidates, "max");
  if (!pick) return null;
  return {
    awardKey: "fashion_stan",
    awardName: PERSONALITY_AWARD_NAMES.fashion_stan,
    winnerUserId: pick.primary.userId,
    winnerUserIdB: pick.partner?.userId ?? null,
    winnerContestantId: null,
    statValue: pick.primary.metric,
    statLabel: `${outfit.name} ${pick.primary.metric}/10`,
  };
}

function buildEnabler(input: ComputeAwardsInput): ComputedAward | null {
  // Group winner = contestant with highest Σ pointsAwarded.
  const totals = new Map<string, number>();
  for (const r of input.results) {
    totals.set(
      r.contestantId,
      (totals.get(r.contestantId) ?? 0) + r.pointsAwarded,
    );
  }
  if (totals.size === 0) return null;
  // Sorted: total desc, then alphabetical contestant id asc (matches §9 leaderboard).
  const sorted = [...totals.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  const [winnerContestantId] = sorted[0];

  // Users who awarded 12 points to the group winner.
  const enablers: UserView[] = [];
  for (const r of input.results) {
    if (
      r.contestantId === winnerContestantId &&
      r.pointsAwarded === 12
    ) {
      const u = input.users.find((x) => x.userId === r.userId);
      if (u) enablers.push(u);
    }
  }
  if (enablers.length === 0) return null;
  enablers.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const winner = enablers[0];
  const partner = enablers.length >= 2 ? enablers[1] : null;
  return {
    awardKey: "the_enabler",
    awardName: PERSONALITY_AWARD_NAMES.the_enabler,
    winnerUserId: winner.userId,
    winnerUserIdB: partner?.userId ?? null,
    winnerContestantId: null,
    statValue: null,
    statLabel: null,
  };
}

/**
 * SPEC §11 awards calculator. Pure function — no I/O. Takes the same data
 * the scoring pipeline already produced (categories, contestants, users,
 * votes, results) and returns the catalogue of award rows ready to UPSERT
 * into `room_awards`.
 *
 * Award order matches §11.3 reveal sequence (categories first, then
 * personality awards in social-heat order). Bet-based awards (§11.2a)
 * are deferred to V2 along with R7 bets.
 */
export function computeAwards(input: ComputeAwardsInput): ComputedAward[] {
  const out: ComputedAward[] = [];
  out.push(...buildCategoryAwards(input));

  const stan = buildBiggestStan(input);
  if (stan) out.push(stan);
  const harshest = buildHarshestCritic(input);
  if (harshest) out.push(harshest);

  const { hive, contrarian } = buildHiveMindContrarian(input);
  if (contrarian) out.push(contrarian);
  if (hive) out.push(hive);

  const neighbours = buildNeighbourhoodVoters(input);
  if (neighbours) out.push(neighbours);

  const horse = buildDarkHorse(input);
  if (horse) out.push(horse);

  const fashion = buildFashionStan(input);
  if (fashion) out.push(fashion);

  const enabler = buildEnabler(input);
  if (enabler) out.push(enabler);

  return out;
}
