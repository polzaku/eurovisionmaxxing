import { describe, it, expect } from "vitest";
import {
  nextVotingProgress,
  countsFromState,
  initialVotingProgressState,
  type VotingProgressState,
} from "./votingProgressReducer";

const CATEGORIES = 3;

describe("votingProgressReducer", () => {
  it("starts empty — no fully-scored users for any contestant", () => {
    const state = initialVotingProgressState();
    expect(countsFromState(state, "2026-se")).toBe(0);
  });

  it("adds a user→contestant entry when scoredCount equals categoriesCount", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 3 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(1);
  });

  it("does NOT count a partial-score broadcast", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 2 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(0);
  });

  it("does NOT count a missed broadcast (scoredCount: 0 from the server)", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 0 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(0);
  });

  it("decrements when a fully-scored user un-fills (e.g. clears a score)", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 3 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(1);
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 2 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(0);
  });

  it("decrements when a fully-scored user toggles missed", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 3 },
      CATEGORIES,
    );
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 0 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(0);
  });

  it("counts multiple users per contestant", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 3 },
      CATEGORIES,
    );
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u2", contestantId: "2026-se", scoredCount: 3 },
      CATEGORIES,
    );
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u3", contestantId: "2026-se", scoredCount: 3 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(3);
  });

  it("tracks contestants independently", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 3 },
      CATEGORIES,
    );
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-ua", scoredCount: 3 },
      CATEGORIES,
    );
    expect(countsFromState(state, "2026-se")).toBe(1);
    expect(countsFromState(state, "2026-ua")).toBe(1);
  });

  it("idempotent: re-applying the same fully-scored event doesn't double-count", () => {
    let state = initialVotingProgressState();
    const evt = {
      type: "voting_progress" as const,
      userId: "u1",
      contestantId: "2026-se",
      scoredCount: 3,
    };
    state = nextVotingProgress(state, evt, CATEGORIES);
    state = nextVotingProgress(state, evt, CATEGORIES);
    state = nextVotingProgress(state, evt, CATEGORIES);
    expect(countsFromState(state, "2026-se")).toBe(1);
  });

  it("ignores unrelated event types", () => {
    let state = initialVotingProgressState();
    const next = nextVotingProgress(
      state,
      { type: "status_changed", status: "voting" } as never,
      CATEGORIES,
    );
    expect(next).toBe(state);
  });

  it("returns 0 for contestants never seen", () => {
    const state = initialVotingProgressState();
    expect(countsFromState(state, "unknown-id")).toBe(0);
  });

  it("seeds initial state from already-known fully-scored pairs", () => {
    // Simulates room-load hydration if/when the server starts including
    // aggregate fully-scored pairs in the room response.
    const state: VotingProgressState = new Map([
      ["2026-se", new Set(["u1", "u2"])],
      ["2026-ua", new Set(["u1"])],
    ]);
    expect(countsFromState(state, "2026-se")).toBe(2);
    expect(countsFromState(state, "2026-ua")).toBe(1);
  });

  it("guards against zero categoriesCount (no-op rather than mark fully-scored at 0/0)", () => {
    let state = initialVotingProgressState();
    state = nextVotingProgress(
      state,
      { type: "voting_progress", userId: "u1", contestantId: "2026-se", scoredCount: 0 },
      0,
    );
    expect(countsFromState(state, "2026-se")).toBe(0);
  });
});
