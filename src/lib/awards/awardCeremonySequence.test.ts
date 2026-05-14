import { describe, it, expect } from "vitest";
import { awardCeremonySequence } from "./awardCeremonySequence";
import type { Contestant, RoomAward } from "@/types";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

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

function mkPN(
  userId: string,
  neighbourUserId: string,
  pearson = 0.8,
  isReciprocal = false,
): PersonalNeighbour {
  return { userId, neighbourUserId, pearson, isReciprocal };
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

  it("splices the personal-neighbour synthetic card immediately after neighbourhood_voters", () => {
    const members = [
      { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
      { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
      { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
    ];
    const awards: RoomAward[] = [
      mkAward("biggest_stan", { winnerUserId: "u1" }),
      mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
      mkAward("the_dark_horse", { winnerContestantId: "2026-SE" }),
    ];
    const result = awardCeremonySequence(awards, [mkContestant("2026-SE", "Sweden")], members, [], {
      personalNeighbours: [mkPN("u3", "u1", 0.92, false)],
      viewerUserId: "u3",
    });
    const keys = result.map((c) => c.award.awardKey);
    expect(keys).toEqual([
      "biggest_stan",
      "neighbourhood_voters",
      "your_neighbour",
      "the_dark_horse",
    ]);
  });

  it("omits the personal-neighbour card when the viewer has no entry", () => {
    const members = [
      { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
      { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    ];
    const awards: RoomAward[] = [
      mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
    ];
    const result = awardCeremonySequence(awards, [], members, [], {
      personalNeighbours: [],
      viewerUserId: "u1",
    });
    expect(result.map((c) => c.award.awardKey)).toEqual(["neighbourhood_voters"]);
  });

  it("omits the personal-neighbour card when viewerUserId is null (stranger)", () => {
    const members = [
      { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
      { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    ];
    const awards: RoomAward[] = [
      mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
    ];
    const result = awardCeremonySequence(awards, [], members, [], {
      personalNeighbours: [mkPN("u1", "u2"), mkPN("u2", "u1")],
      viewerUserId: null,
    });
    expect(result.map((c) => c.award.awardKey)).toEqual(["neighbourhood_voters"]);
  });

  it("carries neighbour avatar + reciprocity into the synthetic card", () => {
    const members = [
      { userId: "u1", displayName: "Alice", avatarSeed: "alice-seed" },
      { userId: "u2", displayName: "Bob", avatarSeed: "bob-seed" },
      { userId: "u3", displayName: "Carol", avatarSeed: "carol-seed" },
    ];
    const awards: RoomAward[] = [
      mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
    ];
    const result = awardCeremonySequence(awards, [], members, [], {
      personalNeighbours: [mkPN("u3", "u1", 0.881, true)],
      viewerUserId: "u3",
    });
    const synthetic = result.find((c) => c.award.awardKey === "your_neighbour");
    expect(synthetic?.kind).toBe("personal-neighbour");
    if (synthetic?.kind !== "personal-neighbour") return;
    expect(synthetic.viewerUser.userId).toBe("u3");
    expect(synthetic.neighbourUser.userId).toBe("u1");
    expect(synthetic.neighbourUser.avatarSeed).toBe("alice-seed");
    expect(synthetic.pearson).toBe(0.881);
    expect(synthetic.isReciprocal).toBe(true);
  });

  it("drops the synthetic card defensively if the neighbour can't be resolved against members", () => {
    const members = [
      { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
    ];
    const result = awardCeremonySequence([], [], members, [], {
      personalNeighbours: [mkPN("u3", "u1")],
      viewerUserId: "u3",
    });
    expect(result).toEqual([]);
  });

  describe("overall-winner card (fix 2026-05-14)", () => {
    it("prepends an overall-winner card when leaderboard has rank-1 contestant", () => {
      const awards: RoomAward[] = [
        mkAward("best_vocals", { winnerContestantId: "2026-SE" }),
        mkAward("biggest_stan", { winnerUserId: "u1" }),
      ];
      const members = [
        { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
      ];
      const result = awardCeremonySequence(
        awards,
        [mkContestant("2026-SE", "Sweden"), mkContestant("2026-UK", "Ukraine")],
        members,
        CATEGORIES,
        {
          leaderboard: [
            { contestantId: "2026-UK", totalPoints: 200, rank: 1 },
            { contestantId: "2026-SE", totalPoints: 150, rank: 2 },
          ],
        },
      );
      expect(result[0].award.awardKey).toBe("overall_winner");
      if (result[0].kind === "contestant" || result[0].kind === "overall-winner") {
        expect(result[0].contestant?.country).toBe("Ukraine");
      } else {
        throw new Error("Expected contestant-style card for overall-winner");
      }
      // Existing ordering for the rest holds.
      expect(result.slice(1).map((c) => c.award.awardKey)).toEqual([
        "best_vocals",
        "biggest_stan",
      ]);
    });

    it("omits the overall-winner card when leaderboard is empty or unset", () => {
      const awards = [mkAward("best_vocals", { winnerContestantId: "2026-SE" })];
      const noLb = awardCeremonySequence(
        awards,
        [mkContestant("2026-SE", "Sweden")],
        [],
        CATEGORIES,
      );
      expect(noLb[0].award.awardKey).toBe("best_vocals");

      const emptyLb = awardCeremonySequence(
        awards,
        [mkContestant("2026-SE", "Sweden")],
        [],
        CATEGORIES,
        { leaderboard: [] },
      );
      expect(emptyLb[0].award.awardKey).toBe("best_vocals");
    });

    it("omits the card if the rank-1 contestant cannot be resolved against the contestants pool", () => {
      const awards = [mkAward("best_vocals", { winnerContestantId: "2026-SE" })];
      const result = awardCeremonySequence(
        awards,
        [mkContestant("2026-SE", "Sweden")],
        [],
        CATEGORIES,
        {
          leaderboard: [
            { contestantId: "2026-XX", totalPoints: 200, rank: 1 },
          ],
        },
      );
      expect(result[0].award.awardKey).toBe("best_vocals");
    });

    it("carries the rank-1 total points onto the card for stat rendering", () => {
      const result = awardCeremonySequence(
        [],
        [mkContestant("2026-SE", "Sweden")],
        [],
        [],
        {
          leaderboard: [{ contestantId: "2026-SE", totalPoints: 142, rank: 1 }],
        },
      );
      expect(result).toHaveLength(1);
      expect(result[0].award.awardKey).toBe("overall_winner");
      expect(result[0].award.statValue).toBe(142);
    });
  });
});
