import { describe, it, expect, vi } from "vitest";
import {
  deleteHotTake,
  type DeleteHotTakeDeps,
} from "@/lib/votes/deleteHotTake";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TARGET_USER_ID = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
const NON_ADMIN_USER_ID = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
const VALID_CONTESTANT_ID = "2026-ua";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  owner_user_id: OWNER_USER_ID,
};

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  voteUpdateResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const voteUpdateResult =
    opts.voteUpdateResult ??
    {
      data: { user_id: TARGET_USER_ID },
      error: null,
    };

  // Capture the UPDATE payload + any chained .eq() filters so tests
  // can assert what we wrote and what we filtered on.
  const updatePayloads: Array<Record<string, unknown>> = [];
  const updateFilters: Array<Array<[string, unknown]>> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
          })),
        })),
      };
    }
    if (table === "votes") {
      return {
        update: vi.fn((payload: Record<string, unknown>) => {
          updatePayloads.push(payload);
          const filterChain: Array<[string, unknown]> = [];
          updateFilters.push(filterChain);
          // Each .eq returns the same chain so callers can keep filtering.
          // The terminal chain is `.not(...).select(...).maybeSingle()`.
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              filterChain.push([col, val]);
              return chain;
            }),
            not: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue(voteUpdateResult),
              })),
            })),
          };
          return chain;
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as DeleteHotTakeDeps["supabase"],
    updatePayloads,
    updateFilters,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<DeleteHotTakeDeps> = {},
): DeleteHotTakeDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("deleteHotTake — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await deleteHotTake(
      {
        roomId: "not-a-uuid",
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("rejects non-UUID userId with INVALID_USER_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: "nope",
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("rejects non-UUID targetUserId with INVALID_USER_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: "nope",
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "targetUserId" },
    });
  });

  it("rejects malformed contestantId with INVALID_CONTESTANT_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: "ua",
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_CONTESTANT_ID", field: "contestantId" },
    });
  });
});

describe("deleteHotTake — authorization", () => {
  it("returns 404 when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 403 when the caller is not the room owner", async () => {
    const mock = makeSupabaseMock();
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: NON_ADMIN_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    // Critical: no UPDATE issued when auth fails.
    expect(mock.updatePayloads).toEqual([]);
  });
});

describe("deleteHotTake — happy path + idempotency", () => {
  it("clears hot_take + edited_at and stamps deletion metadata when a row is updated", async () => {
    const mock = makeSupabaseMock();
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({ ok: true, deleted: true });

    expect(mock.updatePayloads).toHaveLength(1);
    const payload = mock.updatePayloads[0];
    expect(payload).toMatchObject({
      hot_take: null,
      hot_take_edited_at: null,
      hot_take_deleted_by_user_id: OWNER_USER_ID,
    });
    // Timestamp is now() — assert it parsed as a real ISO string.
    expect(typeof payload.hot_take_deleted_at).toBe("string");
    expect(
      Number.isFinite(Date.parse(payload.hot_take_deleted_at as string)),
    ).toBe(true);
  });

  it("filters by (room_id, user_id=target, contestant_id) on the UPDATE", async () => {
    const mock = makeSupabaseMock();
    await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    const filters = mock.updateFilters[0];
    expect(filters).toContainEqual(["room_id", VALID_ROOM_ID]);
    expect(filters).toContainEqual(["user_id", TARGET_USER_ID]);
    expect(filters).toContainEqual(["contestant_id", VALID_CONTESTANT_ID]);
  });

  it("returns deleted=false (idempotent) when no row matched (already null or absent)", async () => {
    const mock = makeSupabaseMock({
      voteUpdateResult: { data: null, error: null },
    });
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({ ok: true, deleted: false });
  });

  it("does NOT broadcast when nothing was deleted", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const mock = makeSupabaseMock({
      voteUpdateResult: { data: null, error: null },
    });
    await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("broadcasts hot_take_deleted with userId + contestantId + deletedByUserId on success", async () => {
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const mock = makeSupabaseMock();
    await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "hot_take_deleted",
      userId: TARGET_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      deletedByUserId: OWNER_USER_ID,
    });
  });

  it("returns success even when the broadcast throws (deletion is committed)", async () => {
    const broadcast = vi
      .fn()
      .mockRejectedValue(new Error("realtime down"));
    const mock = makeSupabaseMock();
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast }),
    );
    expect(result).toMatchObject({ ok: true, deleted: true });
  });

  it("returns 500 INTERNAL_ERROR when the UPDATE errors", async () => {
    const mock = makeSupabaseMock({
      voteUpdateResult: {
        data: null,
        error: { message: "constraint violation" },
      },
    });
    const result = await deleteHotTake(
      {
        roomId: VALID_ROOM_ID,
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
