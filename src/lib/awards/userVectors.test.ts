import { describe, it, expect } from "vitest";
import type { Vote, VotingCategory } from "@/types";
import { buildUserVectors } from "./userVectors";

const CATS: VotingCategory[] = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Outfit", weight: 1, key: "outfit" },
];

const CONTESTANTS = [
  { id: "2026-al", country: "Albania" },
  { id: "2026-be", country: "Belgium" },
];

const USERS = [
  { userId: "u1", displayName: "Alice" },
  { userId: "u2", displayName: "Bob" },
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

describe("buildUserVectors", () => {
  it("builds one vector per user with one entry per contestant (mean of category scores)", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        vote("u1", "2026-al", { Vocals: 10, Outfit: 8 }), // mean 9
        vote("u1", "2026-be", { Vocals: 4, Outfit: 6 }),  // mean 5
        vote("u2", "2026-al", { Vocals: 8, Outfit: 6 }),  // mean 7
        vote("u2", "2026-be", { Vocals: 6, Outfit: 4 }),  // mean 5
      ],
      results: [],
    });
    expect(result.get("u1")).toEqual([9, 5]);
    expect(result.get("u2")).toEqual([7, 5]);
  });

  it("substitutes 0 for missing contestants", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        vote("u1", "2026-al", { Vocals: 10, Outfit: 8 }),
        // u1 has no vote for 2026-be → fills 0
        vote("u2", "2026-al", { Vocals: 8, Outfit: 6 }),
        vote("u2", "2026-be", { Vocals: 6, Outfit: 4 }),
      ],
      results: [],
    });
    expect(result.get("u1")).toEqual([9, 0]);
    expect(result.get("u2")).toEqual([7, 5]);
  });

  it("drops users whose vector is all zeros (zero-signal voter)", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        // u1 has zero signal — only missed votes
        vote("u1", "2026-al", { Vocals: 5 }, true),
        vote("u1", "2026-be", { Vocals: 5 }, true),
        vote("u2", "2026-al", { Vocals: 8, Outfit: 6 }),
      ],
      results: [],
    });
    expect(result.has("u1")).toBe(false);
    expect(result.has("u2")).toBe(true);
  });

  it("returns an empty map when no users have any signal", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [],
      results: [],
    });
    expect(result.size).toBe(0);
  });

  it("ignores missed votes in the mean", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        vote("u1", "2026-al", { Vocals: 10, Outfit: 8 }), // counted, mean 9
        vote("u1", "2026-be", { Vocals: 5, Outfit: 5 }, true), // missed → 0
        vote("u2", "2026-al", { Vocals: 8 }),
      ],
      results: [],
    });
    expect(result.get("u1")).toEqual([9, 0]);
  });
});
