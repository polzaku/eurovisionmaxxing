import { describe, it, expect } from "vitest";
import {
  buildContestantBreakdowns,
  type ContestantBreakdown,
} from "@/lib/results/buildContestantBreakdowns";
import type { UserBreakdown } from "@/lib/results/loadResults";

const ALICE: UserBreakdown = {
  userId: "u-alice",
  displayName: "Alice",
  avatarSeed: "alice",
  picks: [
    { contestantId: "2026-no", pointsAwarded: 12 },
    { contestantId: "2026-rs", pointsAwarded: 8 },
  ],
};

const BOB: UserBreakdown = {
  userId: "u-bob",
  displayName: "Bob",
  avatarSeed: "bob",
  picks: [
    { contestantId: "2026-no", pointsAwarded: 10 },
    { contestantId: "2026-de", pointsAwarded: 7 },
  ],
};

const CARLA: UserBreakdown = {
  userId: "u-carla",
  displayName: "Carla",
  avatarSeed: "carla",
  picks: [
    { contestantId: "2026-no", pointsAwarded: 6 },
  ],
};

describe("buildContestantBreakdowns", () => {
  it("inverts user breakdowns into per-contestant gives", () => {
    const result = buildContestantBreakdowns([ALICE, BOB]);
    const norway = result.find((b) => b.contestantId === "2026-no");
    expect(norway).toBeDefined();
    expect(norway!.gives).toHaveLength(2);
    const serbia = result.find((b) => b.contestantId === "2026-rs");
    expect(serbia!.gives).toHaveLength(1);
    expect(serbia!.gives[0].userId).toBe("u-alice");
  });

  it("sorts each contestant's gives by points descending", () => {
    const result = buildContestantBreakdowns([ALICE, BOB, CARLA]);
    const norway = result.find((b) => b.contestantId === "2026-no")!;
    expect(norway.gives.map((g) => g.pointsAwarded)).toEqual([12, 10, 6]);
    expect(norway.gives.map((g) => g.userId)).toEqual([
      "u-alice",
      "u-bob",
      "u-carla",
    ]);
  });

  it("breaks point ties alphabetically by displayName for stable rendering", () => {
    const ZACH: UserBreakdown = {
      userId: "u-zach",
      displayName: "Zach",
      avatarSeed: "zach",
      picks: [{ contestantId: "2026-no", pointsAwarded: 10 }],
    };
    // Bob and Zach both gave 10 — Bob comes first alphabetically.
    const result = buildContestantBreakdowns([BOB, ZACH]);
    const norway = result.find((b) => b.contestantId === "2026-no")!;
    expect(norway.gives.map((g) => g.userId)).toEqual(["u-bob", "u-zach"]);
  });

  it("includes displayName + avatarSeed on each give for direct rendering", () => {
    const result = buildContestantBreakdowns([ALICE]);
    const serbia = result.find((b) => b.contestantId === "2026-rs")!;
    expect(serbia.gives[0]).toEqual({
      userId: "u-alice",
      displayName: "Alice",
      avatarSeed: "alice",
      pointsAwarded: 8,
    });
  });

  it("returns an empty array when there are no breakdowns", () => {
    expect(buildContestantBreakdowns([])).toEqual([]);
  });

  it("omits contestants with no gives (breakdowns only carry pointsAwarded > 0)", () => {
    // The upstream loader already drops 0-point picks before constructing
    // UserBreakdowns, so the inversion never sees them. Verify we don't
    // fabricate empty rows for unranked contestants.
    const result = buildContestantBreakdowns([ALICE]);
    expect(result.find((b) => b.contestantId === "2026-de")).toBeUndefined();
  });

  it("does not mutate the input breakdowns", () => {
    const aliceCopy: UserBreakdown = JSON.parse(JSON.stringify(ALICE));
    buildContestantBreakdowns([aliceCopy]);
    expect(aliceCopy).toEqual(ALICE);
  });

  it("returns ContestantBreakdown shape with contestantId + gives", () => {
    const result: ContestantBreakdown[] = buildContestantBreakdowns([ALICE]);
    for (const b of result) {
      expect(b).toHaveProperty("contestantId");
      expect(b).toHaveProperty("gives");
      expect(Array.isArray(b.gives)).toBe(true);
    }
  });
});
