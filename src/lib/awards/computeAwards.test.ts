import { describe, it, expect } from "vitest";
import type { Vote, VotingCategory } from "@/types";
import type { UserResult } from "@/lib/scoring";
import { computeAwards } from "@/lib/awards/computeAwards";

const U1 = "11111111-2222-4333-8444-000000000001";
const U2 = "22222222-3333-4444-8555-000000000002";
const U3 = "33333333-4444-4555-8666-000000000003";

const CATS: VotingCategory[] = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Outfit", weight: 1, key: "outfit" },
];

const CONTESTANTS = [
  { id: "2026-al", country: "Albania" },
  { id: "2026-be", country: "Belgium" },
  { id: "2026-cr", country: "Croatia" },
  { id: "2026-de", country: "Germany" },
];

const USERS = [
  { userId: U1, displayName: "Alice" },
  { userId: U2, displayName: "Bob" },
  { userId: U3, displayName: "Charlie" },
];

function vote(
  userId: string,
  contestantId: string,
  scores: Record<string, number> | null,
  missed = false,
): Vote {
  return {
    id: `v-${userId}-${contestantId}`,
    roomId: "r-1",
    userId,
    contestantId,
    scores,
    missed,
    hotTake: null,
    hotTakeEditedAt: null,
    updatedAt: "2026-04-26T00:00:00Z",
  };
}

const VOTES: Vote[] = [
  // U1 — biggest mean 6, U1 ranks AL>BE>CR>DE
  vote(U1, "2026-al", { Vocals: 10, Outfit: 8 }),
  vote(U1, "2026-be", { Vocals: 8, Outfit: 6 }),
  vote(U1, "2026-cr", { Vocals: 6, Outfit: 4 }),
  vote(U1, "2026-de", { Vocals: 4, Outfit: 2 }),
  // U2 — mean 6, ranks BE>CR>AL>DE
  vote(U2, "2026-al", { Vocals: 5, Outfit: 5 }),
  vote(U2, "2026-be", { Vocals: 9, Outfit: 9 }),
  vote(U2, "2026-cr", { Vocals: 7, Outfit: 7 }),
  vote(U2, "2026-de", { Vocals: 3, Outfit: 3 }),
  // U3 — mean 7, ranks CR>AL>DE>BE
  vote(U3, "2026-al", { Vocals: 8, Outfit: 8 }),
  vote(U3, "2026-be", { Vocals: 4, Outfit: 4 }),
  vote(U3, "2026-cr", { Vocals: 10, Outfit: 10 }),
  vote(U3, "2026-de", { Vocals: 6, Outfit: 6 }),
];

const RESULTS: UserResult[] = [
  // U1 — AL=12, BE=10, CR=8, DE=7
  { userId: U1, contestantId: "2026-al", weightedScore: 9, rank: 1, pointsAwarded: 12 },
  { userId: U1, contestantId: "2026-be", weightedScore: 7, rank: 2, pointsAwarded: 10 },
  { userId: U1, contestantId: "2026-cr", weightedScore: 5, rank: 3, pointsAwarded: 8 },
  { userId: U1, contestantId: "2026-de", weightedScore: 3, rank: 4, pointsAwarded: 7 },
  // U2 — BE=12, CR=10, AL=8, DE=7
  { userId: U2, contestantId: "2026-be", weightedScore: 9, rank: 1, pointsAwarded: 12 },
  { userId: U2, contestantId: "2026-cr", weightedScore: 7, rank: 2, pointsAwarded: 10 },
  { userId: U2, contestantId: "2026-al", weightedScore: 5, rank: 3, pointsAwarded: 8 },
  { userId: U2, contestantId: "2026-de", weightedScore: 3, rank: 4, pointsAwarded: 7 },
  // U3 — CR=12, AL=10, DE=8, BE=7
  { userId: U3, contestantId: "2026-cr", weightedScore: 10, rank: 1, pointsAwarded: 12 },
  { userId: U3, contestantId: "2026-al", weightedScore: 8, rank: 2, pointsAwarded: 10 },
  { userId: U3, contestantId: "2026-de", weightedScore: 6, rank: 3, pointsAwarded: 8 },
  { userId: U3, contestantId: "2026-be", weightedScore: 4, rank: 4, pointsAwarded: 7 },
];

describe("computeAwards — canonical 3×4 fixture", () => {
  const input = {
    categories: CATS,
    contestants: CONTESTANTS,
    users: USERS,
    votes: VOTES,
    results: RESULTS,
  };

  it("emits a Best <Category> award per category", () => {
    const out = computeAwards(input);
    const best = out.filter((a) => a.awardKey.startsWith("best_"));
    expect(best.map((a) => a.awardKey).sort()).toEqual([
      "best_outfit",
      "best_vocals",
    ]);
  });

  it("Best Vocals — AL & CR tie at mean 7.67; tiebreak >8 count tied at 1; alphabetical → AL", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "best_vocals");
    expect(win?.winnerContestantId).toBe("2026-al");
    expect(win?.statLabel).toBe("Albania 7.7/10");
  });

  it("Best Outfit — AL & CR tie at mean 7; tiebreak >8 → CR (one >8 vote vs zero)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "best_outfit");
    expect(win?.winnerContestantId).toBe("2026-cr");
  });

  it("Biggest stan — Charlie with mean 7 (solo)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "biggest_stan");
    expect(win?.winnerUserId).toBe(U3);
    expect(win?.winnerUserIdB).toBeNull();
  });

  it("Harshest critic — Alice & Bob both at mean 6 (joint, alphabetical)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "harshest_critic");
    expect(win?.winnerUserId).toBe(U1); // Alice
    expect(win?.winnerUserIdB).toBe(U2); // Bob
  });

  it("Hive mind master — Alice (closest Spearman to consensus)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "hive_mind_master");
    expect(win?.winnerUserId).toBe(U1);
    expect(win?.winnerUserIdB).toBeNull();
  });

  it("Most contrarian — Bob (highest Spearman distance)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "most_contrarian");
    expect(win?.winnerUserId).toBe(U2);
  });

  it("Neighbourhood voters — Alice & Bob (highest Pearson)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "neighbourhood_voters");
    expect(win?.winnerUserId).toBe(U1);
    expect(win?.winnerUserIdB).toBe(U2);
    expect(win?.statValue).toBeCloseTo(0.4, 2);
  });

  it("The dark horse — BE & CR tied at variance ~4.22; alphabetical → Belgium", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "the_dark_horse");
    expect(win?.winnerContestantId).toBe("2026-be");
  });

  it("Fashion stan — Charlie (10 in Outfit category)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "fashion_stan");
    expect(win?.winnerUserId).toBe(U3);
    expect(win?.statValue).toBe(10);
  });

  it("The enabler — Alice (gave 12 to AL, the group winner)", () => {
    const out = computeAwards(input);
    const win = out.find((a) => a.awardKey === "the_enabler");
    // Group winner per leaderboard sum: AL=30, CR=30 — alphabetical tiebreak → AL.
    // U1 gave 12 to AL → solo enabler.
    expect(win?.winnerUserId).toBe(U1);
    expect(win?.winnerUserIdB).toBeNull();
  });

  it("emits awards in §11.3 reveal sequence (categories, then personality social-heat order)", () => {
    const out = computeAwards(input);
    const order = out.map((a) => a.awardKey);
    // Categories first (any order between them is OK), then biggest_stan,
    // harshest_critic, most_contrarian, hive_mind, neighbourhood, dark_horse,
    // fashion_stan, the_enabler.
    const personalityIdx = order.findIndex((k) => !k.startsWith("best_"));
    expect(order.slice(personalityIdx)).toEqual([
      "biggest_stan",
      "harshest_critic",
      "most_contrarian",
      "hive_mind_master",
      "neighbourhood_voters",
      "the_dark_horse",
      "fashion_stan",
      "the_enabler",
    ]);
  });
});

// ─── edge cases ──────────────────────────────────────────────────────────────

describe("computeAwards — edge cases", () => {
  it("single-user room: skips Neighbourhood, Hive mind, Most contrarian", () => {
    const input = {
      categories: CATS,
      contestants: CONTESTANTS,
      users: [USERS[0]],
      votes: VOTES.filter((v) => v.userId === U1),
      results: RESULTS.filter((r) => r.userId === U1),
    };
    const out = computeAwards(input);
    const keys = out.map((a) => a.awardKey);
    expect(keys).not.toContain("neighbourhood_voters");
    expect(keys).not.toContain("hive_mind_master");
    expect(keys).not.toContain("most_contrarian");
    // Solo-user-still-fires awards:
    expect(keys).toContain("best_vocals");
    expect(keys).toContain("biggest_stan");
    expect(keys).toContain("harshest_critic");
    expect(keys).toContain("the_dark_horse");
  });

  it("empty room (no users): returns []", () => {
    const out = computeAwards({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [],
      votes: [],
      results: [],
    });
    expect(out).toEqual([]);
  });

  it("user with all-missed votes is excluded from Harshest/Biggest/Fashion", () => {
    const allMissed = VOTES.map((v) =>
      v.userId === U2 ? { ...v, scores: null, missed: true } : v,
    );
    const out = computeAwards({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: allMissed,
      results: RESULTS,
    });
    const harshest = out.find((a) => a.awardKey === "harshest_critic");
    // Without Bob's data, Alice (mean 6) is solo harshest.
    expect(harshest?.winnerUserId).toBe(U1);
    expect(harshest?.winnerUserIdB).toBeNull();
  });

  it("no outfit-like category → Fashion stan skipped", () => {
    const noOutfit: VotingCategory[] = [
      { name: "Vocals", weight: 1, key: "vocals" },
      { name: "Drama", weight: 1, key: "drama" },
    ];
    const renamed = VOTES.map((v) => ({
      ...v,
      scores: v.scores
        ? { Vocals: v.scores.Vocals, Drama: v.scores.Outfit }
        : v.scores,
    }));
    const out = computeAwards({
      categories: noOutfit,
      contestants: CONTESTANTS,
      users: USERS,
      votes: renamed,
      results: RESULTS,
    });
    expect(out.find((a) => a.awardKey === "fashion_stan")).toBeUndefined();
  });

  it("3-way tie on biggest_stan → top 2 alphabetical", () => {
    // Force all three users to mean 6.
    const flat: Vote[] = USERS.flatMap((u) =>
      CONTESTANTS.map((c) =>
        vote(u.userId, c.id, { Vocals: 6, Outfit: 6 }),
      ),
    );
    const out = computeAwards({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: flat,
      results: RESULTS,
    });
    const win = out.find((a) => a.awardKey === "biggest_stan");
    // Sorted alphabetical: Alice, Bob, Charlie → top 2 = Alice + Bob.
    expect(win?.winnerUserId).toBe(U1);
    expect(win?.winnerUserIdB).toBe(U2);
  });

  it("multiple users gave 12 to the group winner → joint enabler", () => {
    // Force U1 + U2 to both rank AL #1 → both award 12 to AL.
    // (U3 still ranks CR #1.) Construct fresh results.
    const r: UserResult[] = [
      { userId: U1, contestantId: "2026-al", weightedScore: 10, rank: 1, pointsAwarded: 12 },
      { userId: U1, contestantId: "2026-be", weightedScore: 5, rank: 2, pointsAwarded: 10 },
      { userId: U1, contestantId: "2026-cr", weightedScore: 4, rank: 3, pointsAwarded: 8 },
      { userId: U1, contestantId: "2026-de", weightedScore: 3, rank: 4, pointsAwarded: 7 },
      { userId: U2, contestantId: "2026-al", weightedScore: 10, rank: 1, pointsAwarded: 12 },
      { userId: U2, contestantId: "2026-be", weightedScore: 5, rank: 2, pointsAwarded: 10 },
      { userId: U2, contestantId: "2026-cr", weightedScore: 4, rank: 3, pointsAwarded: 8 },
      { userId: U2, contestantId: "2026-de", weightedScore: 3, rank: 4, pointsAwarded: 7 },
      { userId: U3, contestantId: "2026-cr", weightedScore: 10, rank: 1, pointsAwarded: 12 },
      { userId: U3, contestantId: "2026-al", weightedScore: 8, rank: 2, pointsAwarded: 10 },
      { userId: U3, contestantId: "2026-be", weightedScore: 5, rank: 3, pointsAwarded: 8 },
      { userId: U3, contestantId: "2026-de", weightedScore: 3, rank: 4, pointsAwarded: 7 },
    ];
    const out = computeAwards({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: VOTES,
      results: r,
    });
    const enabler = out.find((a) => a.awardKey === "the_enabler");
    // Group winner: AL = 12+12+10 = 34. Two users gave 12 to AL → joint, alphabetical.
    expect(enabler?.winnerUserId).toBe(U1); // Alice
    expect(enabler?.winnerUserIdB).toBe(U2); // Bob
  });

  it("no user gave 12 to the group winner → enabler skipped", () => {
    // Group winner gets 10s, no 12s. Replicate by giving everyone same low.
    const r: UserResult[] = USERS.flatMap((u) =>
      CONTESTANTS.map((c, i) => ({
        userId: u.userId,
        contestantId: c.id,
        weightedScore: 5,
        rank: i + 1,
        pointsAwarded: i === 0 ? 10 : 0, // no 12s anywhere
      })),
    );
    const out = computeAwards({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: VOTES,
      results: r,
    });
    expect(out.find((a) => a.awardKey === "the_enabler")).toBeUndefined();
  });
});
