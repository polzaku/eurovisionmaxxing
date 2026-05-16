import { describe, it, expect, vi } from "vitest";
import {
  startAnnouncing,
  type StartAnnouncingDeps,
} from "@/lib/rooms/startAnnouncing";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_ID = "ffffffff-0000-4111-8222-333333333333";

interface MockOptions {
  roomSelect?: { data: unknown; error: { message: string } | null };
  roomUpdate?: { data: unknown; error: { message: string } | null };
}

function makeSupabase(opts: MockOptions = {}) {
  const roomSelect = opts.roomSelect ?? {
    data: {
      id: ROOM_ID,
      status: "calibration",
      owner_user_id: OWNER_ID,
    },
    error: null,
  };
  const roomUpdate = opts.roomUpdate ?? { data: { id: ROOM_ID }, error: null };

  const updatePatches: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    if (table !== "rooms") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(roomSelect),
        })),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue(roomUpdate),
              })),
            })),
          })),
        };
      }),
    };
  });

  return {
    supabase: { from } as unknown as StartAnnouncingDeps["supabase"],
    updatePatches,
  };
}

function makeDeps(
  supabase: StartAnnouncingDeps["supabase"],
  broadcastRoomEvent: StartAnnouncingDeps["broadcastRoomEvent"] = vi
    .fn()
    .mockResolvedValue(undefined),
): StartAnnouncingDeps {
  return { supabase, broadcastRoomEvent };
}

describe("startAnnouncing", () => {
  it("transitions a calibration room to announcing when the owner calls", async () => {
    const mock = makeSupabase();
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await startAnnouncing(
      { roomId: ROOM_ID, userId: OWNER_ID },
      makeDeps(mock.supabase, broadcast),
    );
    expect(result.ok).toBe(true);
    expect(mock.updatePatches).toEqual([{ status: "announcing" }]);
    expect(broadcast).toHaveBeenCalledWith(ROOM_ID, {
      type: "status_changed",
      status: "announcing",
    });
  });

  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabase();
    const result = await startAnnouncing(
      { roomId: "not-a-uuid", userId: OWNER_ID },
      makeDeps(mock.supabase),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.updatePatches).toEqual([]);
  });

  it("rejects empty userId with INVALID_USER_ID", async () => {
    const mock = makeSupabase();
    const result = await startAnnouncing(
      { roomId: ROOM_ID, userId: "" },
      makeDeps(mock.supabase),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("returns ROOM_NOT_FOUND when the room doesn't exist", async () => {
    const mock = makeSupabase({
      roomSelect: { data: null, error: null },
    });
    const result = await startAnnouncing(
      { roomId: ROOM_ID, userId: OWNER_ID },
      makeDeps(mock.supabase),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns FORBIDDEN when the caller is not the room owner", async () => {
    const mock = makeSupabase();
    const result = await startAnnouncing(
      { roomId: ROOM_ID, userId: OTHER_ID },
      makeDeps(mock.supabase),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(mock.updatePatches).toEqual([]);
  });

  it("returns ROOM_NOT_CALIBRATING when the room is not in calibration", async () => {
    const mock = makeSupabase({
      roomSelect: {
        data: {
          id: ROOM_ID,
          status: "voting",
          owner_user_id: OWNER_ID,
        },
        error: null,
      },
    });
    const result = await startAnnouncing(
      { roomId: ROOM_ID, userId: OWNER_ID },
      makeDeps(mock.supabase),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_CALIBRATING" },
    });
    expect(mock.updatePatches).toEqual([]);
  });

  it("returns INTERNAL_ERROR when the conditional UPDATE returns no row (concurrent transition)", async () => {
    const mock = makeSupabase({
      roomUpdate: { data: null, error: null },
    });
    const result = await startAnnouncing(
      { roomId: ROOM_ID, userId: OWNER_ID },
      makeDeps(mock.supabase),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("treats a broadcast failure as non-fatal (state is already committed)", async () => {
    const mock = makeSupabase();
    const broadcast = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await startAnnouncing(
      { roomId: ROOM_ID, userId: OWNER_ID },
      makeDeps(mock.supabase, broadcast),
    );
    expect(result.ok).toBe(true);
  });
});
