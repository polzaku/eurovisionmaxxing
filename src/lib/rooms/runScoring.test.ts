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
  announcement_mode: "instant",
  voting_ends_at: null,
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
const U3 = "30000000-0000-4000-8000-000000000003";

const THREE_USER_MEMBERSHIPS = [
  {
    user_id: U1,
    joined_at: "2026-04-21T10:00:00Z",
    users: { display_name: "Alice" },
  },
  {
    user_id: U2,
    joined_at: "2026-04-21T10:01:00Z",
    users: { display_name: "Bob" },
  },
  {
    user_id: U3,
    joined_at: "2026-04-21T10:02:00Z",
    users: { display_name: "Charlie" },
  },
];

// Three-user votes: all three users vote for all three contestants so all are
// eligible announcers (all have points_awarded > 0 rows).
const THREE_USER_VOTES = [
  // U1 votes
  { id: "v-1", room_id: VALID_ROOM_ID, user_id: U1, contestant_id: "2026-al", scores: { vocals: 10 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  { id: "v-2", room_id: VALID_ROOM_ID, user_id: U1, contestant_id: "2026-be", scores: { vocals: 7 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  { id: "v-3", room_id: VALID_ROOM_ID, user_id: U1, contestant_id: "2026-cr", scores: { vocals: 4 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  // U2 votes
  { id: "v-4", room_id: VALID_ROOM_ID, user_id: U2, contestant_id: "2026-al", scores: { vocals: 9 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  { id: "v-5", room_id: VALID_ROOM_ID, user_id: U2, contestant_id: "2026-be", scores: { vocals: 6 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  { id: "v-6", room_id: VALID_ROOM_ID, user_id: U2, contestant_id: "2026-cr", scores: { vocals: 3 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  // U3 votes
  { id: "v-7", room_id: VALID_ROOM_ID, user_id: U3, contestant_id: "2026-al", scores: { vocals: 8 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  { id: "v-8", room_id: VALID_ROOM_ID, user_id: U3, contestant_id: "2026-be", scores: { vocals: 5 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
  { id: "v-9", room_id: VALID_ROOM_ID, user_id: U3, contestant_id: "2026-cr", scores: { vocals: 2 }, missed: false, hot_take: null, updated_at: "2026-04-21T10:30:00Z" },
];

const TWO_USER_MEMBERSHIPS = [
  {
    user_id: U1,
    joined_at: "2026-04-21T10:00:00Z",
    users: { display_name: "Alice" },
  },
  {
    user_id: U2,
    joined_at: "2026-04-21T10:01:00Z",
    users: { display_name: "Bob" },
  },
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
  resultsUpdateError?: { message: string } | null;
  awardsUpsertError?: { message: string } | null;
  roomToAnnouncing?: Result<unknown>;
  /**
   * Queue of per-user membership last_seen_at responses for the pre-cascade
   * presence check. Each entry is dequeued in order as presence queries arrive.
   * If the queue is empty, falls back to `{ data: { last_seen_at: FRESH_LAST_SEEN }, error: null }`.
   */
  membershipSelects?: Array<Result<{ last_seen_at: string | null } | null>>;
  /** Response for `users.select().in("id", [...])` — used for display-name bulk lookup. */
  usersByIdSelect?: Result<Array<{ id: string; display_name: string }>>;
  /**
   * Scripted response for the auto-batch results queue load:
   * results.select("contestant_id, points_awarded, rank, announced").eq().eq().gt().order()
   */
  autoBatchQueueSelect?: Result<unknown>;
  /** Error for the auto-batch results.update().eq().eq().in() call. */
  autoBatchMarkError?: { message: string } | null;
  /** Error for the auto-batch rooms.update({ current_announce_idx }) call. */
  autoBatchIdxUpdateError?: { message: string } | null;
  /**
   * Scripted response for the auto-batch leaderboard load:
   * results.select("contestant_id, points_awarded, announced").eq()
   */
  autoBatchLeaderboardSelect?: Result<unknown>;
}

// A "fresh" last_seen_at for presence checks — 5 seconds ago relative to FAKE_CASCADE_NOW.
const FAKE_CASCADE_NOW = new Date("2026-05-09T12:00:00.000Z");
const FRESH_LAST_SEEN = "2026-05-09T11:59:55.000Z"; // 5 s ago — present
const STALE_LAST_SEEN = "2026-05-09T11:59:00.000Z"; // 60 s ago — absent

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
  const resultsUpdateError = s.resultsUpdateError ?? null;
  const awardsUpsertError = s.awardsUpsertError ?? null;
  const roomToAnnouncing =
    s.roomToAnnouncing ?? { data: { id: VALID_ROOM_ID }, error: null };

  // Queue for per-user presence queries (pre-cascade). Dequeued in arrival order.
  const membershipSelectQueue: Array<Result<{ last_seen_at: string | null } | null>> =
    s.membershipSelects ? [...s.membershipSelects] : [];

  const usersByIdSelect =
    s.usersByIdSelect ?? { data: [], error: null };

  // Auto-batch scripted responses.
  const autoBatchQueueSelect =
    s.autoBatchQueueSelect ?? { data: [], error: null };
  const autoBatchMarkError = s.autoBatchMarkError ?? null;
  const autoBatchIdxUpdateError = s.autoBatchIdxUpdateError ?? null;
  const autoBatchLeaderboardSelect =
    s.autoBatchLeaderboardSelect ?? { data: [], error: null };

  // Spies.
  const voteUpdateCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const resultsUpsertCalls: Array<{
    rows: Record<string, unknown>[];
    options: Record<string, unknown>;
  }> = [];
  const resultsUpdateCalls: Array<{ userId: string }> = [];
  const resultsUpdateInCalls: Array<{ patch: Record<string, unknown>; contestantIds: unknown[] }> = [];
  const awardsUpsertCalls: Array<{
    rows: Record<string, unknown>[];
    options: Record<string, unknown>;
  }> = [];
  const roomUpdatePatches: Array<Record<string, unknown>> = [];
  const roomUpdateGuards: Array<Record<string, unknown>> = [];

  // Tracks which "rooms.update" call is happening:
  // 0 → voting→scoring, 1 → scoring→announcing, 2+ → auto-batch idx advance
  let roomUpdateCount = 0;

  // Tracks how many times results.select has been called (to distinguish
  // queue load from leaderboard load in the auto-batch block).
  let resultsSelectCount = 0;

  // Tracks how many times room_memberships has been queried with .order() vs .maybeSingle()
  // so we can distinguish the bulk load from the per-user presence probes.
  let membershipBulkDone = false;

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
          // callIndex 0 → voting→scoring, 1 → scoring→announcing,
          // 2+ → auto-batch current_announce_idx advance (returns plain data/error).
          if (callIndex === 0) {
            return {
              eq: vi.fn((_col: string, _val: unknown) => ({
                in: vi.fn((col: string, vals: unknown[]) => {
                  roomUpdateGuards.push({ [col]: vals });
                  return {
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue(roomToScoring),
                    })),
                  };
                }),
                eq: vi.fn((col: string, val: unknown) => {
                  roomUpdateGuards.push({ [col]: val });
                  return {
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue(roomToScoring),
                    })),
                  };
                }),
              })),
            };
          }
          if (callIndex === 1) {
            return {
              eq: vi.fn((_col: string, _val: unknown) => ({
                in: vi.fn((col: string, vals: unknown[]) => {
                  roomUpdateGuards.push({ [col]: vals });
                  return {
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue(roomToAnnouncing),
                    })),
                  };
                }),
                eq: vi.fn((col: string, val: unknown) => {
                  roomUpdateGuards.push({ [col]: val });
                  return {
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue(roomToAnnouncing),
                    })),
                  };
                }),
              })),
            };
          }
          // callIndex 2+: auto-batch idx advance — .eq().eq().eq().eq() (no select)
          const idxError = autoBatchIdxUpdateError;
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() =>
                    Promise.resolve({ data: null, error: idxError }),
                  ),
                })),
              })),
            })),
          };
        }),
      };
    }
    if (table === "room_memberships") {
      return {
        select: vi.fn(() => {
          // The first call is the bulk load (uses .order()); subsequent calls
          // are per-user presence probes (use .eq().eq().maybeSingle()).
          if (!membershipBulkDone) {
            membershipBulkDone = true;
            return {
              eq: vi.fn(() => ({
                order: vi.fn().mockResolvedValue(memberships),
              })),
            };
          }
          // Per-user presence probe: .eq(room_id, X).eq(user_id, Y).maybeSingle()
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockImplementation(() => {
                  if (membershipSelectQueue.length > 0) {
                    return Promise.resolve(membershipSelectQueue.shift()!);
                  }
                  // Default: user is present (always fresh relative to wall clock).
                  return Promise.resolve({
                    data: { last_seen_at: new Date().toISOString() },
                    error: null,
                  });
                }),
              })),
            })),
          };
        }),
      };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => Promise.resolve(usersByIdSelect)),
        })),
      };
    }
    if (table === "room_awards") {
      return {
        upsert: vi.fn(
          (rows: Record<string, unknown>[], options: Record<string, unknown>) => {
            awardsUpsertCalls.push({ rows, options });
            return Promise.resolve({ data: null, error: awardsUpsertError });
          },
        ),
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
        // results.select() is used by the auto-batch block for queue load and leaderboard load.
        // First call → queue load (.eq().eq().gt().order())
        // Second call → leaderboard load (.eq())
        select: vi.fn(() => {
          const callIdx = resultsSelectCount++;
          if (callIdx === 0) {
            // Queue load: .select(...).eq(room_id).eq(user_id).gt(...).order(...)
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gt: vi.fn(() => ({
                    order: vi.fn().mockResolvedValue(autoBatchQueueSelect),
                  })),
                })),
              })),
            };
          }
          // Leaderboard load: .select(...).eq(room_id)  → resolves directly
          return {
            eq: vi.fn().mockResolvedValue(autoBatchLeaderboardSelect),
          };
        }),
        // applySingleSkip calls results.update().eq(room_id).eq(user_id) — awaits the inner .eq() result.
        // auto-batch mark calls results.update().eq(room_id).eq(user_id).in(contestant_id, ids).
        // Solution: inner .eq() returns a Promise with an extra .in() property attached.
        update: vi.fn((patch: Record<string, unknown>) => ({
          eq: vi.fn((_col: string, _val: unknown) => ({
            eq: vi.fn((_col2: string, val2: unknown) => {
              // Record the call (for applySingleSkip tracking).
              resultsUpdateCalls.push({ userId: String(val2) });
              // Build a Promise that also exposes .in() for the auto-batch path.
              const p = Promise.resolve({ data: null, error: resultsUpdateError }) as Promise<{
                data: null;
                error: { message: string } | null;
              }> & { in: ReturnType<typeof vi.fn> };
              p.in = vi.fn((_col3: string, ids: unknown[]) => {
                resultsUpdateInCalls.push({ patch, contestantIds: ids });
                return Promise.resolve({ data: null, error: autoBatchMarkError });
              });
              return p;
            }),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as RunScoringDeps["supabase"],
    voteUpdateCalls,
    resultsUpsertCalls,
    resultsUpdateCalls,
    resultsUpdateInCalls,
    awardsUpsertCalls,
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

  it("accepts voting_ending status when voting_ends_at has elapsed and writes voting_ended_at", async () => {
    const FAKE_NOW = new Date("2026-04-27T10:00:10.000Z");
    const elapsedDeadline = "2026-04-27T10:00:05.000Z";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, status: "voting_ending", voting_ends_at: elapsedDeadline },
        error: null,
      },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { now: () => FAKE_NOW }),
    );
    expect(result.ok).toBe(true);
    // The first room.update is voting_ending → scoring; assert voting_ended_at is set.
    expect(mock.roomUpdatePatches[0]).toMatchObject({
      status: "scoring",
      voting_ended_at: FAKE_NOW.toISOString(),
    });
    // The status guard must allow voting_ending in the conditional `.in("status", ...)`.
    expect(mock.roomUpdateGuards[0]).toEqual({
      status: ["voting", "voting_ending", "scoring"],
    });
  });

  it("rejects voting_ending status when voting_ends_at is still in the future (409 VOTING_ENDING_NOT_ELAPSED)", async () => {
    const FAKE_NOW = new Date("2026-04-27T10:00:02.000Z");
    const futureDeadline = "2026-04-27T10:00:05.000Z";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, status: "voting_ending", voting_ends_at: futureDeadline },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy, now: () => FAKE_NOW }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "VOTING_ENDING_NOT_ELAPSED" },
    });
    expect(mock.roomUpdatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
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
      { status: "scoring", voting_ended_at: expect.any(String) },
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

    // Awards UPSERT — one call, options on the composite key.
    expect(mock.awardsUpsertCalls).toHaveLength(1);
    expect(mock.awardsUpsertCalls[0].options).toEqual({
      onConflict: "room_id,award_key",
    });
    // Personality awards landed (2 users → no Hive/Contrarian/Neighbours;
    // best_<cat>, biggest_stan, harshest_critic, dark_horse, enabler all OK).
    const awardKeys = (mock.awardsUpsertCalls[0].rows as Array<{
      award_key: string;
    }>).map((r) => r.award_key);
    expect(awardKeys).toContain("biggest_stan");
    expect(awardKeys).toContain("harshest_critic");
    expect(awardKeys).toContain("the_dark_horse");
  });

  it("returns 500 when room_awards upsert fails", async () => {
    const mock = makeSupabaseMock({
      awardsUpsertError: { message: "awards write failed" },
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
      { status: "scoring", voting_ended_at: expect.any(String) },
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

// ─── live-mode announcement_order init ───────────────────────────────────────

describe("runScoring — live-mode announcement order initialisation", () => {
  it("writes announcement_order, announcing_user_id, current_announce_idx in the announcing transition", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
    });
    // Identity shuffle for determinism.
    const identityShuffle = vi.fn(<T>(arr: T[]) => [...arr]) as <T>(
      arr: T[],
    ) => T[];
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { shuffle: identityShuffle }),
    );

    expect(result.ok).toBe(true);
    // Two room UPDATEs: scoring transition (status only), then announcing
    // (status + order + announcer + idx).
    expect(mock.roomUpdatePatches).toHaveLength(2);
    expect(mock.roomUpdatePatches[0]).toEqual({ status: "scoring", voting_ended_at: expect.any(String) });
    expect(mock.roomUpdatePatches[1]).toEqual({
      // TODO #10 slice B — live mode transitions to 'calibration'
      // (not 'announcing' directly) so members can peek at their picks
      // before the owner kicks off live reveals.
      status: "calibration",
      announcement_order: [U1, U2], // identity shuffle preserves member order
      announcing_user_id: U1,
      current_announce_idx: 0,
    });
    expect(identityShuffle).toHaveBeenCalledTimes(1);
  });

  it("respects custom shuffle order (e.g. reverse)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
    });
    const reverseShuffle = <T>(arr: T[]) => [...arr].reverse();
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { shuffle: reverseShuffle }),
    );
    expect(result.ok).toBe(true);
    expect(mock.roomUpdatePatches[1]).toEqual({
      status: "calibration",
      announcement_order: [U2, U1],
      announcing_user_id: U2,
      current_announce_idx: 0,
    });
  });

  it("excludes users with no points_awarded > 0 rows from announcement_order", async () => {
    // Reshape votes so U2 only scores 2026-cr (rank 3 → 8 pts) — but in a
    // 3-contestant room rank 3 still gets 8 pts. So both users have eligible
    // rows. To test exclusion we need a user whose ALL rows would be rank 11+.
    // Easier: simulate by passing memberships that include a 3rd user with no
    // votes — they'll have 0 results rows, hence 0 eligible.
    const U3 = "30000000-0000-4000-8000-000000000003";
    const memWithU3 = [
      ...TWO_USER_MEMBERSHIPS,
      {
        user_id: U3,
        joined_at: "2026-04-21T10:02:00Z",
        users: { display_name: "Charlie" },
      },
    ];
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
      memberships: { data: memWithU3, error: null },
    });
    const identityShuffle = <T>(arr: T[]) => [...arr];
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { shuffle: identityShuffle }),
    );
    expect(result.ok).toBe(true);
    // U3 had no votes → no results rows → not eligible.
    expect(mock.roomUpdatePatches[1]).toEqual({
      status: "calibration",
      announcement_order: [U1, U2],
      announcing_user_id: U1,
      current_announce_idx: 0,
    });
  });

  it("instant mode does NOT write announcement_order — status update only", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "instant" },
        error: null,
      },
    });
    const shuffleSpy = vi.fn(<T>(arr: T[]) => [...arr]) as <T>(
      arr: T[],
    ) => T[];
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { shuffle: shuffleSpy }),
    );
    expect(result.ok).toBe(true);
    expect(mock.roomUpdatePatches[1]).toEqual({ status: "announcing" });
    expect(shuffleSpy).not.toHaveBeenCalled();
  });

  it("zero eligible announcers → empty order, null announcer, status still flips to announcing", async () => {
    // No votes → no results → no eligible announcers.
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
      votesSelect: { data: [], error: null },
    });
    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    expect(mock.roomUpdatePatches[1]).toEqual({
      status: "calibration",
      announcement_order: [],
      announcing_user_id: null,
      current_announce_idx: 0,
    });
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
    expect(mock.roomUpdatePatches).toEqual([{ status: "scoring", voting_ended_at: expect.any(String) }]);
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
    expect(mock.roomUpdatePatches).toEqual([{ status: "scoring", voting_ended_at: expect.any(String) }]);
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

// ─── pre-cascade at scoring → announcing ─────────────────────────────────────

describe("runScoring — pre-cascade skips absent users at scoring→announcing", () => {
  /**
   * Case 1: First two users absent, third present.
   * Eligible order [U1, U2, U3] post-shuffle (identity).
   * Pre-cascade should skip U1 and U2, land on U3.
   */
  it("skips first 2 absent users and sets announcing_user_id to order[2]", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
      memberships: { data: THREE_USER_MEMBERSHIPS, error: null },
      votesSelect: { data: THREE_USER_VOTES, error: null },
      // U1 stale, U2 stale, U3 fresh
      membershipSelects: [
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
        { data: { last_seen_at: FRESH_LAST_SEEN }, error: null },
      ],
      usersByIdSelect: {
        data: [
          { id: U1, display_name: "Alice" },
          { id: U2, display_name: "Bob" },
        ],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
        shuffle: (arr) => [...arr], // identity — preserve membership order U1,U2,U3
        now: () => FAKE_CASCADE_NOW,
      }),
    );

    expect(result.ok).toBe(true);

    // Last rooms UPDATE must reflect the cascade result.
    const announcingPatch = mock.roomUpdatePatches[1];
    expect(announcingPatch).toMatchObject({
      status: "calibration",
      announcing_user_id: U3,
      announce_skipped_user_ids: [U1, U2],
      current_announce_idx: 0,
    });

    // applySingleSkip writes results.update for U1 and U2.
    expect(mock.resultsUpdateCalls.map((c) => c.userId)).toEqual([U1, U2]);

    // Two announce_skip broadcasts emitted AFTER room UPDATE, before status_changed.
    const skipBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(2);
    expect(skipBroadcasts[0][1]).toMatchObject({ type: "announce_skip", userId: U1 });
    expect(skipBroadcasts[1][1]).toMatchObject({ type: "announce_skip", userId: U2 });

    // status_changed:calibration broadcast fires (live mode lands on
    // calibration first, then the owner advances to announcing via
    // /api/rooms/{id}/start-announcing).
    const statusBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "status_changed",
    );
    expect(statusBroadcasts.some(([, e]) => e.status === "calibration")).toBe(true);
  });

  /**
   * Case 2: All users absent.
   * announcing_user_id must be null, status still 'announcing'.
   */
  it("sets announcing_user_id=null when all users are absent, status stays announcing", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
      memberships: { data: TWO_USER_MEMBERSHIPS, error: null },
      // both stale
      membershipSelects: [
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
      ],
      usersByIdSelect: {
        data: [
          { id: U1, display_name: "Alice" },
          { id: U2, display_name: "Bob" },
        ],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
        shuffle: (arr) => [...arr], // identity — U1, U2
        now: () => FAKE_CASCADE_NOW,
      }),
    );

    expect(result.ok).toBe(true);

    const announcingPatch = mock.roomUpdatePatches[1];
    expect(announcingPatch).toMatchObject({
      status: "calibration",
      announcing_user_id: null,
      announce_skipped_user_ids: [U1, U2],
      current_announce_idx: 0,
    });

    // Pre-cascade exhausts → applySingleSkip must NOT be called.
    // Points stay announced=false for the 'Finish the show' batch reveal.
    expect(mock.resultsUpdateCalls).toHaveLength(0);

    // Two announce_skip broadcasts — banners fire even on cascade-exhaust path.
    const skipBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(2);
    expect(skipBroadcasts[0][1]).toMatchObject({ type: "announce_skip", userId: U1, displayName: "Alice" });
    expect(skipBroadcasts[1][1]).toMatchObject({ type: "announce_skip", userId: U2, displayName: "Bob" });
  });

  /**
   * Case 3: First user present (golden path regression).
   * No skips should occur; announcing_user_id = U1, no announce_skipped_user_ids.
   */
  it("golden path: first user present — no skips, no announce_skipped_user_ids", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
      // U1 fresh
      membershipSelects: [
        { data: { last_seen_at: FRESH_LAST_SEEN }, error: null },
      ],
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
        shuffle: (arr) => [...arr], // identity — U1, U2
        now: () => FAKE_CASCADE_NOW,
      }),
    );

    expect(result.ok).toBe(true);

    const announcingPatch = mock.roomUpdatePatches[1];
    expect(announcingPatch).toMatchObject({
      status: "calibration",
      announcing_user_id: U1,
      current_announce_idx: 0,
    });
    // No skipped field in the patch.
    expect(announcingPatch).not.toHaveProperty("announce_skipped_user_ids");

    // No announce_skip broadcasts.
    const skipBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(0);

    // No results.update calls from applySingleSkip.
    expect(mock.resultsUpdateCalls).toHaveLength(0);
  });

  /**
   * Case 4: Pre-cascade exhausts (all absent) — applySingleSkip NOT called.
   * Covers SPEC §10.2.1 line 981: points stay announced=false for batch reveal.
   */
  it("does NOT call applySingleSkip when pre-cascade exhausts (preserves pending for batch reveal)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...defaultRoomRow, announcement_mode: "live" },
        error: null,
      },
      memberships: { data: TWO_USER_MEMBERSHIPS, error: null },
      membershipSelects: [
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
      ],
      usersByIdSelect: {
        data: [
          { id: U1, display_name: "Alice" },
          { id: U2, display_name: "Bob" },
        ],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
        shuffle: (arr) => [...arr],
        now: () => FAKE_CASCADE_NOW,
      }),
    );

    expect(result.ok).toBe(true);
    // CRITICAL: pre-cascade exhausts → no applySingleSkip calls.
    // Points stay announced=false for the 'Finish the show' batch reveal.
    expect(mock.resultsUpdateCalls).toHaveLength(0);

    const finalRoomUpdate = mock.roomUpdatePatches[1];
    expect(finalRoomUpdate?.announcing_user_id).toBeNull();
    expect(finalRoomUpdate?.status).toBe("calibration");
    expect(finalRoomUpdate?.announce_skipped_user_ids).toEqual([U1, U2]);

    // announce_skip broadcasts MUST fire even on cascade-exhaust path.
    // Banners inform guests "X isn't here" — separate from the batch reveal UX.
    const skipBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(2);
    expect(skipBroadcasts[0][1]).toMatchObject({ type: "announce_skip", userId: U1, displayName: "Alice" });
    expect(skipBroadcasts[1][1]).toMatchObject({ type: "announce_skip", userId: U2, displayName: "Bob" });
  });
});

// ─── short-style auto-batch (SPEC §10.2.2) ───────────────────────────────────

// Simulated 10-contestant results queue for U1, sorted rank DESC as the DB
// ORDER BY rank DESC would return them (rank 10 = idx 0, rank 1 = idx 9).
// Points use Eurovision's 1-2-3-4-5-6-7-8-10-12 schedule.
const TEN_ROW_QUEUE_DESC = [
  { contestant_id: "2026-no", points_awarded: 1, rank: 10, announced: false },
  { contestant_id: "2026-sw", points_awarded: 2, rank: 9, announced: false },
  { contestant_id: "2026-it", points_awarded: 3, rank: 8, announced: false },
  { contestant_id: "2026-de", points_awarded: 4, rank: 7, announced: false },
  { contestant_id: "2026-fr", points_awarded: 5, rank: 6, announced: false },
  { contestant_id: "2026-uk", points_awarded: 6, rank: 5, announced: false },
  { contestant_id: "2026-es", points_awarded: 7, rank: 4, announced: false },
  { contestant_id: "2026-pt", points_awarded: 8, rank: 3, announced: false },
  { contestant_id: "2026-be", points_awarded: 10, rank: 2, announced: false },
  { contestant_id: "2026-al", points_awarded: 12, rank: 1, announced: false },
];

// Post-batch leaderboard: all 10 rows with announced=true (simulates after mark).
const TEN_ROW_LEADERBOARD_ANNOUNCED = TEN_ROW_QUEUE_DESC.map((r) => ({
  contestant_id: r.contestant_id,
  points_awarded: r.points_awarded,
  announced: true,
}));

describe("runScoring — short-style auto-batch (SPEC §10.2.2)", () => {
  /**
   * Case A — Happy path: live + short, first announcer present.
   * Expects: 9 rows marked announced=true, current_announce_idx advanced to 9,
   * one score_batch_revealed broadcast with 9 contestants, fired BEFORE status_changed.
   */
  it("Case A — happy path: marks 9 rows, advances idx to 9, broadcasts score_batch_revealed before status_changed", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...defaultRoomRow,
          announcement_mode: "live",
          announcement_style: "short",
        },
        error: null,
      },
      memberships: { data: TWO_USER_MEMBERSHIPS, error: null },
      // U1 is present (first in identity-shuffle order).
      membershipSelects: [
        { data: { last_seen_at: FRESH_LAST_SEEN }, error: null },
      ],
      autoBatchQueueSelect: { data: TEN_ROW_QUEUE_DESC, error: null },
      autoBatchLeaderboardSelect: {
        data: TEN_ROW_LEADERBOARD_ANNOUNCED,
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
        shuffle: (arr) => [...arr], // identity — U1 first
        now: () => FAKE_CASCADE_NOW,
      }),
    );

    expect(result.ok).toBe(true);

    // The batch mark UPDATE must have fired with all 9 non-rank-1 contestant IDs.
    expect(mock.resultsUpdateInCalls).toHaveLength(1);
    const batchCall = mock.resultsUpdateInCalls[0];
    const expectedBatchIds = TEN_ROW_QUEUE_DESC.filter((r) => r.rank !== 1).map(
      (r) => r.contestant_id,
    );
    expect(batchCall.contestantIds).toEqual(expectedBatchIds);
    expect(batchCall.patch).toEqual({ announced: true });

    // The third rooms UPDATE must advance current_announce_idx to 9 (rank-1 row index).
    expect(mock.roomUpdatePatches).toHaveLength(3);
    expect(mock.roomUpdatePatches[2]).toEqual({ current_announce_idx: 9 });

    // Exactly one score_batch_revealed broadcast must have fired.
    const batchBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "score_batch_revealed",
    );
    expect(batchBroadcasts).toHaveLength(1);
    expect(batchBroadcasts[0][1]).toMatchObject({
      type: "score_batch_revealed",
      announcingUserId: U1,
    });
    expect(batchBroadcasts[0][1].contestants).toHaveLength(9);

    // Broadcast order: no announce_skip, then score_batch_revealed, then status_changed.
    const allBroadcastTypes = broadcastSpy.mock.calls.map(([, e]) => e.type);
    const batchIdx = allBroadcastTypes.indexOf("score_batch_revealed");
    const statusIdx = allBroadcastTypes.lastIndexOf("status_changed");
    expect(batchIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(batchIdx);

    // No announce_skip broadcasts (no pre-cascade skips).
    const skipBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(0);
  });

  /**
   * Case B — Cascade exhausts: all users absent under live + short.
   * No announcer is chosen; auto-batch must not fire.
   */
  it("Case B — cascade exhausts (all absent): no batch mark, no score_batch_revealed broadcast", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...defaultRoomRow,
          announcement_mode: "live",
          announcement_style: "short",
        },
        error: null,
      },
      memberships: { data: TWO_USER_MEMBERSHIPS, error: null },
      // Both U1 and U2 are absent.
      membershipSelects: [
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
        { data: { last_seen_at: STALE_LAST_SEEN }, error: null },
      ],
      usersByIdSelect: {
        data: [
          { id: U1, display_name: "Alice" },
          { id: U2, display_name: "Bob" },
        ],
        error: null,
      },
      autoBatchQueueSelect: { data: TEN_ROW_QUEUE_DESC, error: null },
      autoBatchLeaderboardSelect: {
        data: TEN_ROW_LEADERBOARD_ANNOUNCED,
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
        shuffle: (arr) => [...arr],
        now: () => FAKE_CASCADE_NOW,
      }),
    );

    expect(result.ok).toBe(true);

    // No batch mark: auto-batch block must not execute.
    expect(mock.resultsUpdateInCalls).toHaveLength(0);

    // Only 2 rooms UPDATEs: voting→scoring and scoring→announcing. No idx advance.
    expect(mock.roomUpdatePatches).toHaveLength(2);

    // No score_batch_revealed broadcast.
    const batchBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "score_batch_revealed",
    );
    expect(batchBroadcasts).toHaveLength(0);

    // status_changed:calibration still fires (live mode lands on
    // calibration first; owner advances to announcing manually).
    const statusBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "status_changed",
    );
    expect(statusBroadcasts.some(([, e]) => e.status === "calibration")).toBe(true);

    // announce_skip broadcasts still fire for absent users.
    const skipBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(2);
  });

  /**
   * Case C — Control: live + full style. Auto-batch must NOT fire even when
   * all other conditions are met.
   */
  it("Case C — live + full style: no batch mark, no score_batch_revealed broadcast", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...defaultRoomRow,
          announcement_mode: "live",
          announcement_style: "full",
        },
        error: null,
      },
      memberships: { data: TWO_USER_MEMBERSHIPS, error: null },
      membershipSelects: [
        { data: { last_seen_at: FRESH_LAST_SEEN }, error: null },
      ],
      autoBatchQueueSelect: { data: TEN_ROW_QUEUE_DESC, error: null },
      autoBatchLeaderboardSelect: {
        data: TEN_ROW_LEADERBOARD_ANNOUNCED,
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
        shuffle: (arr) => [...arr],
        now: () => FAKE_CASCADE_NOW,
      }),
    );

    expect(result.ok).toBe(true);

    // No batch mark.
    expect(mock.resultsUpdateInCalls).toHaveLength(0);

    // Only 2 rooms UPDATEs.
    expect(mock.roomUpdatePatches).toHaveLength(2);

    // No score_batch_revealed broadcast.
    const batchBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "score_batch_revealed",
    );
    expect(batchBroadcasts).toHaveLength(0);
  });

  /**
   * Case D — Instant mode ignores announcement_style.
   * Auto-batch must NOT fire regardless of announcement_style value.
   */
  it("Case D — instant mode with short style: no batch mark, no score_batch_revealed broadcast", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...defaultRoomRow,
          announcement_mode: "instant",
          announcement_style: "short",
        },
        error: null,
      },
      autoBatchQueueSelect: { data: TEN_ROW_QUEUE_DESC, error: null },
      autoBatchLeaderboardSelect: {
        data: TEN_ROW_LEADERBOARD_ANNOUNCED,
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, {
        broadcastRoomEvent: broadcastSpy,
      }),
    );

    expect(result.ok).toBe(true);

    // No batch mark.
    expect(mock.resultsUpdateInCalls).toHaveLength(0);

    // Only 2 rooms UPDATEs.
    expect(mock.roomUpdatePatches).toHaveLength(2);

    // No score_batch_revealed broadcast.
    const batchBroadcasts = broadcastSpy.mock.calls.filter(
      ([, e]) => e.type === "score_batch_revealed",
    );
    expect(batchBroadcasts).toHaveLength(0);
  });
});
