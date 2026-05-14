import { describe, it, expect } from "vitest";
import { buildParticipantDrillDown } from "@/components/results/drill-down/buildParticipantDrillDown";

// Categories use lowercase `name` matching the score-blob keys —
// computeWeightedScore looks up scores by category.name (see scoring.ts).
// Real-world votes write scores keyed by name; the lowercase here matches
// the Task 2 convention established on this branch.
const CATEGORIES = [
  { name: "vocals", weight: 1, key: "vocals" },
  { name: "music", weight: 1, key: "music" },
];

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
];

const CONTESTANTS = [
  {
    id: "2026-se",
    country: "Sweden",
    countryCode: "se",
    flagEmoji: "🇸🇪",
    artist: "A",
    song: "S",
    runningOrder: 1,
    event: "final" as const,
    year: 2026,
  },
  {
    id: "2026-no",
    country: "Norway",
    countryCode: "no",
    flagEmoji: "🇳🇴",
    artist: "A",
    song: "S",
    runningOrder: 2,
    event: "final" as const,
    year: 2026,
  },
];

const LEADERBOARD = [
  { contestantId: "2026-se", totalPoints: 20, rank: 1 },
  { contestantId: "2026-no", totalPoints: 12, rank: 2 },
];

const VOTE_DETAILS = [
  // Alice: aligns with leaderboard (Sweden 9, Norway 5) → high Spearman
  {
    userId: "u1",
    contestantId: "2026-se",
    scores: { vocals: 9, music: 9 },
    missed: false,
    pointsAwarded: 12,
    hotTake: "Banger.",
    hotTakeEditedAt: null,
  },
  {
    userId: "u1",
    contestantId: "2026-no",
    scores: { vocals: 5, music: 5 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  // Bob: inverts the room (Sweden 4, Norway 8) → negative Spearman
  {
    userId: "u2",
    contestantId: "2026-se",
    scores: { vocals: 4, music: 4 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u2",
    contestantId: "2026-no",
    scores: { vocals: 8, music: 8 },
    missed: false,
    pointsAwarded: 12,
    hotTake: null,
    hotTakeEditedAt: null,
  },
];

describe("buildParticipantDrillDown", () => {
  it("rows sorted by user's weighted score desc", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows.map((r) => r.contestantId)).toEqual(["2026-se", "2026-no"]);
    expect(out.rows[0]).toMatchObject({
      contestantId: "2026-se",
      weightedScore: 9,
      pointsAwarded: 12,
      hotTake: "Banger.",
    });
  });

  it("header carries the user identity and total points awarded", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.header).toEqual({
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      totalPointsAwarded: 20,
      hotTakeCount: 1,
    });
  });

  it("aggregates: mean across non-missed weightedScore", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.mean).toBeCloseTo(7, 1);
  });

  it("aggregates: harshness is signed delta against room mean (negative = harsher)", () => {
    const out = buildParticipantDrillDown("u2", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    // Room mean: (9+5+4+8)/4 = 6.5; Bob mean: (4+8)/2 = 6.0; harshness = -0.5.
    expect(out.aggregates.harshness).toBeCloseTo(-0.5, 1);
  });

  it("aggregates: Spearman alignment uses leaderboard total order vs user's weighted ranking", () => {
    const aliceOut = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(aliceOut.aggregates.alignment).toBeCloseTo(1, 2);

    const bobOut = buildParticipantDrillDown("u2", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(bobOut.aggregates.alignment).toBeCloseTo(-1, 2);
  });

  it("empty payload (user voted on nothing) returns null aggregates and zero hot-takes", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: [],
    });
    expect(out.rows).toEqual([]);
    expect(out.header.totalPointsAwarded).toBe(0);
    expect(out.header.hotTakeCount).toBe(0);
    expect(out.aggregates.mean).toBeNull();
    expect(out.aggregates.harshness).toBeNull();
    expect(out.aggregates.alignment).toBeNull();
  });
});
