import { describe, it, expect } from "vitest";
import type { Vote, VotingCategory } from "@/types";
import { buildPersonalNeighbours } from "./buildPersonalNeighbours";

const U1 = "11111111-2222-4333-8444-000000000001";
const U2 = "22222222-3333-4444-8555-000000000002";
const U3 = "33333333-4444-4555-8666-000000000003";
const U4 = "44444444-5555-4666-8777-000000000004";

const CATS: VotingCategory[] = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Outfit", weight: 1, key: "outfit" },
];

const CONTESTANTS = [
  { id: "2026-al", country: "Albania" },
  { id: "2026-be", country: "Belgium" },
  { id: "2026-cr", country: "Croatia" },
  { id: "2026-de", country: "Germany" },
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

describe("buildPersonalNeighbours", () => {
  it("returns [] when there are fewer than 3 signal-bearing users", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 9, Outfit: 9 }),
        vote(U2, "2026-al", { Vocals: 8, Outfit: 8 }),
      ],
      results: [],
    });
    expect(result).toEqual([]);
  });

  it("returns [] when only one user has signal", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 9 }),
        vote(U2, "2026-al", { Vocals: 5 }, true),
        vote(U3, "2026-al", { Vocals: 5 }, true),
      ],
      results: [],
    });
    expect(result).toEqual([]);
  });

  it("returns one entry per signal-bearing user, each pointing at their argmax neighbour", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U1, "2026-cr", { Vocals: 7, Outfit: 6 }),
        vote(U1, "2026-de", { Vocals: 5, Outfit: 5 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U2, "2026-cr", { Vocals: 4, Outfit: 5 }),
        vote(U2, "2026-de", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
        vote(U3, "2026-cr", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-de", { Vocals: 5, Outfit: 5 }),
      ],
      results: [],
    });
    expect(result).toHaveLength(3);
    const byUser = new Map(result.map((r) => [r.userId, r]));
    expect(byUser.get(U1)?.neighbourUserId).toBe(U3);
    expect(byUser.get(U3)?.neighbourUserId).toBe(U1);
    expect([U1, U3]).toContain(byUser.get(U2)?.neighbourUserId);
  });

  it("flags isReciprocal=true for mutual top-1 pairs", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U1, "2026-cr", { Vocals: 7, Outfit: 6 }),
        vote(U1, "2026-de", { Vocals: 5, Outfit: 5 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U2, "2026-cr", { Vocals: 4, Outfit: 5 }),
        vote(U2, "2026-de", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
        vote(U3, "2026-cr", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-de", { Vocals: 5, Outfit: 5 }),
      ],
      results: [],
    });
    const byUser = new Map(result.map((r) => [r.userId, r]));
    expect(byUser.get(U1)?.isReciprocal).toBe(true);
    expect(byUser.get(U3)?.isReciprocal).toBe(true);
    expect(byUser.get(U2)?.isReciprocal).toBe(false);
  });

  it("breaks ties alphabetically by neighbour displayName", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 9 }),
        vote(U1, "2026-be", { Vocals: 9 }),
        vote(U1, "2026-cr", { Vocals: 9 }),
        vote(U1, "2026-de", { Vocals: 9 }),
        vote(U2, "2026-al", { Vocals: 8 }),
        vote(U2, "2026-be", { Vocals: 6 }),
        vote(U2, "2026-cr", { Vocals: 4 }),
        vote(U2, "2026-de", { Vocals: 2 }),
        vote(U3, "2026-al", { Vocals: 8 }),
        vote(U3, "2026-be", { Vocals: 6 }),
        vote(U3, "2026-cr", { Vocals: 4 }),
        vote(U3, "2026-de", { Vocals: 2 }),
      ],
      results: [],
    });
    const row = result.find((r) => r.userId === U1);
    expect(row?.neighbourUserId).toBe(U2);
  });

  it("excludes zero-signal users from the pool (neither as viewer nor neighbour)", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
        { userId: U4, displayName: "Dan" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 9 }),
        vote(U1, "2026-be", { Vocals: 3 }),
        vote(U2, "2026-al", { Vocals: 8 }),
        vote(U2, "2026-be", { Vocals: 4 }),
        vote(U3, "2026-al", { Vocals: 7 }),
        vote(U3, "2026-be", { Vocals: 5 }),
        vote(U4, "2026-al", { Vocals: 5 }, true),
      ],
      results: [],
    });
    const userIds = result.map((r) => r.userId);
    const neighbourIds = result.map((r) => r.neighbourUserId);
    expect(userIds).not.toContain(U4);
    expect(neighbourIds).not.toContain(U4);
    expect(result).toHaveLength(3);
  });

  it("rounds Pearson to 3 decimals", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
      ],
      results: [],
    });
    for (const row of result) {
      const fractional = String(row.pearson).split(".")[1] ?? "";
      expect(fractional.length).toBeLessThanOrEqual(3);
    }
  });

  it("is deterministic — same input, same output regardless of user ordering", () => {
    const input = {
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
      ],
      results: [],
    };
    const a = buildPersonalNeighbours(input);
    const b = buildPersonalNeighbours({
      ...input,
      users: [...input.users].reverse(),
    });
    const sortById = (
      rows: { userId: string; neighbourUserId: string }[],
    ) => [...rows].sort((x, y) => x.userId.localeCompare(y.userId));
    expect(sortById(a)).toEqual(sortById(b));
  });
});
