import { describe, it, expect, vi } from "vitest";
import {
  reshuffleOrder,
  type ReshuffleOrderDeps,
} from "@/lib/rooms/reshuffleOrder";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NON_OWNER_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";
const U3 = "30000000-0000-4000-8000-000000000003";

const announcingRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcement_order: [U1, U2, U3],
  announcing_user_id: U1,
  current_announce_idx: 0,
};

type Mock = { data: unknown; error: { message: string } | null };
type CountMock = {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
};

interface Scripted {
  roomSelect?: Mock;
  /**
   * Result of `from('results').select('user_id', { count: 'exact', head: true })
   *   .eq('room_id', X).eq('announced', true)`. The orchestrator only reads
   *   `count` + `error`.
   */
  announcedCount?: CountMock;
  roomUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: announcingRoom, error: null };
  const announcedCount =
    s.announcedCount ?? { data: null, error: null, count: 0 };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };

  const updatePatches: Record<string, unknown>[] = [];
  const updateFilters: Array<Array<[string, unknown]>> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelect),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = [];
          updatePatches.push(patch);
          updateFilters.push(filters);
          const chain: {
            eq: ReturnType<typeof vi.fn>;
            select: ReturnType<typeof vi.fn>;
          } = {
            eq: vi.fn((col: string, val: unknown) => {
              filters.push([col, val]);
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
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            // The orchestrator chains: .eq("room_id", id).eq("announced", true)
            eq: vi.fn().mockResolvedValue(announcedCount),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as ReshuffleOrderDeps["supabase"],
    updatePatches,
    updateFilters,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<ReshuffleOrderDeps> = {},
): ReshuffleOrderDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    // Deterministic shuffle for tests: reverse the input.
    shuffle: <T>(arr: T[]) => [...arr].reverse(),
    ...overrides,
  };
}

// ─── input validation ────────────────────────────────────────────────────────

describe("reshuffleOrder — input validation", () => {
  it("rejects non-UUID roomId", async () => {
    const result = await reshuffleOrder(
      { roomId: "no", userId: OWNER_ID },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("rejects non-UUID userId", async () => {
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: "no" },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });
});

// ─── auth + status guards ────────────────────────────────────────────────────

describe("reshuffleOrder — auth + status guards", () => {
  it("returns 404 ROOM_NOT_FOUND when the room is missing", async () => {
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(makeSupabaseMock({ roomSelect: { data: null, error: null } })),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 409 ROOM_NOT_ANNOUNCING when status !== 'announcing'", async () => {
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
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

  it("returns 403 FORBIDDEN when caller isn't the room owner", async () => {
    const mock = makeSupabaseMock();
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: NON_OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(mock.updatePatches).toEqual([]);
  });

  it("returns 409 ROOM_NOT_ANNOUNCING when announcement_order is empty", async () => {
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(
        makeSupabaseMock({
          roomSelect: {
            data: { ...announcingRoom, announcement_order: [] },
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
});

// ─── the load-bearing pre-reveal gate ────────────────────────────────────────

describe("reshuffleOrder — pre-reveal gate", () => {
  it("returns 409 ANNOUNCE_IN_PROGRESS when any results.announced=true row exists", async () => {
    const mock = makeSupabaseMock({
      announcedCount: { data: null, error: null, count: 1 },
    });
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ANNOUNCE_IN_PROGRESS" },
    });
    // Critical: gate enforced server-side, no UPDATE issued.
    expect(mock.updatePatches).toEqual([]);
  });

  it("returns 500 INTERNAL_ERROR when the count query errors", async () => {
    const mock = makeSupabaseMock({
      announcedCount: {
        data: null,
        error: { message: "db down" },
        count: null,
      },
    });
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe("reshuffleOrder — happy path", () => {
  it("shuffles the order, updates announcing_user_id + current_announce_idx, broadcasts", async () => {
    const mock = makeSupabaseMock();
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    // Default test shuffle reverses the array.
    expect(result.announcementOrder).toEqual([U3, U2, U1]);
    expect(result.announcingUserId).toBe(U3);

    // Persisted patch.
    expect(mock.updatePatches).toHaveLength(1);
    expect(mock.updatePatches[0]).toEqual({
      announcement_order: [U3, U2, U1],
      announcing_user_id: U3,
      current_announce_idx: 0,
    });

    // Conditional UPDATE filters for race protection.
    const filters = mock.updateFilters[0];
    expect(filters).toContainEqual(["id", VALID_ROOM_ID]);
    expect(filters).toContainEqual(["status", "announcing"]);
    expect(filters).toContainEqual(["current_announce_idx", 0]);

    // Broadcast.
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "announcement_order_reshuffled",
      announcementOrder: [U3, U2, U1],
      announcingUserId: U3,
    });
  });

  it("uses defaultShuffle when deps.shuffle isn't provided (smoke check)", async () => {
    // We can't assert exact output (Math.random) but can confirm:
    //  - the call succeeds,
    //  - the new order is a permutation of the original,
    //  - the new announcing_user_id is the head of that permutation.
    const mock = makeSupabaseMock();
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { shuffle: undefined }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect([...result.announcementOrder].sort()).toEqual([U1, U2, U3].sort());
    expect(result.announcementOrder[0]).toBe(result.announcingUserId);
  });

  it("returns 409 ANNOUNCE_IN_PROGRESS when the conditional UPDATE finds nothing (race)", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const mock = makeSupabaseMock({
      // Conditional UPDATE returns null data — represents another admin
      // racing the reshuffle (advanced / ended announce in the gap).
      roomUpdate: { data: null, error: null },
    });
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ANNOUNCE_IN_PROGRESS" },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("returns success even when broadcast throws (state already committed)", async () => {
    const broadcast = vi.fn().mockRejectedValue(new Error("realtime down"));
    const mock = makeSupabaseMock();
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );
    expect(result.ok).toBe(true);
  });

  it("returns 500 INTERNAL_ERROR when the room UPDATE errors", async () => {
    const mock = makeSupabaseMock({
      roomUpdate: { data: null, error: { message: "constraint" } },
    });
    const result = await reshuffleOrder(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
