import { describe, it, expect, vi } from "vitest";
import {
  updateRoomNowPerforming,
  type UpdateNowPerformingDeps,
} from "@/lib/rooms/updateNowPerforming";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "voting",
  owner_user_id: VALID_USER_ID,
  allow_now_performing: true,
};

const defaultUpdatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
  owner_user_id: VALID_USER_ID,
  status: "voting",
  announcement_mode: "instant",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: VALID_CONTESTANT_ID,
  allow_now_performing: true,
  created_at: "2026-04-19T12:00:00Z",
};

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  roomUpdateResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const roomUpdateResult =
    opts.roomUpdateResult ?? { data: defaultUpdatedRow, error: null };

  const selectEqCalls: Array<{ col: string; val: unknown }> = [];
  const updatePatches: Array<Record<string, unknown>> = [];
  const updateEqCalls: Array<{ col: string; val: unknown }> = [];

  const from = vi.fn((table: string) => {
    if (table !== "rooms") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn((col: string, val: unknown) => {
          selectEqCalls.push({ col, val });
          return { maybeSingle: vi.fn().mockResolvedValue(roomSelectResult) };
        }),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        return {
          eq: vi.fn((col: string, val: unknown) => {
            updateEqCalls.push({ col, val });
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(roomUpdateResult),
              })),
            };
          }),
        };
      }),
    };
  });

  return {
    supabase: { from } as unknown as UpdateNowPerformingDeps["supabase"],
    selectEqCalls,
    updatePatches,
    updateEqCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpdateNowPerformingDeps> = {}
): UpdateNowPerformingDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("updateRoomNowPerforming — happy path", () => {
  it("sets now_performing_id, broadcasts, returns { room }", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toMatchObject({
      id: VALID_ROOM_ID,
      nowPerformingId: VALID_CONTESTANT_ID,
    });
    expect(mock.updatePatches).toEqual([
      { now_performing_id: VALID_CONTESTANT_ID },
    ]);
    expect(mock.updateEqCalls).toEqual([{ col: "id", val: VALID_ROOM_ID }]);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "now_performing",
      contestantId: VALID_CONTESTANT_ID,
    });
  });
});

describe("updateRoomNowPerforming — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: "not-a-uuid",
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("rejects non-string roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomNowPerforming(
      { roomId: 42, contestantId: VALID_CONTESTANT_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ROOM_ID" } });
  });

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomNowPerforming(
        { roomId: VALID_ROOM_ID, contestantId: VALID_CONTESTANT_ID, userId },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.updatePatches).toEqual([]);
    }
  );

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string contestantId (%s) with INVALID_CONTESTANT_ID",
    async (contestantId) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomNowPerforming(
        { roomId: VALID_ROOM_ID, contestantId, userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_CONTESTANT_ID", field: "contestantId" },
      });
      expect(mock.updatePatches).toEqual([]);
    }
  );

  it("rejects contestantId longer than 20 chars with INVALID_CONTESTANT_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: "2026-thisistoolongforthecolumn",
        userId: VALID_USER_ID,
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONTESTANT_ID" },
    });
  });
});

describe("updateRoomNowPerforming — room not found", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("returns 404 ROOM_NOT_FOUND when the room SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: { message: "boom" } },
    });
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
  });
});

describe("updateRoomNowPerforming — admin authorization", () => {
  it("returns 403 FORBIDDEN when caller is not the owner", async () => {
    const otherUserId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: {
          id: VALID_ROOM_ID,
          status: "voting",
          owner_user_id: otherUserId,
          allow_now_performing: true,
        },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

describe("updateRoomNowPerforming — state guards", () => {
  it("returns 409 NOW_PERFORMING_DISABLED when allow_now_performing is false", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: {
          id: VALID_ROOM_ID,
          status: "voting",
          owner_user_id: VALID_USER_ID,
          allow_now_performing: false,
        },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "NOW_PERFORMING_DISABLED" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it.each(["lobby", "scoring", "announcing", "done"] as const)(
    "returns 409 ROOM_NOT_VOTING when status=%s (with allow_now_performing=true)",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: {
            id: VALID_ROOM_ID,
            status,
            owner_user_id: VALID_USER_ID,
            allow_now_performing: true,
          },
          error: null,
        },
      });
      const broadcastSpy = vi.fn();
      const result = await updateRoomNowPerforming(
        {
          roomId: VALID_ROOM_ID,
          contestantId: VALID_CONTESTANT_ID,
          userId: VALID_USER_ID,
        },
        makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_VOTING" },
      });
      expect(mock.updatePatches).toEqual([]);
      expect(broadcastSpy).not.toHaveBeenCalled();
    }
  );
});
