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

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  announcerResults?: Mock;
  resultsUpdate?: { error: { message: string } | null };
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
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: announcingRoom, error: null };
  const announcerResults =
    s.announcerResults ?? { data: fiveResultsFor(U1), error: null };
  const resultsUpdate = s.resultsUpdate ?? { error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };
  const allResults = s.allResults ?? { data: [], error: null };

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
            const chain = {
              eq: vi.fn(() => chain),
              gt: vi.fn(() => chain),
              order: vi.fn().mockResolvedValue(announcerResults),
            };
            return chain;
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
            then: (...args: unknown[]) =>
              Promise.resolve({ data: null, ...resultsUpdate }).then(
                ...(args as [(v: unknown) => unknown]),
              ),
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
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<AdvanceAnnouncementDeps> = {},
): AdvanceAnnouncementDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
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
