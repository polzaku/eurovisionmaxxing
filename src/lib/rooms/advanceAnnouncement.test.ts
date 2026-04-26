import { describe, it, expect, vi } from "vitest";
import {
  advanceAnnouncement,
  type AdvanceAnnouncementDeps,
} from "@/lib/rooms/advanceAnnouncement";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";

const announcingRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcement_order: [U1, U2],
  announcing_user_id: U1,
  current_announce_idx: 0,
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
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: announcingRoom, error: null };
  const announcerResults =
    s.announcerResults ?? { data: fiveResultsFor(U1), error: null };
  const resultsUpdate = s.resultsUpdate ?? { error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };
  const allResults = s.allResults ?? { data: [], error: null };

  const resultsUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];
  const roomUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];

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
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as AdvanceAnnouncementDeps["supabase"],
    resultsUpdateCalls,
    roomUpdateCalls,
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
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...announcingRoom, current_announce_idx: 4 },
        error: null,
      },
    });
    const result = await advanceAnnouncement(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextAnnouncingUserId).toBe(U2);
    expect(result.finished).toBe(false);

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
