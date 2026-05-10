import { describe, it, expect, vi } from "vitest";
import {
  updateAnnouncementMode,
  type UpdateAnnouncementModeDeps,
} from "@/lib/rooms/updateAnnouncementMode";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NON_OWNER_ID = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "lobby",
  owner_user_id: VALID_USER_ID,
  announcement_mode: "live",
};

const updatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
  owner_user_id: VALID_USER_ID,
  status: "lobby",
  announcement_mode: "instant",
  announcement_style: "full",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: null,
  allow_now_performing: false,
  created_at: "2026-04-19T12:00:00Z",
};

interface MockOpts {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  roomUpdateResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOpts = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const roomUpdateResult =
    opts.roomUpdateResult ?? { data: updatedRow, error: null };

  const updatePatches: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    if (table !== "rooms") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
        })),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue(roomUpdateResult),
            })),
          })),
        };
      }),
    };
  });

  return {
    supabase: { from } as unknown as UpdateAnnouncementModeDeps["supabase"],
    updatePatches,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpdateAnnouncementModeDeps> = {},
): UpdateAnnouncementModeDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("updateAnnouncementMode", () => {
  it("rejects invalid roomId with INVALID_ROOM_ID 400", async () => {
    const mock = makeSupabaseMock();
    const result = await updateAnnouncementMode(
      { roomId: "not-a-uuid", userId: VALID_USER_ID, mode: "instant" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ROOM_ID");
      expect(result.status).toBe(400);
    }
  });

  it("rejects empty userId with INVALID_USER_ID 400", async () => {
    const mock = makeSupabaseMock();
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: "", mode: "instant" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_USER_ID");
    }
  });

  it("rejects an invalid mode value with INVALID_ANNOUNCEMENT_MODE 400", async () => {
    const mock = makeSupabaseMock();
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "auto" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ANNOUNCEMENT_MODE");
    }
  });

  it("returns ROOM_NOT_FOUND 404 when the room doesn't exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "instant" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
    }
  });

  it("returns FORBIDDEN 403 when caller isn't the owner", async () => {
    const mock = makeSupabaseMock();
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: NON_OWNER_ID, mode: "instant" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  it("returns ROOM_NOT_IN_LOBBY 409 when status isn't lobby", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: { ...defaultRoomRow, status: "voting" },
        error: null,
      },
    });
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "instant" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_IN_LOBBY");
    }
  });

  it("happy path: writes the new mode + returns the updated room", async () => {
    const mock = makeSupabaseMock();
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "instant" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.room.announcementMode).toBe("instant");
    }
    expect(mock.updatePatches).toEqual([{ announcement_mode: "instant" }]);
  });

  it("treats broadcast failure as non-fatal (warn + return success)", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockRejectedValue(new Error("net down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "instant" },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result.ok).toBe(true);
    expect(broadcastSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("INTERNAL_ERROR 500 on UPDATE failure", async () => {
    const mock = makeSupabaseMock({
      roomUpdateResult: { data: null, error: { message: "db down" } },
    });
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "instant" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.status).toBe(500);
    }
  });

  // ─── announcement_style patch ─────────────────────────────────────────────

  it("no style provided: UPDATE patch contains only announcement_mode", async () => {
    const mock = makeSupabaseMock();
    await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "live" },
      makeDeps(mock),
    );
    expect(mock.updatePatches).toEqual([{ announcement_mode: "live" }]);
  });

  it("style: 'short' provided: UPDATE patch contains both announcement_mode and announcement_style", async () => {
    const mock = makeSupabaseMock();
    await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "live", style: "short" },
      makeDeps(mock),
    );
    expect(mock.updatePatches).toEqual([
      { announcement_mode: "live", announcement_style: "short" },
    ]);
  });

  it("rejects invalid style string with INVALID_ANNOUNCEMENT_STYLE 400, field 'style'", async () => {
    const mock = makeSupabaseMock();
    const result = await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "live", style: "invalid" },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ANNOUNCEMENT_STYLE", field: "style" },
    });
  });

  it("accepts mode: 'instant', style: 'full' — both written to UPDATE patch", async () => {
    const mock = makeSupabaseMock();
    await updateAnnouncementMode(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, mode: "instant", style: "full" },
      makeDeps(mock),
    );
    expect(mock.updatePatches).toEqual([
      { announcement_mode: "instant", announcement_style: "full" },
    ]);
  });
});
