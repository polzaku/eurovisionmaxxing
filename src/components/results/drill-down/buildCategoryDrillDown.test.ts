import { describe, it, expect } from "vitest";
import { buildCategoryDrillDown } from "@/components/results/drill-down/buildCategoryDrillDown";

// Lowercase category names per the convention established by buildContestantDrillDown
// (computeWeightedScore looks scores up by category.name).
const CATEGORIES = [
  { name: "vocals", weight: 1, key: "vocals" },
  { name: "music", weight: 1, key: "music" },
];

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
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
];

const VOTE_DETAILS = [
  {
    userId: "u1",
    contestantId: "2026-se",
    scores: { vocals: 9 },
    missed: false,
    pointsAwarded: 12,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u2",
    contestantId: "2026-se",
    scores: { vocals: 7 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u3",
    contestantId: "2026-se",
    scores: { vocals: 5 },
    missed: false,
    pointsAwarded: 5,
    hotTake: null,
    hotTakeEditedAt: null,
  },
];

describe("buildCategoryDrillDown", () => {
  it("rows sorted by category mean desc", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: [
        ...CONTESTANTS,
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
      ],
      voteDetails: [
        ...VOTE_DETAILS,
        {
          userId: "u1",
          contestantId: "2026-no",
          scores: { vocals: 3 },
          missed: false,
          pointsAwarded: 2,
          hotTake: null,
          hotTakeEditedAt: null,
        },
      ],
    });
    expect(out.rows.map((r) => r.contestantId)).toEqual(["2026-se", "2026-no"]);
  });

  it("row shape: mean / spread / voter count", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows[0]).toMatchObject({
      contestantId: "2026-se",
      mean: 7,
      spread: { min: 5, median: 7, max: 9 },
      voted: 3,
      total: 3,
    });
  });

  it("aggregates: highest + lowest single vote with voter identity", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.highest).toEqual({
      value: 9,
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
    });
    expect(out.aggregates.lowest).toEqual({
      value: 5,
      userId: "u3",
      displayName: "Carol",
      avatarSeed: "carol",
    });
  });

  it("aggregates: mean of means is the average of per-contestant means", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.meanOfMeans).toBeCloseTo(7, 1);
  });

  it("unknown category key returns empty rows and null aggregates", () => {
    const out = buildCategoryDrillDown("unknown", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows).toEqual([]);
    expect(out.aggregates.highest).toBeNull();
    expect(out.aggregates.lowest).toBeNull();
    expect(out.aggregates.meanOfMeans).toBeNull();
  });

  it("contestants with all-missed votes are dropped from rows entirely", () => {
    const allMissed = [
      {
        userId: "u1",
        contestantId: "2026-se",
        scores: {},
        missed: true,
        pointsAwarded: 0,
        hotTake: null,
        hotTakeEditedAt: null,
      },
    ];
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: allMissed,
    });
    expect(out.rows).toEqual([]);
  });

  it("voter count reflects only non-missed scoring for the specific category", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows[0].voted).toBe(3);
    expect(out.rows[0].total).toBe(3);
  });
});
