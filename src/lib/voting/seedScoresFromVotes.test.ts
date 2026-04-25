import { describe, it, expect } from "vitest";
import { seedScoresFromVotes } from "@/lib/voting/seedScoresFromVotes";
import type { VoteView } from "@/lib/rooms/get";

const CATEGORY_NAMES = ["Vocals", "Staging", "Outfit"] as const;
const CONTESTANT_IDS = ["2026-ua", "2026-se", "2026-gb"] as const;

describe("seedScoresFromVotes", () => {
  it("returns {} for an empty votes array", () => {
    expect(seedScoresFromVotes([], CATEGORY_NAMES, CONTESTANT_IDS)).toEqual({});
  });

  it("happy path: maps one vote's scores into the keyed shape", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, Staging: 9 },
        missed: false,
        hotTake: null,
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: 7, Staging: 9 },
    });
  });

  it("drops keys that are not in the provided category list", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, BogusStale: 3, Staging: 9 },
        missed: false,
        hotTake: null,
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: 7, Staging: 9 },
    });
  });

  it("drops votes whose contestantId is not in the provided list", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-xx",
        scores: { Vocals: 7 },
        missed: false,
        hotTake: null,
        updatedAt: "2026-04-25T12:00:00Z",
      },
      {
        contestantId: "2026-ua",
        scores: { Vocals: 5 },
        missed: false,
        hotTake: null,
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: 5 },
    });
  });

  it("skips votes with scores: null (missed-only rows)", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: null,
        missed: true,
        hotTake: null,
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({});
  });

  it("omits contestants whose scores were entirely filtered out", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { OnlyStaleKey: 7 },
        missed: false,
        hotTake: null,
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({});
  });

  it("preserves null score values when the category name is valid", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { Vocals: null, Staging: 6 },
        missed: false,
        hotTake: null,
        updatedAt: "2026-04-25T12:00:00Z",
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: null, Staging: 6 },
    });
  });
});
