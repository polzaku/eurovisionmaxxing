import { describe, it, expect, vi } from "vitest";
import {
  runScoring,
  type RunScoringDeps,
} from "@/lib/rooms/runScoring";
import { ContestDataError } from "@/lib/contestants";
import type { Contestant, EventType, VotingCategory } from "@/types";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const ONE_CAT: VotingCategory[] = [{ name: "vocals", weight: 1 }];

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "voting",
  owner_user_id: VALID_USER_ID,
  year: 2026,
  event: "final",
  categories: ONE_CAT,
};

const THREE_CONTESTANTS: Contestant[] = [
  {
    id: "2026-al",
    country: "Albania",
    countryCode: "al",
    flagEmoji: "🇦🇱",
    artist: "A",
    song: "a",
    runningOrder: 1,
    event: "final",
    year: 2026,
  },
  {
    id: "2026-be",
    country: "Belgium",
    countryCode: "be",
    flagEmoji: "🇧🇪",
    artist: "B",
    song: "b",
    runningOrder: 2,
    event: "final",
    year: 2026,
  },
  {
    id: "2026-cr",
    country: "Croatia",
    countryCode: "cr",
    flagEmoji: "🇭🇷",
    artist: "C",
    song: "c",
    runningOrder: 3,
    event: "final",
    year: 2026,
  },
];

// u-1 scores 10/7/4 → ranks 1,2,3 → pts 12,10,8
// u-2 misses BE → filled with mean(10,6)=8 → ranks AL(10) BE(8) CR(6) → pts 12,10,8
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";

const TWO_USER_MEMBERSHIPS = [
  { user_id: U1, joined_at: "2026-04-21T10:00:00Z" },
  { user_id: U2, joined_at: "2026-04-21T10:01:00Z" },
];

const TWO_USER_VOTES = [
  {
    id: "v-1",
    room_id: VALID_ROOM_ID,
    user_id: U1,
    contestant_id: "2026-al",
    scores: { vocals: 10 },
    missed: false,
    hot_take: null,
    updated_at: "2026-04-21T10:30:00Z",
  },
  {
    id: "v-2",
    room_id: VALID_ROOM_ID,
    user_id: U1,
    contestant_id: "2026-be",
    scores: { vocals: 7 },
    missed: false,
    hot_take: null,
    updated_at: "2026-04-21T10:30:00Z",
  },
  {
    id: "v-3",
    room_id: VALID_ROOM_ID,
    user_id: U1,
    contestant_id: "2026-cr",
    scores: { vocals: 4 },
    missed: false,
    hot_take: null,
    updated_at: "2026-04-21T10:30:00Z",
  },
  {
    id: "v-4",
    room_id: VALID_ROOM_ID,
    user_id: U2,
    contestant_id: "2026-al",
    scores: { vocals: 10 },
    missed: false,
    hot_take: null,
    updated_at: "2026-04-21T10:30:00Z",
  },
  {
    id: "v-5",
    room_id: VALID_ROOM_ID,
    user_id: U2,
    contestant_id: "2026-be",
    scores: null,
    missed: true,
    hot_take: null,
    updated_at: "2026-04-21T10:30:00Z",
  },
  {
    id: "v-6",
    room_id: VALID_ROOM_ID,
    user_id: U2,
    contestant_id: "2026-cr",
    scores: { vocals: 6 },
    missed: false,
    hot_take: null,
    updated_at: "2026-04-21T10:30:00Z",
  },
];

type Result<T> = { data: T; error: { message: string } | null };

interface Scripted {
  roomSelect?: Result<unknown>;
  roomToScoring?: Result<unknown>;
  memberships?: Result<unknown>;
  votesSelect?: Result<unknown>;
  voteUpdateError?: { message: string } | null;
  resultsUpsertError?: { message: string } | null;
  roomToAnnouncing?: Result<unknown>;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect =
    s.roomSelect ?? { data: defaultRoomRow, error: null };
  const roomToScoring =
    s.roomToScoring ?? { data: { id: VALID_ROOM_ID }, error: null };
  const memberships =
    s.memberships ?? { data: TWO_USER_MEMBERSHIPS, error: null };
  const votesSelect =
    s.votesSelect ?? { data: TWO_USER_VOTES, error: null };
  const voteUpdateError = s.voteUpdateError ?? null;
  const resultsUpsertError = s.resultsUpsertError ?? null;
  const roomToAnnouncing =
    s.roomToAnnouncing ?? { data: { id: VALID_ROOM_ID }, error: null };

  // Spies.
  const voteUpdateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const resultsUpsertCalls: Array<{
    rows: Record<string, unknown>[];
    options: Record<string, unknown>;
  }> = [];
  const roomUpdatePatches: Array<Record<string, unknown>> = [];
  const roomUpdateGuards: Array<Record<string, unknown>> = [];

  // Tracks which "rooms.update" call is happening so we route to the right
  // scripted response: the first is voting→scoring, the second is scoring→announcing.
  let roomUpdateCount = 0;

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelect),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          roomUpdatePatches.push(patch);
          const callIndex = roomUpdateCount++;
          const scripted = callIndex === 0 ? roomToScoring : roomToAnnouncing;
          return {
            eq: vi.fn((_col: string, _val: unknown) => ({
              in: vi.fn((col: string, vals: unknown[]) => {
                roomUpdateGuards.push({ [col]: vals });
                return {
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue(scripted),
                  })),
                };
              }),
              eq: vi.fn((col: string, val: unknown) => {
                roomUpdateGuards.push({ [col]: val });
                return {
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue(scripted),
                  })),
                };
              }),
            })),
          };
        }),
      };
    }
    if (table === "room_memberships") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue(memberships),
          })),
        })),
      };
    }
    if (table === "votes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(votesSelect),
        })),
        update: vi.fn((patch: Record<string, unknown>) => ({
          eq: vi.fn((_col: string, val: unknown) => {
            voteUpdateCalls.push({ id: String(val), patch });
            return Promise.resolve({ data: null, error: voteUpdateError });
          }),
        })),
      };
    }
    if (table === "results") {
      return {
        upsert: vi.fn(
          (rows: Record<string, unknown>[], options: Record<string, unknown>) => {
            resultsUpsertCalls.push({ rows, options });
            return Promise.resolve({ data: null, error: resultsUpsertError });
          },
        ),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as RunScoringDeps["supabase"],
    voteUpdateCalls,
    resultsUpsertCalls,
    roomUpdatePatches,
    roomUpdateGuards,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<RunScoringDeps> = {},
): RunScoringDeps {
  return {
    supabase: mock.supabase,
    fetchContestants: vi.fn(
      async (_y: number, _e: EventType) => THREE_CONTESTANTS,
    ),
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── input validation ─────────────────────────────────────────────────────────

describe("runScoring — input validation", () => {
  it("rejects non-UUID roomId with 400 INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await runScoring(
      { roomId: "not-a-uuid", userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.roomUpdatePatches).toEqual([]);
  });

  it("rejects non-string roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await runScoring(
      { roomId: 42, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_ROOM_ID" },
    });
  });

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await runScoring(
        { roomId: VALID_ROOM_ID, userId },
        makeDeps(mock),
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.roomUpdatePatches).toEqual([]);
    },
  );
});

// ─── room load / ownership / status guard ────────────────────────────────────

describe("runScoring — room load & authorization", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelect: { data: null, error: null },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.roomUpdatePatches).toEqual([]);
  });

  it("returns 404 ROOM_NOT_FOUND when the SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelect: { data: null, error: { message: "boom" } },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 403 FORBIDDEN when caller is not the owner", async () => {
    const otherUserId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, owner_user_id: otherUserId },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(mock.roomUpdatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it.each(["lobby", "announcing", "done"])(
    "returns 409 ROOM_NOT_VOTING when current status is %s",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelect: { data: { ...defaultRoomRow, status }, error: null },
      });
      const broadcastSpy = vi.fn();
      const result = await runScoring(
        { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
        makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_VOTING" },
      });
      expect(mock.roomUpdatePatches).toEqual([]);
      expect(broadcastSpy).not.toHaveBeenCalled();
    },
  );
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe("runScoring — happy path", () => {
  it("transitions voting→scoring→announcing, writes filled vote, upserts results, returns leaderboard", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Two status updates in order.
    expect(mock.roomUpdatePatches).toEqual([
      { status: "scoring" },
      { status: "announcing" },
    ]);

    // Two broadcasts, in order.
    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    expect(broadcastSpy).toHaveBeenNthCalledWith(1, VALID_ROOM_ID, {
      type: "status_changed",
      status: "scoring",
    });
    expect(broadcastSpy).toHaveBeenNthCalledWith(2, VALID_ROOM_ID, {
      type: "status_changed",
      status: "announcing",
    });

    // One vote UPDATE (the single missed vote: v-5 for U2/BE).
    expect(mock.voteUpdateCalls).toHaveLength(1);
    expect(mock.voteUpdateCalls[0]).toEqual({
      id: "v-5",
      patch: { scores: { vocals: 8 } }, // round(mean(10,6)) = 8
    });

    // Results upsert: exactly one call with 6 rows (2 users × 3 contestants).
    expect(mock.resultsUpsertCalls).toHaveLength(1);
    const upsertCall = mock.resultsUpsertCalls[0];
    expect(upsertCall.rows).toHaveLength(6);
    expect(upsertCall.options).toEqual({
      onConflict: "room_id,user_id,contestant_id",
    });

    // Spot-check U1's AL row (weighted 10, rank 1, 12 pts).
    const u1al = upsertCall.rows.find(
      (r) => r.user_id === U1 && r.contestant_id === "2026-al",
    );
    expect(u1al).toMatchObject({
      room_id: VALID_ROOM_ID,
      weighted_score: 10,
      rank: 1,
      points_awarded: 12,
    });

    // U2's BE row uses filled 8 → rank 2 → 10 pts.
    const u2be = upsertCall.rows.find(
      (r) => r.user_id === U2 && r.contestant_id === "2026-be",
    );
    expect(u2be).toMatchObject({
      room_id: VALID_ROOM_ID,
      weighted_score: 8,
      rank: 2,
      points_awarded: 10,
    });

    // Leaderboard: AL=12+12=24, BE=10+10=20, CR=8+8=16.
    expect(result.leaderboard).toEqual([
      { contestantId: "2026-al", totalPoints: 24 },
      { contestantId: "2026-be", totalPoints: 20 },
      { contestantId: "2026-cr", totalPoints: 16 },
    ]);
  });

  it("accepts incoming status=scoring (retry idempotency)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: { data: { ...defaultRoomRow, status: "scoring" }, error: null },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    expect(mock.roomUpdatePatches).toEqual([
      { status: "scoring" },
      { status: "announcing" },
    ]);
  });

  it("skips vote UPDATEs when no votes are missed", async () => {
    const allFilledVotes = TWO_USER_VOTES.map((v) =>
      v.missed ? { ...v, scores: { vocals: 5 }, missed: false } : v,
    );
    const mock = makeSupabaseMock({
      votesSelect: { data: allFilledVotes, error: null },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    expect(mock.voteUpdateCalls).toEqual([]);
  });

  it("skips results.upsert when there are no results (empty userIds)", async () => {
    const mock = makeSupabaseMock({
      memberships: { data: [], error: null },
      votesSelect: { data: [], error: null },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.resultsUpsertCalls).toEqual([]);
    // Leaderboard still includes every contestant with 0 points.
    expect(result.leaderboard).toEqual([
      { contestantId: "2026-al", totalPoints: 0 },
      { contestantId: "2026-be", totalPoints: 0 },
      { contestantId: "2026-cr", totalPoints: 0 },
    ]);
  });
});

// ─── error paths ─────────────────────────────────────────────────────────────

describe("runScoring — DB error paths", () => {
  it("returns 500 when the voting→scoring UPDATE fails; no broadcasts", async () => {
    const mock = makeSupabaseMock({
      roomToScoring: { data: null, error: { message: "boom" } },
    });
    const broadcastSpy = vi.fn();
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when memberships query errors (after scoring transition)", async () => {
    const mock = makeSupabaseMock({
      memberships: { data: null, error: { message: "boom" } },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns 500 when votes query errors", async () => {
    const mock = makeSupabaseMock({
      votesSelect: { data: null, error: { message: "boom" } },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns 500 when a vote UPDATE fails; does not upsert results or transition", async () => {
    const mock = makeSupabaseMock({
      voteUpdateError: { message: "vote upd failed" },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(mock.resultsUpsertCalls).toEqual([]);
    // Only the first room UPDATE happened, not the announcing one.
    expect(mock.roomUpdatePatches).toEqual([{ status: "scoring" }]);
  });

  it("returns 500 when results.upsert fails; does not transition to announcing", async () => {
    const mock = makeSupabaseMock({
      resultsUpsertError: { message: "upsert failed" },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(mock.roomUpdatePatches).toEqual([{ status: "scoring" }]);
  });

  it("returns 500 when scoring→announcing UPDATE fails (raced state)", async () => {
    const mock = makeSupabaseMock({
      roomToAnnouncing: { data: null, error: null },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns 500 when fetchContestants throws ContestDataError", async () => {
    const mock = makeSupabaseMock();
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        fetchContestants: vi.fn(async () => {
          throw new ContestDataError("upstream down");
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("re-throws non-ContestDataError from fetchContestants (unexpected upstream)", async () => {
    const mock = makeSupabaseMock();
    await expect(
      runScoring(
        { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
        makeDeps(mock, {
          fetchContestants: vi.fn(async () => {
            throw new Error("kernel panic");
          }),
        }),
      ),
    ).rejects.toThrow("kernel panic");
  });
});

// ─── broadcast semantics ─────────────────────────────────────────────────────

describe("runScoring — broadcast failures are non-fatal", () => {
  it("returns success even if both broadcasts throw", async () => {
    const mock = makeSupabaseMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broadcastSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("channel down"))
      .mockRejectedValueOnce(new Error("channel still down"));

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );

    expect(result.ok).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});
