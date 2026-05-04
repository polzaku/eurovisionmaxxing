import { describe, it, expect, vi } from "vitest";
import {
  restoreSkipped,
  type RestoreSkippedDeps,
} from "@/lib/rooms/restoreSkipped";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NON_OWNER_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";
const U3 = "30000000-0000-4000-8000-000000000003";
const SKIPPED = "44444444-0000-4000-8000-000000000044";

const announcingRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcement_order: [U1, U2, U3],
  announcing_user_id: U2,
  announce_skipped_user_ids: [SKIPPED],
};

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  userSelect?: Mock;
  resultsUpdate?: { error: { message: string } | null };
  roomUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: announcingRoom, error: null };
  const userSelect =
    s.userSelect ?? { data: { display_name: "Carol" }, error: null };
  const resultsUpdate = s.resultsUpdate ?? { error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };

  const resultsUpdateCalls: Array<{
    patch: Record<string, unknown>;
    filters: Array<[string, unknown, unknown?]>;
  }> = [];
  const roomUpdatePatches: Array<Record<string, unknown>> = [];
  const roomUpdateFilters: Array<Array<[string, unknown, unknown?]>> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelect),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown, unknown?]> = [];
          roomUpdatePatches.push(patch);
          roomUpdateFilters.push(filters);
          // Chain supports .eq + .contains + .select(...).maybeSingle()
          const chain: {
            eq: ReturnType<typeof vi.fn>;
            contains: ReturnType<typeof vi.fn>;
            select: ReturnType<typeof vi.fn>;
          } = {
            eq: vi.fn((col: string, val: unknown) => {
              filters.push([col, val]);
              return chain;
            }),
            contains: vi.fn((col: string, val: unknown) => {
              filters.push([col, val, "contains"]);
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
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(userSelect),
          })),
        })),
      };
    }
    if (table === "results") {
      return {
        update: vi.fn((patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown, unknown?]> = [];
          resultsUpdateCalls.push({ patch, filters });
          const chain: {
            eq: ReturnType<typeof vi.fn>;
            gt: ReturnType<typeof vi.fn>;
            then: (
              onFulfilled: (v: { data: null; error: unknown }) => unknown,
            ) => Promise<unknown>;
          } = {
            eq: vi.fn((col: string, val: unknown) => {
              filters.push([col, val]);
              return chain;
            }),
            gt: vi.fn((col: string, val: unknown) => {
              filters.push([col, val, "gt"]);
              return chain;
            }),
            then: (...args) =>
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
    supabase: { from } as unknown as RestoreSkippedDeps["supabase"],
    resultsUpdateCalls,
    roomUpdatePatches,
    roomUpdateFilters,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<RestoreSkippedDeps> = {},
): RestoreSkippedDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── input validation ────────────────────────────────────────────────────────

describe("restoreSkipped — input validation", () => {
  it("rejects non-UUID roomId", async () => {
    const result = await restoreSkipped(
      { roomId: "no", userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("rejects non-UUID userId", async () => {
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: "no", restoreUserId: SKIPPED },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("rejects non-UUID restoreUserId", async () => {
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: "no" },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "restoreUserId" },
    });
  });
});

// ─── auth + status guards ────────────────────────────────────────────────────

describe("restoreSkipped — auth + status guards", () => {
  it("returns 404 ROOM_NOT_FOUND when the room is missing", async () => {
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(makeSupabaseMock({ roomSelect: { data: null, error: null } })),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 409 ROOM_NOT_ANNOUNCING when status !== 'announcing'", async () => {
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(
        makeSupabaseMock({
          roomSelect: {
            data: { ...announcingRoom, status: "voting" },
            error: null,
          },
        }),
      ),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_ANNOUNCING" },
    });
  });

  it("returns 409 when announcement_order is empty", async () => {
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(
        makeSupabaseMock({
          roomSelect: {
            data: {
              ...announcingRoom,
              announcement_order: [],
              announcing_user_id: null,
            },
            error: null,
          },
        }),
      ),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_ANNOUNCING" },
    });
  });

  it("returns 403 FORBIDDEN when caller isn't the room owner", async () => {
    const mock = makeSupabaseMock();
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: NON_OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    // Critical: no UPDATEs issued when auth fails.
    expect(mock.resultsUpdateCalls).toEqual([]);
    expect(mock.roomUpdatePatches).toEqual([]);
  });

  it("returns 409 USER_NOT_SKIPPED when restoreUserId isn't in the skipped list", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...announcingRoom, announce_skipped_user_ids: [] },
        error: null,
      },
    });
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "USER_NOT_SKIPPED", field: "restoreUserId" },
    });
    expect(mock.resultsUpdateCalls).toEqual([]);
    expect(mock.roomUpdatePatches).toEqual([]);
  });
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe("restoreSkipped — happy path", () => {
  it("un-marks results, splices into order at currentIdx+1, removes from skipped list, broadcasts", async () => {
    const mock = makeSupabaseMock();
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    // 1. Results UPDATE — set announced=false on this user's points-bearing rows.
    expect(mock.resultsUpdateCalls).toHaveLength(1);
    const [resCall] = mock.resultsUpdateCalls;
    expect(resCall.patch).toEqual({ announced: false });
    expect(resCall.filters).toContainEqual(["room_id", VALID_ROOM_ID]);
    expect(resCall.filters).toContainEqual(["user_id", SKIPPED]);
    expect(resCall.filters).toContainEqual(["points_awarded", 0, "gt"]);

    // 2. Room UPDATE — order grows, skipped list shrinks.
    expect(mock.roomUpdatePatches).toHaveLength(1);
    const patch = mock.roomUpdatePatches[0];
    // U2 is announcing (idx 1 of [U1, U2, U3]); restored user goes to idx 2.
    expect(patch.announcement_order).toEqual([U1, U2, SKIPPED, U3]);
    expect(patch.announce_skipped_user_ids).toEqual([]);

    // 3. Conditional UPDATE filters protect against races.
    const filters = mock.roomUpdateFilters[0];
    expect(filters).toContainEqual(["id", VALID_ROOM_ID]);
    expect(filters).toContainEqual(["status", "announcing"]);
    expect(filters).toContainEqual([
      "announce_skipped_user_ids",
      [SKIPPED],
      "contains",
    ]);

    // 4. Broadcast.
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "announce_skip_restored",
      userId: SKIPPED,
      displayName: "Carol",
    });

    // 5. Return payload.
    expect(result.restoredUserId).toBe(SKIPPED);
    expect(result.restoredDisplayName).toBe("Carol");
    expect(result.announcementOrder).toEqual([U1, U2, SKIPPED, U3]);
    expect(result.announceSkippedUserIds).toEqual([]);
  });

  it("preserves other users in the skipped list when only one is restored", async () => {
    const OTHER_SKIPPED = "55555555-0000-4000-8000-000000000055";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announce_skipped_user_ids: [SKIPPED, OTHER_SKIPPED],
        },
        error: null,
      },
    });
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(mock.roomUpdatePatches[0].announce_skipped_user_ids).toEqual([
      OTHER_SKIPPED,
    ]);
    expect(result.announceSkippedUserIds).toEqual([OTHER_SKIPPED]);
  });

  it("inserts at the end when announcing_user_id is somehow not in announcement_order (defensive)", async () => {
    // Not a normal state — but the orchestrator's `indexOf` returns -1,
    // and the spec doesn't tell us what to do. Defensive: append to the
    // end so the user gets a turn last rather than crashing.
    const ORPHAN = "66666666-0000-4000-8000-000000000066";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2, U3],
          announcing_user_id: ORPHAN,
        },
        error: null,
      },
    });
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    expect(mock.roomUpdatePatches[0].announcement_order).toEqual([
      U1,
      U2,
      U3,
      SKIPPED,
    ]);
  });

  it("does NOT broadcast when the conditional UPDATE finds nothing (race lost)", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const mock = makeSupabaseMock({
      // Conditional UPDATE returns null data — represents another admin
      // racing the restore (already restored / skipped list shifted).
      roomUpdate: { data: null, error: null },
    });
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "USER_NOT_SKIPPED" },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("returns success even when broadcast throws (state already committed)", async () => {
    const broadcast = vi.fn().mockRejectedValue(new Error("realtime down"));
    const mock = makeSupabaseMock();
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );
    expect(result.ok).toBe(true);
  });

  it("returns 500 INTERNAL_ERROR when results UPDATE errors", async () => {
    const mock = makeSupabaseMock({
      resultsUpdate: { error: { message: "db down" } },
    });
    const result = await restoreSkipped(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    // Critical: no room UPDATE issued when results UPDATE fails.
    expect(mock.roomUpdatePatches).toEqual([]);
  });
});
