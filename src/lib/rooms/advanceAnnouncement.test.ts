import { describe, it, expect, vi } from "vitest";
import {
  advanceAnnouncement,
  type AdvanceAnnouncementDeps,
} from "@/lib/rooms/advanceAnnouncement";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";
const U3 = "30000000-0000-4000-8000-000000000003";
const U4 = "40000000-0000-4000-8000-000000000004";
const U5 = "50000000-0000-4000-8000-000000000005";

const announcingRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcement_order: [U1, U2],
  announcing_user_id: U1,
  current_announce_idx: 0,
  announce_skipped_user_ids: [],
  batch_reveal_mode: false,
  announcement_style: "full",
};

// 5-contestant fixture mirrors the year-9999 test setup. Each user has 5
// point-awarding results (ranks 1..5 → points 12, 10, 8, 7, 6).
function fiveResultsFor(userId: string) {
  const POINTS = [6, 7, 8, 10, 12]; // ascending — matches `ORDER BY rank DESC`
  const RANKS = [5, 4, 3, 2, 1];
  return POINTS.map((p, i) => ({
    contestant_id: `c-${userId.slice(-1)}-${i}`,
    points_awarded: p,
    rank: RANKS[i],
    announced: false,
  }));
}

// 10-contestant fixture for short-style tests. Points = 1,2,3,4,5,6,7,8,10,12
// sorted rank DESC (idx 0 = rank 10 = 1pt, idx 9 = rank 1 = 12pt).
function tenResultsFor(userId: string, announced = false) {
  const POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
  const RANKS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  return POINTS.map((p, i) => ({
    contestant_id: `c-${userId.slice(-1)}-${i}`,
    points_awarded: p,
    rank: RANKS[i],
    announced,
  }));
}

// Ten rows for "auto-batch already fired": 9 announced, 1 pending (rank-1).
function tenResultsAutoBatchFired(userId: string) {
  return tenResultsFor(userId, false).map((r, i) => ({
    ...r,
    announced: i < 9, // indices 0-8 are the 9 batch rows (1pt..10pt); idx 9 is 12pt
  }));
}

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  announcerResults?: Mock;
  /** Results returned for the second announcer SELECT (e.g. next user's queue in rotation). */
  nextAnnouncerResults?: Mock;
  resultsUpdate?: { error: { message: string } | null };
  resultsUpdateError?: { message: string } | null;
  roomUpdate?: Mock;
  allResults?: Mock;
  membershipSelects?: Array<{
    data: { last_seen_at: string | null } | null;
    error: { message: string } | null;
  }>;
  usersByIdSelect?: {
    data: Array<{ id: string; display_name: string }> | null;
    error: { message: string } | null;
  };
  pendingByUser?: Map<string, { contestant_id: string } | null>;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: announcingRoom, error: null };
  const announcerResults =
    s.announcerResults ?? { data: fiveResultsFor(U1), error: null };
  const nextAnnouncerResults = s.nextAnnouncerResults ?? announcerResults;
  const resultsUpdate = s.resultsUpdate ?? { error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };
  const allResults = s.allResults ?? { data: [], error: null };
  const pendingByUser = s.pendingByUser ?? new Map<string, { contestant_id: string } | null>();

  // Queue of results update responses, consumed FIFO.
  // First call = main reveal mark; subsequent calls = cascade applySingleSkip.
  // If resultsUpdateError is set, the second call (cascade) returns that error.
  const resultsUpdateQueue: Array<{ error: { message: string } | null }> =
    s.resultsUpdateError !== undefined
      ? [{ error: null }, { error: s.resultsUpdateError ?? null }]
      : [];

  // Counter for how many times the announcer-results SELECT has been called.
  // First call returns announcerResults (current user); subsequent calls return nextAnnouncerResults.
  let announcerSelectCount = 0;

  // Queue of membership selects, popped FIFO per probe.
  const membershipSelectQueue: Array<{
    data: { last_seen_at: string | null } | null;
    error: { message: string } | null;
  }> = s.membershipSelects
    ? [...s.membershipSelects]
    : [];

  const usersByIdSelect = s.usersByIdSelect ?? { data: [], error: null };

  const resultsUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];
  const roomUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];
  const broadcastCalls: Array<{ roomId: string; event: unknown }> = [];
  let membershipSelectsConsumed = 0;

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelect),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          const eqs: Array<{ col: string; val: unknown }> = [];
          roomUpdateCalls.push({ patch, eqs });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(roomUpdate),
            })),
          };
          return chain;
        }),
      };
    }
    if (table === "results") {
      return {
        select: vi.fn((cols: string) => {
          // Distinguish "announcer's queue" vs "leaderboard totals" by the
          // selected columns. The announcer query selects `rank`; the totals
          // query does not.
          const isAnnouncerQuery = cols.includes("rank");
          if (isAnnouncerQuery) {
            announcerSelectCount += 1;
            const resultForThisCall =
              announcerSelectCount === 1 ? announcerResults : nextAnnouncerResults;
            const chain = {
              eq: vi.fn(() => chain),
              gt: vi.fn(() => chain),
              order: vi.fn().mockResolvedValue(resultForThisCall),
            };
            return chain;
          }
          // Batch-reveal pending check:
          // .select("contestant_id").eq(...).eq("user_id", X).eq("announced", false).limit(1).maybeSingle()
          if (cols === "contestant_id") {
            let capturedUserId: string | null = null;
            const pendingChain: Record<string, unknown> = {};
            pendingChain.eq = vi.fn((col: string, val: unknown) => {
              if (col === "user_id") capturedUserId = val as string;
              return pendingChain;
            });
            pendingChain.limit = vi.fn(() => pendingChain);
            pendingChain.maybeSingle = vi.fn(() => {
              const found =
                capturedUserId !== null && pendingByUser.has(capturedUserId)
                  ? (pendingByUser.get(capturedUserId) ?? null)
                  : null;
              return Promise.resolve({ data: found, error: null });
            });
            return pendingChain;
          }
          const chain = {
            eq: vi.fn(() => Promise.resolve(allResults)),
          };
          return chain;
        }),
        update: vi.fn((patch: Record<string, unknown>) => {
          const eqs: Array<{ col: string; val: unknown }> = [];
          resultsUpdateCalls.push({ patch, eqs });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            in: vi.fn((_col: string, _vals: unknown[]) => {
              // .in() is a terminal filter on batch updates; resolve immediately.
              const response =
                resultsUpdateQueue.length > 0
                  ? resultsUpdateQueue.shift()!
                  : { ...resultsUpdate };
              return Promise.resolve({ data: null, ...response });
            }),
            then: (...args: unknown[]) => {
              const response =
                resultsUpdateQueue.length > 0
                  ? resultsUpdateQueue.shift()!
                  : { ...resultsUpdate };
              return Promise.resolve({ data: null, ...response }).then(
                ...(args as [(v: unknown) => unknown]),
              );
            },
          };
          return chain;
        }),
      };
    }
    if (table === "room_memberships") {
      // .select("last_seen_at").eq("room_id", ...).eq("user_id", ...).maybeSingle()
      const selectChain = {
        eq: vi.fn(() => selectChain),
        maybeSingle: vi.fn(() => {
          membershipSelectsConsumed += 1;
          const next =
            membershipSelectQueue.length > 0
              ? membershipSelectQueue.shift()!
              : { data: { last_seen_at: null }, error: null };
          return Promise.resolve(next);
        }),
      };
      return {
        select: vi.fn(() => selectChain),
      };
    }
    if (table === "users") {
      // Handle both .select("display_name").eq(...).maybeSingle() (single user)
      // and .select("id, display_name").in("id", [...]) (bulk).
      const usersChain: Record<string, unknown> = {};
      usersChain.eq = vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }));
      usersChain.in = vi.fn(() => Promise.resolve(usersByIdSelect));
      return {
        select: vi.fn(() => usersChain),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as AdvanceAnnouncementDeps["supabase"],
    resultsUpdateCalls,
    roomUpdateCalls,
    broadcastCalls,
    get membershipSelectsConsumed() { return membershipSelectsConsumed; },
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<AdvanceAnnouncementDeps> = {},
): AdvanceAnnouncementDeps {
  const defaultBroadcast = vi.fn((roomId: string, event: unknown) => {
    mock.broadcastCalls.push({ roomId, event });
    return Promise.resolve(undefined);
  });
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: defaultBroadcast,
    ...overrides,
  };
}

// ─── input validation ────────────────────────────────────────────────────────

describe("advanceAnnouncement — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const result = await advanceAnnouncement(
      { roomId: "no", userId: U1 },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it.each([undefined, null, ""])(
    "rejects missing/empty userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId },
        makeDeps(makeSupabaseMock()),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
    },
  );
});

// ─── room state guards ───────────────────────────────────────────────────────

describe("advanceAnnouncement — room state", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({ roomSelect: { data: null, error: null } });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it.each(["lobby", "voting", "scoring", "done"])(
    "returns 409 ROOM_NOT_ANNOUNCING when status is %s",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelect: { data: { ...announcingRoom, status }, error: null },
      });
      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: U1 },
        makeDeps(mock),
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_ANNOUNCING" },
      });
    },
  );

  it("returns 409 ROOM_NOT_ANNOUNCING when announcement_order is empty", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [],
          announcing_user_id: null,
        },
        error: null,
      },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_ANNOUNCING" },
    });
  });
});

// ─── authorization ───────────────────────────────────────────────────────────

describe("advanceAnnouncement — authorization", () => {
  it("returns 403 FORBIDDEN when caller is neither announcer nor owner", async () => {
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U2 }, // U1 is announcing, U2 is not owner
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
  });

  it("allows the room owner to advance even when they are not the announcer", async () => {
    const mock = makeSupabaseMock();
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
  });
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe("advanceAnnouncement — happy path", () => {
  it("reveals the lowest-points pick on the first call, bumps idx by 1", async () => {
    const mock = makeSupabaseMock({
      // After the UPDATE, the leaderboard query returns the now-announced row.
      allResults: {
        data: [
          {
            contestant_id: "c-1-0",
            points_awarded: 6,
            announced: true,
          },
        ],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );

    expect(result).toMatchObject({
      ok: true,
      contestantId: "c-1-0",
      points: 6,
      announcingUserId: U1,
      newTotal: 6,
      newRank: 1,
      nextAnnouncingUserId: U1,
      finished: false,
      cascadeExhausted: false,
      cascadedSkippedUserIds: [],
    });

    // results UPDATE marks announced=true on the right row.
    expect(mock.resultsUpdateCalls).toHaveLength(1);
    expect(mock.resultsUpdateCalls[0].patch).toEqual({ announced: true });
    expect(mock.resultsUpdateCalls[0].eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U1 },
      { col: "contestant_id", val: "c-1-0" },
    ]);

    // rooms UPDATE bumps idx with all the conditional guards.
    expect(mock.roomUpdateCalls).toHaveLength(1);
    expect(mock.roomUpdateCalls[0].patch).toEqual({
      announcing_user_id: U1,
      current_announce_idx: 1,
    });
    expect(mock.roomUpdateCalls[0].eqs).toEqual([
      { col: "id", val: VALID_ROOM_ID },
      { col: "status", val: "announcing" },
      { col: "announcing_user_id", val: U1 },
      { col: "current_announce_idx", val: 0 },
    ]);

    // Broadcasts: announce_next + score_update (no status_changed yet).
    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    expect(broadcastSpy).toHaveBeenNthCalledWith(1, VALID_ROOM_ID, {
      type: "announce_next",
      contestantId: "c-1-0",
      points: 6,
      announcingUserId: U1,
    });
    expect(broadcastSpy).toHaveBeenNthCalledWith(2, VALID_ROOM_ID, {
      type: "score_update",
      contestantId: "c-1-0",
      newTotal: 6,
      newRank: 1,
    });
  });

  it("rotates to the next announcer when the current one finishes their queue", async () => {
    // U1's queue has 5 entries; idx 4 is the last.
    // U2 is next — probe its membership (fresh).
    const NOW = new Date("2026-05-09T12:00:00.000Z");
    const freshTs = new Date(NOW.getTime() - 5_000).toISOString();
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...announcingRoom, current_announce_idx: 4 },
        error: null,
      },
      membershipSelects: [{ data: { last_seen_at: freshTs }, error: null }],
      usersByIdSelect: { data: [], error: null },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextAnnouncingUserId).toBe(U2);
    expect(result.finished).toBe(false);
    expect(result.cascadedSkippedUserIds).toEqual([]);
    expect(result.cascadeExhausted).toBe(false);

    // Room patch sets announcing_user_id = U2, idx = 0; status NOT changed.
    expect(mock.roomUpdateCalls[0].patch).toEqual({
      announcing_user_id: U2,
      current_announce_idx: 0,
    });
  });

  it("transitions to done when the last announcer reveals their last point", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcing_user_id: U2,
          current_announce_idx: 4,
        },
        error: null,
      },
      announcerResults: { data: fiveResultsFor(U2), error: null },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U2 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finished).toBe(true);
    expect(result.nextAnnouncingUserId).toBeNull();
    expect(result.cascadedSkippedUserIds).toEqual([]);
    expect(result.cascadeExhausted).toBe(false);

    // Room patch flips status to done.
    expect(mock.roomUpdateCalls[0].patch).toEqual({
      announcing_user_id: null,
      current_announce_idx: 0,
      status: "done",
    });
    // Broadcasts: announce_next + score_update + status_changed:done.
    expect(broadcastSpy).toHaveBeenCalledTimes(3);
    expect(broadcastSpy).toHaveBeenNthCalledWith(3, VALID_ROOM_ID, {
      type: "status_changed",
      status: "done",
    });
  });
});

// ─── race conditions / DB errors ─────────────────────────────────────────────

describe("advanceAnnouncement — race conditions", () => {
  it("returns 409 ANNOUNCE_RACED when the conditional room UPDATE matches 0 rows", async () => {
    const mock = makeSupabaseMock({
      roomUpdate: { data: null, error: null },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ANNOUNCE_RACED" },
    });
  });

  it("returns 409 ANNOUNCE_RACED when current_announce_idx is past the queue length", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...announcingRoom, current_announce_idx: 99 },
        error: null,
      },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ANNOUNCE_RACED" },
    });
  });
});

describe("advanceAnnouncement — DB errors", () => {
  it("returns 500 when the announcer-results SELECT errors", async () => {
    const mock = makeSupabaseMock({
      announcerResults: { data: null, error: { message: "db" } },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns 500 when the results UPDATE errors", async () => {
    const mock = makeSupabaseMock({
      resultsUpdate: { error: { message: "db" } },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns 500 when the room UPDATE errors", async () => {
    const mock = makeSupabaseMock({
      roomUpdate: { data: null, error: { message: "db" } },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

// ─── broadcast resilience ────────────────────────────────────────────────────

describe("advanceAnnouncement — broadcast resilience", () => {
  it("returns success even when both broadcasts throw", async () => {
    const mock = makeSupabaseMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broadcastSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("ch down"))
      .mockRejectedValueOnce(new Error("ch still down"));
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result.ok).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});

// ─── cascade-skip on rotation (SPEC §10.2.1) ────────────────────────────────

describe("cascade-skip on rotation (SPEC §10.2.1)", () => {
  // Shared "now" used across cascade tests.
  const NOW = new Date("2026-05-09T12:00:00.000Z");
  const staleTs = new Date(NOW.getTime() - 60_000).toISOString(); // 60 s ago → absent
  const freshTs = new Date(NOW.getTime() - 5_000).toISOString(); // 5 s ago → present

  it("Case 1: single skip on rotation — skips U2 (stale), lands on U3 (fresh)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2, U3],
          announcing_user_id: U1,
          current_announce_idx: 4, // last idx → triggers rotation
          announce_skipped_user_ids: [],
        },
        error: null,
      },
      membershipSelects: [
        { data: { last_seen_at: staleTs }, error: null }, // U2 → absent
        { data: { last_seen_at: freshTs }, error: null }, // U3 → present
      ],
      usersByIdSelect: {
        data: [{ id: U2, display_name: "Bob" }],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cascadedSkippedUserIds).toEqual([U2]);
    expect(result.cascadeExhausted).toBe(false);
    expect(result.nextAnnouncingUserId).toBe(U3);

    // Room patch includes announce_skipped_user_ids and announcing_user_id = U3.
    expect(mock.roomUpdateCalls[0].patch).toMatchObject({
      announcing_user_id: U3,
      announce_skipped_user_ids: [U2],
    });
    // No status patch.
    expect(mock.roomUpdateCalls[0].patch.status).toBeUndefined();

    // One announce_skip broadcast for U2, BEFORE announce_next / score_update.
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "announce_skip",
      userId: U2,
      displayName: "Bob",
    });
    const skipCallIdx = broadcastSpy.mock.calls.findIndex(
      (c) => (c[1] as { type: string }).type === "announce_skip",
    );
    const nextCallIdx = broadcastSpy.mock.calls.findIndex(
      (c) => (c[1] as { type: string }).type === "announce_next",
    );
    expect(skipCallIdx).toBeLessThan(nextCallIdx);
  });

  it("Case 2: cascade through 3 absent, lands on U5 (fresh)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2, U3, U4, U5],
          announcing_user_id: U1,
          current_announce_idx: 4, // last idx
          announce_skipped_user_ids: [],
        },
        error: null,
      },
      membershipSelects: [
        { data: { last_seen_at: staleTs }, error: null }, // U2 → absent
        { data: { last_seen_at: staleTs }, error: null }, // U3 → absent
        { data: { last_seen_at: staleTs }, error: null }, // U4 → absent
        { data: { last_seen_at: freshTs }, error: null }, // U5 → present
      ],
      usersByIdSelect: {
        data: [
          { id: U2, display_name: "Bob" },
          { id: U3, display_name: "Carol" },
          { id: U4, display_name: "Dave" },
        ],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cascadedSkippedUserIds).toEqual([U2, U3, U4]);
    expect(result.cascadeExhausted).toBe(false);
    expect(result.nextAnnouncingUserId).toBe(U5);

    expect(mock.roomUpdateCalls[0].patch).toMatchObject({
      announcing_user_id: U5,
      announce_skipped_user_ids: [U2, U3, U4],
    });

    // Three announce_skip broadcasts in order U2 → U3 → U4, all before announce_next.
    const skipCalls = broadcastSpy.mock.calls.filter(
      (c) => (c[1] as { type: string }).type === "announce_skip",
    );
    expect(skipCalls).toHaveLength(3);
    expect(skipCalls[0][1]).toEqual({ type: "announce_skip", userId: U2, displayName: "Bob" });
    expect(skipCalls[1][1]).toEqual({ type: "announce_skip", userId: U3, displayName: "Carol" });
    expect(skipCalls[2][1]).toEqual({ type: "announce_skip", userId: U4, displayName: "Dave" });

    const firstSkipIdx = broadcastSpy.mock.calls.findIndex(
      (c) => (c[1] as { type: string }).type === "announce_skip",
    );
    const nextCallIdx = broadcastSpy.mock.calls.findIndex(
      (c) => (c[1] as { type: string }).type === "announce_next",
    );
    expect(firstSkipIdx).toBeLessThan(nextCallIdx);
  });

  it("Case 3: cascade exhausts — all remaining are absent, show keeps going", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2, U3],
          announcing_user_id: U1,
          current_announce_idx: 4, // last idx
          announce_skipped_user_ids: [],
        },
        error: null,
      },
      membershipSelects: [
        { data: { last_seen_at: staleTs }, error: null }, // U2 → absent
        { data: { last_seen_at: staleTs }, error: null }, // U3 → absent
      ],
      usersByIdSelect: {
        data: [
          { id: U2, display_name: "Bob" },
          { id: U3, display_name: "Carol" },
        ],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cascadeExhausted).toBe(true);
    expect(result.cascadedSkippedUserIds).toEqual([U2, U3]);
    expect(result.nextAnnouncingUserId).toBeNull();

    // announcing_user_id=null; status NOT set to done (stays 'announcing').
    expect(mock.roomUpdateCalls[0].patch).toMatchObject({
      announcing_user_id: null,
      announce_skipped_user_ids: [U2, U3],
    });
    expect(mock.roomUpdateCalls[0].patch.status).toBeUndefined();

    // Two announce_skip broadcasts.
    const skipCalls = broadcastSpy.mock.calls.filter(
      (c) => (c[1] as { type: string }).type === "announce_skip",
    );
    expect(skipCalls).toHaveLength(2);
  });

  it("returns 500 + does not commit room UPDATE when applySingleSkip fails mid-cascade", async () => {
    const STALE = new Date(NOW.getTime() - 60_000).toISOString();
    // U2 absent, U3 absent — but the results UPDATE for U2 fails. The
    // cascade must stop, return 500, and NOT fire the room UPDATE
    // (no partial-state corruption).
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "announcing",
          owner_user_id: OWNER_ID,
          announcement_order: [U1, U2, U3],
          announcing_user_id: U1,
          current_announce_idx: 0,
          delegate_user_id: null,
          announce_skipped_user_ids: [],
        },
        error: null,
      },
      announcerResults: {
        data: [
          { contestant_id: "c1", points_awarded: 12, rank: 1, announced: false },
        ],
        error: null,
      },
      membershipSelects: [
        { data: { last_seen_at: STALE }, error: null }, // U2 absent
        { data: { last_seen_at: new Date(NOW.getTime() - 5_000).toISOString() }, error: null }, // U3 present → post-loop fires applySingleSkip for U2
      ],
      // The first applySingleSkip (for U2) hits a results UPDATE error.
      resultsUpdateError: { message: "boom" },
    });

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { now: () => NOW }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(result.status).toBe(500);

    // CRITICAL: the room UPDATE that would have set the
    // announce_skipped_user_ids array must NOT have been called. The
    // mock's roomUpdateCalls should be empty (or contain only the
    // initial room reads, no UPDATEs).
    const roomPatchUpdates = mock.roomUpdateCalls;
    expect(roomPatchUpdates).toHaveLength(0);

    // No announce_skip broadcasts (broadcasts only fire after commit).
    const skipBroadcasts = (mock as any).broadcastCalls.filter(
      (b: any) => b.event.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(0);
  });

  it("does NOT call applySingleSkip when cascade exhausts (preserves pending for batch reveal)", async () => {
    const STALE = new Date(NOW.getTime() - 60_000).toISOString();
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "announcing",
          owner_user_id: OWNER_ID,
          announcement_order: [U1, U2, U3],
          announcing_user_id: U1,
          current_announce_idx: 0,
          delegate_user_id: null,
          announce_skipped_user_ids: [],
        },
        error: null,
      },
      announcerResults: {
        data: [{ contestant_id: "c1", points_awarded: 12, rank: 1, announced: false }],
        error: null,
      },
      membershipSelects: [
        { data: { last_seen_at: STALE }, error: null }, // U2 absent
        { data: { last_seen_at: STALE }, error: null }, // U3 absent → exhausts
      ],
      usersByIdSelect: {
        data: [{ id: U2, display_name: "Bob" }, { id: U3, display_name: "Carol" }],
        error: null,
      },
    });

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { now: () => NOW }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cascadeExhausted).toBe(true);
    expect(result.cascadedSkippedUserIds).toEqual([U2, U3]);
    // CRITICAL: applySingleSkip is NOT called on exhaust path.
    expect(mock.resultsUpdateCalls).toHaveLength(1); // only the main reveal mark
    // The main reveal mark is for the current contestant, not a cascade skip.
    // resultsUpdateCalls[0] is the initial results UPDATE (announced=true for c1).
    // No cascade results updates should have been made.
    // The key check: resultsUpdateCalls should have exactly 1 entry (the main mark).

    const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
    expect(lastRoomUpdate?.patch.announcing_user_id).toBeNull();
    expect(lastRoomUpdate?.patch.announce_skipped_user_ids).toEqual([U2, U3]);
  });

  it("Case 4: golden path — no skip needed, U2 is fresh", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2],
          announcing_user_id: U1,
          current_announce_idx: 4, // last idx
          announce_skipped_user_ids: [],
        },
        error: null,
      },
      membershipSelects: [
        { data: { last_seen_at: freshTs }, error: null }, // U2 → present
      ],
      usersByIdSelect: { data: [], error: null },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cascadedSkippedUserIds).toEqual([]);
    expect(result.cascadeExhausted).toBe(false);
    expect(result.nextAnnouncingUserId).toBe(U2);

    // No announce_skipped_user_ids in patch (no cascade).
    expect(mock.roomUpdateCalls[0].patch).toMatchObject({
      announcing_user_id: U2,
    });
    expect(mock.roomUpdateCalls[0].patch.announce_skipped_user_ids).toBeUndefined();

    // Zero announce_skip broadcasts.
    const skipCalls = broadcastSpy.mock.calls.filter(
      (c) => (c[1] as { type: string }).type === "announce_skip",
    );
    expect(skipCalls).toHaveLength(0);
  });
});

// ─── batch-reveal mode (SPEC §10.2.1 'Finish the show') ──────────────────────

describe("batch-reveal mode (SPEC §10.2.1 'Finish the show')", () => {
  const NOW = new Date("2026-05-10T12:00:00.000Z");

  it("rotates to next user with unrevealed results when current finishes queue (no presence check)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "announcing",
          owner_user_id: OWNER_ID,
          announcement_order: [U1, U2, U3],
          announcing_user_id: U1,
          current_announce_idx: 0,
          delegate_user_id: null,
          announce_skipped_user_ids: [U1, U2, U3],
          batch_reveal_mode: true,
        },
        error: null,
      },
      announcerResults: {
        data: [{ contestant_id: "c1", points_awarded: 12, rank: 1, announced: false }],
        error: null,
      },
      // U2 has 1 unrevealed result; U3 query is not made (we stop on first match).
      pendingByUser: new Map([[U2, { contestant_id: "cX" }]]),
    });

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { now: () => NOW }),
    );

    expect(result.ok).toBe(true);
    const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
    expect(lastRoomUpdate?.patch.announcing_user_id).toBe(U2);
    // No membership_select calls — presence cascade skipped.
    expect(mock.membershipSelectsConsumed).toBe(0);
  });

  it("silently skips users with all-announced results (no announce_skip broadcast)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "announcing",
          owner_user_id: OWNER_ID,
          announcement_order: [U1, U2, U3],
          announcing_user_id: U1,
          current_announce_idx: 0,
          delegate_user_id: null,
          announce_skipped_user_ids: [U1, U2, U3],
          batch_reveal_mode: true,
        },
        error: null,
      },
      announcerResults: {
        data: [{ contestant_id: "c1", points_awarded: 12, rank: 1, announced: false }],
        error: null,
      },
      // U2 has no pending results (all announced); U3 has pending.
      pendingByUser: new Map<string, { contestant_id: string } | null>([
        [U2, null],
        [U3, { contestant_id: "cZ" }],
      ]),
    });

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { now: () => NOW }),
    );

    expect(result.ok).toBe(true);
    const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
    expect(lastRoomUpdate?.patch.announcing_user_id).toBe(U3);

    const skipBroadcasts = (mock as any).broadcastCalls.filter(
      (b: any) => b.event.type === "announce_skip",
    );
    expect(skipBroadcasts).toHaveLength(0);
  });

  it("flips status to 'done' and clears batch_reveal_mode when no more pending users", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "announcing",
          owner_user_id: OWNER_ID,
          announcement_order: [U1, U2],
          announcing_user_id: U1,
          current_announce_idx: 0,
          delegate_user_id: null,
          announce_skipped_user_ids: [U1, U2],
          batch_reveal_mode: true,
        },
        error: null,
      },
      announcerResults: {
        data: [{ contestant_id: "c1", points_awarded: 12, rank: 1, announced: false }],
        error: null,
      },
      // U2 has no pending results.
      pendingByUser: new Map<string, { contestant_id: string } | null>([[U2, null]]),
    });

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { now: () => NOW }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finished).toBe(true);

    const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
    expect(lastRoomUpdate?.patch.announcing_user_id).toBeNull();
    expect(lastRoomUpdate?.patch.status).toBe("done");
    expect(lastRoomUpdate?.patch.batch_reveal_mode).toBe(false);
  });
});

// ─── short-style (SPEC §10.2.2) ──────────────────────────────────────────────

describe("advanceAnnouncement — short-style (SPEC §10.2.2)", () => {
  const NOW = new Date("2026-05-11T19:00:00.000Z");
  const freshTs = new Date(NOW.getTime() - 5_000).toISOString();
  const staleTs = new Date(NOW.getTime() - 600_000).toISOString(); // 10 min ago

  it("rotation: current user reveals their 12-point row, next user's auto-batch fires (9 contestants)", async () => {
    // U1 is on idx 9 (rank-1 / 12pt); after their reveal, rotation lands on
    // present U2 → server fires U2's auto-batch (9 rows) and pre-sets idx to 9.
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_style: "short",
          current_announce_idx: 9,
        },
        error: null,
      },
      announcerResults: { data: tenResultsAutoBatchFired(U1), error: null },
      nextAnnouncerResults: { data: tenResultsFor(U2), error: null },
      membershipSelects: [{ data: { last_seen_at: freshTs }, error: null }],
      allResults: { data: [], error: null },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      contestantId: "c-1-9",
      points: 12,
      announcingUserId: U1,
      nextAnnouncingUserId: U2,
      cascadeExhausted: false,
      cascadedSkippedUserIds: [],
    });

    // results.update calls: 1) U1's rank-1 mark, 2) U2's batch mark (9 rows via .in()).
    expect(mock.resultsUpdateCalls).toHaveLength(2);
    expect(mock.resultsUpdateCalls[0].patch).toEqual({ announced: true });
    expect(mock.resultsUpdateCalls[0].eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U1 },
      { col: "contestant_id", val: "c-1-9" },
    ]);
    expect(mock.resultsUpdateCalls[1].patch).toEqual({ announced: true });
    expect(mock.resultsUpdateCalls[1].eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U2 },
    ]);

    // Room patch sets next announcer = U2 with idx = 9 (the 12-point row's index).
    expect(mock.roomUpdateCalls[0].patch).toMatchObject({
      announcing_user_id: U2,
      current_announce_idx: 9,
    });

    // Broadcasts: announce_next (U1's 12pt), score_update (12pt),
    // score_batch_revealed (U2, 9 contestants). In that order.
    const types = broadcastSpy.mock.calls.map(
      (c) => (c[1] as { type: string }).type,
    );
    expect(types).toEqual([
      "announce_next",
      "score_update",
      "score_batch_revealed",
    ]);

    const batchCall = broadcastSpy.mock.calls.find(
      (c) => (c[1] as { type: string }).type === "score_batch_revealed",
    );
    expect(batchCall).toBeDefined();
    const batchEvent = batchCall![1] as {
      type: "score_batch_revealed";
      announcingUserId: string;
      contestants: Array<{ contestantId: string }>;
    };
    expect(batchEvent.announcingUserId).toBe(U2);
    expect(batchEvent.contestants).toHaveLength(9);
  });

  it("rotation + cascade: skips absent user, auto-batches the present one", async () => {
    // U1 reveals their 12pt; rotation candidate U2 is absent (skipped);
    // U3 is present → fires U3's auto-batch.
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2, U3],
          announcement_style: "short",
          current_announce_idx: 9,
        },
        error: null,
      },
      announcerResults: { data: tenResultsAutoBatchFired(U1), error: null },
      nextAnnouncerResults: { data: tenResultsFor(U3), error: null },
      membershipSelects: [
        { data: { last_seen_at: staleTs }, error: null }, // U2 absent
        { data: { last_seen_at: freshTs }, error: null }, // U3 present
      ],
      usersByIdSelect: {
        data: [{ id: U2, display_name: "User Two" }],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      nextAnnouncingUserId: U3,
      cascadeExhausted: false,
      cascadedSkippedUserIds: [U2],
    });

    // results.update calls: 1) U1 rank-1 mark, 2) applySingleSkip for U2,
    // 3) U3's batch mark (9 rows).
    expect(mock.resultsUpdateCalls).toHaveLength(3);
    // The batch mark is on U3 (last call).
    expect(mock.resultsUpdateCalls[2].eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U3 },
    ]);

    // Broadcast order: announce_skip (U2) → announce_next (U1 12pt) → score_update → score_batch_revealed (U3).
    const types = broadcastSpy.mock.calls.map(
      (c) => (c[1] as { type: string }).type,
    );
    expect(types).toEqual([
      "announce_skip",
      "announce_next",
      "score_update",
      "score_batch_revealed",
    ]);
    const batchEvent = broadcastSpy.mock.calls.find(
      (c) => (c[1] as { type: string }).type === "score_batch_revealed",
    )![1] as {
      announcingUserId: string;
      contestants: Array<unknown>;
    };
    expect(batchEvent.announcingUserId).toBe(U3);
    expect(batchEvent.contestants).toHaveLength(9);
  });

  it("cascade exhausts: no auto-batch broadcast, cascadeExhausted: true", async () => {
    // U1 reveals their 12pt; rotation candidate U2 is absent; no one else.
    // Cascade exhausts → nextAnnouncingUserId is null, no batch broadcast.
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2],
          announcement_style: "short",
          current_announce_idx: 9,
        },
        error: null,
      },
      announcerResults: { data: tenResultsAutoBatchFired(U1), error: null },
      membershipSelects: [
        { data: { last_seen_at: staleTs }, error: null }, // U2 absent
      ],
      usersByIdSelect: {
        data: [{ id: U2, display_name: "User Two" }],
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      cascadeExhausted: true,
      nextAnnouncingUserId: null,
      cascadedSkippedUserIds: [U2],
    });

    // No score_batch_revealed broadcast.
    const types = broadcastSpy.mock.calls.map(
      (c) => (c[1] as { type: string }).type,
    );
    expect(types).not.toContain("score_batch_revealed");

    // SPEC §10.2.1 — cascade-exhaust does NOT silent-mark the absent user
    // (their results stay announced=false for batch reveal). Only 1
    // results.update should have fired: U1's rank-1 mark.
    expect(mock.resultsUpdateCalls).toHaveLength(1);
  });

  it("batch-reveal-mode + 10 pending rows: single tap fires auto-batch AND 12-point reveal", async () => {
    // U1 enters batch-reveal-mode fresh (no auto-batch ever fired for them).
    // Admin taps once → orchestrator marks U1's rank-1 (12pt) AND the
    // 9-row auto-batch, then probes for the next pending user.
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2],
          announcing_user_id: U1,
          current_announce_idx: 9, // last index = 12pt row
          batch_reveal_mode: true,
          announcement_style: "short",
        },
        error: null,
      },
      announcerResults: { data: tenResultsFor(U1), error: null }, // all 10 unannounced
      pendingByUser: new Map<string, { contestant_id: string } | null>([
        [U2, { contestant_id: "c-2-9" }], // U2 has pending
      ]),
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy, now: () => NOW }),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      points: 12,
      nextAnnouncingUserId: U2,
    });

    // results.update calls: 1) U1's rank-1 mark, 2) U1's batch mark (9 rows).
    expect(mock.resultsUpdateCalls).toHaveLength(2);
    expect(mock.resultsUpdateCalls[0].eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U1 },
      { col: "contestant_id", val: "c-1-9" }, // rank-1 = 12pt = idx 9
    ]);
    expect(mock.resultsUpdateCalls[1].eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U1 },
    ]);

    // Broadcasts: announce_next (U1 12pt) → score_update → score_batch_revealed (U1, 9 contestants).
    const types = broadcastSpy.mock.calls.map(
      (c) => (c[1] as { type: string }).type,
    );
    expect(types).toEqual([
      "announce_next",
      "score_update",
      "score_batch_revealed",
    ]);
    const batchEvent = broadcastSpy.mock.calls.find(
      (c) => (c[1] as { type: string }).type === "score_batch_revealed",
    )![1] as { announcingUserId: string; contestants: Array<unknown> };
    expect(batchEvent.announcingUserId).toBe(U1);
    expect(batchEvent.contestants).toHaveLength(9);
  });

  it("batch-reveal-mode + 1 pending row (auto-batch already fired): single tap reveals only 12pt", async () => {
    // U1's auto-batch fired earlier; now only rank-1 is pending.
    // Admin tap should NOT re-fire the batch — only mark rank-1.
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2],
          announcing_user_id: U1,
          current_announce_idx: 9,
          batch_reveal_mode: true,
          announcement_style: "short",
        },
        error: null,
      },
      announcerResults: { data: tenResultsAutoBatchFired(U1), error: null }, // 9 announced, only rank-1 pending
      pendingByUser: new Map<string, { contestant_id: string } | null>([
        [U2, { contestant_id: "c-2-9" }],
      ]),
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy, now: () => NOW }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toBe(12);

    // Only ONE results.update: the rank-1 mark. No batch mark fired.
    expect(mock.resultsUpdateCalls).toHaveLength(1);
    expect(mock.resultsUpdateCalls[0].eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U1 },
      { col: "contestant_id", val: "c-1-9" },
    ]);

    // Broadcasts: announce_next + score_update only. NO score_batch_revealed.
    const types = broadcastSpy.mock.calls.map(
      (c) => (c[1] as { type: string }).type,
    );
    expect(types).toEqual(["announce_next", "score_update"]);
    expect(types).not.toContain("score_batch_revealed");
  });

  it("full-style control: existing rotation behaviour unchanged, no score_batch_revealed", async () => {
    // Same setup as the existing "rotates to the next announcer" test —
    // but explicit assertion that no auto-batch fires under style='full'.
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_style: "full",
          current_announce_idx: 4,
        },
        error: null,
      },
      membershipSelects: [{ data: { last_seen_at: freshTs }, error: null }],
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);

    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextAnnouncingUserId).toBe(U2);

    // No batch broadcast under full style.
    const types = broadcastSpy.mock.calls.map(
      (c) => (c[1] as { type: string }).type,
    );
    expect(types).not.toContain("score_batch_revealed");

    // Room patch sets idx to 0 (full-style rotation default), not the
    // twelvePointIdx that short-style would set.
    expect(mock.roomUpdateCalls[0].patch).toMatchObject({
      announcing_user_id: U2,
      current_announce_idx: 0,
    });
  });
});
