import { describe, it, expect, vi } from "vitest";
import {
  updateRoomStatus,
  type UpdateStatusDeps,
  type RoomEventPayload,
} from "@/lib/rooms/updateStatus";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "lobby",
  owner_user_id: VALID_USER_ID,
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
  now_performing_id: null,
  allow_now_performing: false,
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
    supabase: { from } as unknown as UpdateStatusDeps["supabase"],
    selectEqCalls,
    updatePatches,
    updateEqCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpdateStatusDeps> = {}
): UpdateStatusDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("updateRoomStatus — happy path", () => {
  it("transitions lobby → voting, UPDATEs DB, broadcasts, returns { room }", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toMatchObject({
      id: VALID_ROOM_ID,
      status: "voting",
      ownerUserId: VALID_USER_ID,
    });
    expect(mock.updatePatches).toEqual([{ status: "voting" }]);
    expect(mock.updateEqCalls).toEqual([{ col: "id", val: VALID_ROOM_ID }]);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "status_changed",
      status: "voting",
    });
  });
});

describe("updateRoomStatus — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn();
    const result = await updateRoomStatus(
      { roomId: "not-a-uuid", status: "voting", userId: VALID_USER_ID },
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
    const result = await updateRoomStatus(
      { roomId: 42, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ROOM_ID" } });
  });

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomStatus(
        { roomId: VALID_ROOM_ID, status: "voting", userId },
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

  it.each([undefined, null, 42, "", "scoring", "announcing", "lobby", "voting_ending"])(
    "rejects status=%s (outside {voting, done}) with INVALID_STATUS",
    async (status) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomStatus(
        { roomId: VALID_ROOM_ID, status, userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_STATUS", field: "status" },
      });
      expect(mock.updatePatches).toEqual([]);
    }
  );
});

describe("updateRoomStatus — room not found", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
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
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });
});

describe("updateRoomStatus — admin authorization", () => {
  it("returns 403 FORBIDDEN when caller is not the owner", async () => {
    const otherUserId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: { id: VALID_ROOM_ID, status: "lobby", owner_user_id: otherUserId },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
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
