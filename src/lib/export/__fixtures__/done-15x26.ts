import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const YEAR = 2026;
const EVENT = "final" as const;
const PIN = "TESTPN";

const COUNTRIES: Array<[string, string, string]> = [
  ["al", "Albania", "🇦🇱"], ["am", "Armenia", "🇦🇲"], ["au", "Australia", "🇦🇺"],
  ["at", "Austria", "🇦🇹"], ["be", "Belgium", "🇧🇪"], ["ch", "Switzerland", "🇨🇭"],
  ["cy", "Cyprus", "🇨🇾"], ["de", "Germany", "🇩🇪"], ["dk", "Denmark", "🇩🇰"],
  ["ee", "Estonia", "🇪🇪"], ["es", "Spain", "🇪🇸"], ["fi", "Finland", "🇫🇮"],
  ["fr", "France", "🇫🇷"], ["gb", "United Kingdom", "🇬🇧"], ["gr", "Greece", "🇬🇷"],
  ["hr", "Croatia", "🇭🇷"], ["ie", "Ireland", "🇮🇪"], ["il", "Israel", "🇮🇱"],
  ["is", "Iceland", "🇮🇸"], ["it", "Italy", "🇮🇹"], ["lv", "Latvia", "🇱🇻"],
  ["nl", "Netherlands", "🇳🇱"], ["no", "Norway", "🇳🇴"], ["pl", "Poland", "🇵🇱"],
  ["pt", "Portugal", "🇵🇹"], ["se", "Sweden", "🇸🇪"],
];

const MEMBERS = Array.from({ length: 15 }, (_, i) => ({
  userId: `user-${String(i + 1).padStart(2, "0")}`,
  displayName: `Voter ${String.fromCharCode(65 + i)}`,
  avatarSeed: `seed-${i + 1}`,
}));

const POINTS_LADDER = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1] as const;

const contestants = COUNTRIES.map(([code, country, flag], idx) => ({
  id: `${YEAR}-${code}`,
  country,
  countryCode: code,
  flagEmoji: flag,
  artist: `Artist ${idx + 1}`,
  song: `Song ${idx + 1}`,
  runningOrder: idx + 1,
  event: EVENT,
  year: YEAR,
}));

// Deterministic per-(user, contestant) score in 1-10 so renders stay stable
// across runs. Seed: (userIdx * 7 + contestantIdx * 3) % 10 + 1.
function scoreFor(userIdx: number, contestantIdx: number): number {
  return ((userIdx * 7 + contestantIdx * 3) % 10) + 1;
}

const CATEGORIES = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Music", weight: 1, key: "music" },
  { name: "Outfit", weight: 1, key: "outfit" },
  { name: "Stage", weight: 1, key: "stage" },
  { name: "Vibes", weight: 1, key: "vibes" },
];

// Each user awards points to 10 contestants (their top 10 by mean score).
// Leaderboard is the sum across users.
const voteDetails: DonePayload["voteDetails"] = [];
const resultRowsByUser: Record<string, Array<{ contestantId: string; pointsAwarded: number }>> = {};
MEMBERS.forEach((m, userIdx) => {
  const ranked = contestants
    .map((c, contestantIdx) => ({
      contestantId: c.id,
      score: scoreFor(userIdx, contestantIdx),
    }))
    .sort((a, b) => b.score - a.score);
  resultRowsByUser[m.userId] = ranked.map((r, rankIdx) => ({
    contestantId: r.contestantId,
    pointsAwarded: rankIdx < 10 ? POINTS_LADDER[rankIdx] : 0,
  }));
  contestants.forEach((c, contestantIdx) => {
    const baseScore = scoreFor(userIdx, contestantIdx);
    voteDetails.push({
      userId: m.userId,
      contestantId: c.id,
      scores: {
        vocals: baseScore,
        music: ((baseScore + 1) % 10) + 1,
        outfit: ((baseScore + 2) % 10) + 1,
        stage: ((baseScore + 3) % 10) + 1,
        vibes: ((baseScore + 4) % 10) + 1,
      },
      missed: false,
      pointsAwarded: resultRowsByUser[m.userId].find((r) => r.contestantId === c.id)?.pointsAwarded ?? 0,
      hotTake: contestantIdx < 3 && userIdx < 5 ? `Hot take from ${m.displayName} on ${c.country}` : null,
      hotTakeEditedAt: null,
    });
  });
});

const leaderboard = contestants
  .map((c) => {
    const totalPoints = MEMBERS.reduce(
      (sum, m) =>
        sum +
        (resultRowsByUser[m.userId].find((r) => r.contestantId === c.id)
          ?.pointsAwarded ?? 0),
      0,
    );
    return { contestantId: c.id, totalPoints, rank: 0 };
  })
  .sort((a, b) => {
    if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
    return a.contestantId.localeCompare(b.contestantId);
  })
  .map((row, idx, all) => {
    const rank =
      idx > 0 && all[idx - 1].totalPoints === row.totalPoints
        ? all[idx - 1].rank
        : idx + 1;
    return { ...row, rank };
  });

const breakdowns = MEMBERS.map((m) => ({
  userId: m.userId,
  displayName: m.displayName,
  avatarSeed: m.avatarSeed,
  picks: resultRowsByUser[m.userId]
    .filter((r) => r.pointsAwarded > 0)
    .sort((a, b) => b.pointsAwarded - a.pointsAwarded),
}));

const contestantBreakdowns = contestants
  .map((c) => ({
    contestantId: c.id,
    gives: MEMBERS.map((m) => {
      const row = resultRowsByUser[m.userId].find((r) => r.contestantId === c.id);
      return {
        userId: m.userId,
        displayName: m.displayName,
        avatarSeed: m.avatarSeed,
        pointsAwarded: row?.pointsAwarded ?? 0,
      };
    }).filter((g) => g.pointsAwarded > 0).sort((a, b) => b.pointsAwarded - a.pointsAwarded),
  }))
  .filter((cb) => cb.gives.length > 0);

const hotTakes = voteDetails
  .filter((v) => v.hotTake !== null)
  .map((v) => {
    const m = MEMBERS.find((mm) => mm.userId === v.userId)!;
    return {
      userId: v.userId,
      displayName: m.displayName,
      avatarSeed: m.avatarSeed,
      contestantId: v.contestantId,
      hotTake: v.hotTake!,
      hotTakeEditedAt: v.hotTakeEditedAt,
    };
  });

export const FIXTURE_DONE_15x26: DonePayload = {
  status: "done",
  year: YEAR,
  event: EVENT,
  pin: PIN,
  ownerUserId: MEMBERS[0].userId,
  categories: CATEGORIES,
  leaderboard,
  contestants,
  breakdowns,
  contestantBreakdowns,
  hotTakes,
  awards: [
    {
      roomId: "room-1",
      awardKey: "best_vocals",
      awardName: "Best Vocals",
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: leaderboard[0].contestantId,
      statValue: 8.5,
      statLabel: "Mean vocals score",
    },
    {
      roomId: "room-1",
      awardKey: "harshest_critic",
      awardName: "Harshest Critic",
      winnerUserId: MEMBERS[2].userId,
      winnerUserIdB: null,
      winnerContestantId: null,
      statValue: 4.2,
      statLabel: "Lowest mean given",
    },
    {
      roomId: "room-1",
      awardKey: "neighbourhood_voters",
      awardName: "Neighbourhood Voters",
      winnerUserId: MEMBERS[0].userId,
      winnerUserIdB: MEMBERS[1].userId,
      winnerContestantId: null,
      statValue: 0.91,
      statLabel: "Spearman correlation",
    },
  ],
  personalNeighbours: [],
  members: MEMBERS,
  voteDetails,
};
