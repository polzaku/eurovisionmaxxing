import { describe, it, expect } from "vitest";
import { contestantDiff } from "./contestantDiff";
import type { Contestant } from "@/types";

function mkContestant(
  countryCode: string,
  runningOrder: number,
): Contestant {
  return {
    id: `2026-${countryCode}`,
    year: 2026,
    event: "final",
    countryCode,
    country: countryCode.toUpperCase(),
    artist: "A",
    song: "S",
    flagEmoji: "🏳️",
    runningOrder,
  };
}

describe("contestantDiff", () => {
  it("returns empty arrays for identical lists", () => {
    const list = [mkContestant("se", 1), mkContestant("ua", 2)];
    expect(contestantDiff(list, list)).toEqual({
      added: [],
      removed: [],
      reordered: [],
    });
  });

  it("returns added + removed for one swap", () => {
    const prev = [mkContestant("se", 1)];
    const next = [mkContestant("ua", 1)];
    expect(contestantDiff(prev, next)).toEqual({
      added: ["ua"],
      removed: ["se"],
      reordered: [],
    });
  });

  it("returns reordered when running orders flip", () => {
    const prev = [mkContestant("se", 1), mkContestant("ua", 2)];
    const next = [mkContestant("ua", 1), mkContestant("se", 2)];
    expect(contestantDiff(prev, next)).toEqual({
      added: [],
      removed: [],
      reordered: ["se", "ua"],
    });
  });

  it("handles mixed add + remove + reorder", () => {
    const prev = [
      mkContestant("se", 1),
      mkContestant("ua", 2),
      mkContestant("fr", 3),
    ];
    const next = [
      mkContestant("ua", 1), // reordered (was 2, now 1)
      mkContestant("fr", 2), // reordered (was 3, now 2)
      mkContestant("nl", 3), // added
      // se removed
    ];
    expect(contestantDiff(prev, next)).toEqual({
      added: ["nl"],
      removed: ["se"],
      reordered: ["fr", "ua"],
    });
  });

  it("returns empty for two empty lists", () => {
    expect(contestantDiff([], [])).toEqual({
      added: [],
      removed: [],
      reordered: [],
    });
  });

  it("treats only-prev or only-next as full add/remove", () => {
    const prev = [mkContestant("se", 1), mkContestant("ua", 2)];
    expect(contestantDiff(prev, [])).toEqual({
      added: [],
      removed: ["se", "ua"],
      reordered: [],
    });
    expect(contestantDiff([], prev)).toEqual({
      added: ["se", "ua"],
      removed: [],
      reordered: [],
    });
  });

  it("sorts each result array alphabetically for stability", () => {
    const prev = [
      mkContestant("ua", 1),
      mkContestant("fr", 2),
      mkContestant("se", 3),
    ];
    const next = [
      mkContestant("fr", 1), // reordered
      mkContestant("se", 2), // reordered
      mkContestant("ua", 3), // reordered
    ];
    const result = contestantDiff(prev, next);
    expect(result.reordered).toEqual(["fr", "se", "ua"]);
  });
});
