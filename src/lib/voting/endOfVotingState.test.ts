import { describe, it, expect } from "vitest";
import type { Contestant } from "@/types";
import { endOfVotingState } from "./endOfVotingState";

const C = (id: string, country: string, runningOrder: number): Contestant => ({
  id,
  country,
  countryCode: id.slice(-2),
  flagEmoji: "🏳️",
  artist: "A",
  song: "S",
  runningOrder,
  event: "final",
  year: 2026,
});

const CATEGORIES = ["vocals", "outfit"];

function fullScores() {
  return { vocals: 7, outfit: 8 };
}

describe("endOfVotingState", () => {
  it("returns allScored when every contestant is fully scored and none missed", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {
        "2026-al": fullScores(),
        "2026-be": fullScores(),
      },
      missedByContestant: {},
    });
    expect(state).toEqual({ kind: "allScored", total: 2 });
  });

  it("returns missedSome when no unscored but at least one missed (filled scores irrelevant)", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {
        "2026-al": fullScores(),
        "2026-be": fullScores(),
      },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("missedSome");
    if (state.kind === "missedSome") {
      expect(state.missed.map((c) => c.id)).toEqual(["2026-be"]);
    }
  });

  it("returns missedSome when missed contestant has no scores at all", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": fullScores() },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("missedSome");
  });

  it("returns unscored when at least one contestant has no full scores and is not missed", () => {
    const contestants = [
      C("2026-al", "Albania", 1),
      C("2026-be", "Belgium", 2),
      C("2026-cy", "Cyprus", 3),
    ];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {
        "2026-al": fullScores(),
        "2026-be": { vocals: 5, outfit: null },
      },
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
    if (state.kind === "unscored") {
      expect(state.unscored.map((c) => c.id)).toEqual(["2026-be", "2026-cy"]);
    }
  });

  it("prefers missedSome over allScored when only missed (no unscored)", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": fullScores() },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("missedSome");
  });

  it("prefers unscored when one unscored AND one missed coexist", () => {
    const contestants = [
      C("2026-al", "Albania", 1),
      C("2026-be", "Belgium", 2),
      C("2026-cy", "Cyprus", 3),
    ];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": fullScores() },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("unscored");
    if (state.kind === "unscored") {
      expect(state.unscored.map((c) => c.id)).toEqual(["2026-cy"]);
    }
  });

  it("treats null category values as not-scored", () => {
    const contestants = [C("2026-al", "Albania", 1)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": { vocals: 5, outfit: null } },
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
  });

  it("treats undefined contestant scores as not-scored", () => {
    const contestants = [C("2026-al", "Albania", 1)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {},
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
  });

  it("returns allScored with total 0 for empty contestants", () => {
    const state = endOfVotingState({
      contestants: [],
      categoryNames: CATEGORIES,
      scoresByContestant: {},
      missedByContestant: {},
    });
    expect(state).toEqual({ kind: "allScored", total: 0 });
  });

  it("preserves contestant input order in unscored list", () => {
    const contestants = [
      C("2026-cy", "Cyprus", 3),
      C("2026-al", "Albania", 1),
      C("2026-be", "Belgium", 2),
    ];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {},
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
    if (state.kind === "unscored") {
      expect(state.unscored.map((c) => c.runningOrder)).toEqual([3, 1, 2]);
    }
  });
});
