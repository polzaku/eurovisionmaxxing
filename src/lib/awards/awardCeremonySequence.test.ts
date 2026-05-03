import { describe, it, expect } from "vitest";
import { awardCeremonySequence } from "./awardCeremonySequence";
import type { Contestant, RoomAward } from "@/types";

const CATEGORIES = [
  { name: "Vocals", weight: 1 },
  { name: "Outfit", weight: 1 },
];

function mkAward(awardKey: string, extra: Partial<RoomAward> = {}): RoomAward {
  return {
    roomId: "r",
    awardKey,
    awardName: awardKey,
    winnerUserId: extra.winnerUserId ?? null,
    winnerUserIdB: extra.winnerUserIdB ?? null,
    winnerContestantId: extra.winnerContestantId ?? null,
    statValue: extra.statValue ?? null,
    statLabel: extra.statLabel ?? null,
  };
}

function mkContestant(id: string, country: string): Contestant {
  return {
    id,
    year: 2026,
    event: "final",
    countryCode: id.split("-")[1] ?? "XX",
    country,
    artist: "A",
    song: "S",
    flagEmoji: "🏳️",
    runningOrder: 1,
  };
}

describe("awardCeremonySequence", () => {
  it("orders category awards before personality awards", () => {
    const awards: RoomAward[] = [
      mkAward("biggest_stan", { winnerUserId: "u1" }),
      mkAward("best_vocals", { winnerContestantId: "2026-SE" }),
    ];
    const members = [{ userId: "u1", displayName: "Alice", avatarSeed: "alice" }];
    const result = awardCeremonySequence(
      awards,
      [mkContestant("2026-SE", "Sweden")],
      members,
      CATEGORIES,
    );
    expect(result.map((c) => c.award.awardKey)).toEqual([
      "best_vocals",
      "biggest_stan",
    ]);
  });

  it("orders personality awards by PERSONALITY_AWARD_KEYS with the_enabler last", () => {
    const awards: RoomAward[] = [
      mkAward("the_enabler", { winnerUserId: "u1" }),
      mkAward("biggest_stan", { winnerUserId: "u1" }),
      mkAward("hive_mind_master", { winnerUserId: "u1" }),
      mkAward("harshest_critic", { winnerUserId: "u1" }),
    ];
    const members = [{ userId: "u1", displayName: "Alice", avatarSeed: "alice" }];
    const result = awardCeremonySequence(awards, [], members, []);
    expect(result.map((c) => c.award.awardKey)).toEqual([
      "biggest_stan",
      "harshest_critic",
      "hive_mind_master",
      "the_enabler",
    ]);
  });

  it("orders category awards by spec category order, not by award_key collation", () => {
    const awards: RoomAward[] = [
      mkAward("best_outfit", { winnerContestantId: "2026-NL" }),
      mkAward("best_vocals", { winnerContestantId: "2026-SE" }),
    ];
    const result = awardCeremonySequence(
      awards,
      [mkContestant("2026-SE", "Sweden"), mkContestant("2026-NL", "Netherlands")],
      [],
      CATEGORIES,
    );
    expect(result.map((c) => c.award.awardKey)).toEqual([
      "best_vocals",
      "best_outfit",
    ]);
  });

  it("attaches resolved contestant for contestant awards", () => {
    const awards = [mkAward("best_vocals", { winnerContestantId: "2026-SE" })];
    const result = awardCeremonySequence(
      awards,
      [mkContestant("2026-SE", "Sweden")],
      [],
      CATEGORIES,
    );
    expect(result[0].kind).toBe("contestant");
    if (result[0].kind === "contestant") {
      expect(result[0].contestant?.country).toBe("Sweden");
    }
  });

  it("attaches resolved member(s) for user awards, including pair", () => {
    const members = [
      { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
      { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    ];
    const awards = [
      mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
    ];
    const result = awardCeremonySequence(awards, [], members, []);
    expect(result[0].kind).toBe("user");
    if (result[0].kind === "user") {
      expect(result[0].winner?.displayName).toBe("Alice");
      expect(result[0].partner?.displayName).toBe("Bob");
    }
  });

  it("drops awards whose winner cannot be resolved (defensive, never throws)", () => {
    const awards = [mkAward("biggest_stan", { winnerUserId: "missing" })];
    const result = awardCeremonySequence(awards, [], [], []);
    expect(result).toEqual([]);
  });

  it("returns [] for an empty awards array", () => {
    expect(awardCeremonySequence([], [], [], [])).toEqual([]);
  });
});
