import { describe, it, expect } from "vitest";
import { buildContestantDrillDown } from "@/components/results/drill-down/buildContestantDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const CATEGORIES = [
  { name: "vocals", weight: 1, key: "vocals" },
  { name: "music", weight: 1, key: "music" },
];

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
];

const VOTE_DETAILS: DonePayload["voteDetails"] = [
  {
    userId: "u1",
    contestantId: "2026-se",
    scores: { vocals: 9, music: 8 },
    missed: false,
    pointsAwarded: 12,
    hotTake: "Banger.",
    hotTakeEditedAt: null,
  },
  {
    userId: "u2",
    contestantId: "2026-se",
    scores: { vocals: 6, music: 7 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u3",
    contestantId: "2026-se",
    scores: {},
    missed: true,
    pointsAwarded: 0,
    hotTake: null,
    hotTakeEditedAt: null,
  },
];

describe("buildContestantDrillDown", () => {
  it("returns rows sorted by pointsAwarded desc with per-voter detail", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows.map((r) => r.userId)).toEqual(["u1", "u2", "u3"]);
    expect(out.rows[0]).toMatchObject({
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      missed: false,
      pointsAwarded: 12,
      weightedScore: 8.5,
      scores: { vocals: 9, music: 8 },
      hotTake: "Banger.",
      hotTakeEditedAt: null,
    });
  });

  it("missed entries land at the bottom and report missed=true", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows[2]).toMatchObject({
      userId: "u3",
      missed: true,
      pointsAwarded: 0,
    });
  });

  it("aggregates: mean / median across non-missed weightedScore", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.mean).toBeCloseTo(7.5, 1);
    expect(out.aggregates.median).toBeCloseTo(7.5, 1);
  });

  it("aggregates: highest + lowest carry the displayName and weightedScore", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.highest).toEqual({
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      weightedScore: 8.5,
    });
    expect(out.aggregates.lowest).toEqual({
      userId: "u2",
      displayName: "Bob",
      avatarSeed: "bob",
      weightedScore: 6.5,
    });
  });

  it("returns an empty rows array + null aggregates when no one rated the contestant", () => {
    const out = buildContestantDrillDown("2026-nope", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows).toEqual([]);
    expect(out.aggregates.mean).toBeNull();
    expect(out.aggregates.median).toBeNull();
    expect(out.aggregates.highest).toBeNull();
    expect(out.aggregates.lowest).toBeNull();
  });

  it("even count of voters uses the average of the two middle values for median", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: [
        ...MEMBERS,
        { userId: "u4", displayName: "David", avatarSeed: "david" },
      ],
      voteDetails: [
        ...VOTE_DETAILS,
        {
          userId: "u4",
          contestantId: "2026-se",
          scores: { vocals: 5, music: 5 },
          missed: false,
          pointsAwarded: 4,
          hotTake: null,
          hotTakeEditedAt: null,
        },
      ],
    });
    expect(out.aggregates.median).toBeCloseTo(6.5, 1);
  });
});
