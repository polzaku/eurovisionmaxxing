import { describe, it, expect, vi } from "vitest";
import {
  updateRoomCategories,
  type UpdateRoomCategoriesDeps,
} from "@/lib/rooms/updateRoomCategories";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NON_OWNER_ID = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

const NEW_CATEGORIES = [
  { name: "Vocals", weight: 1 },
  { name: "Outfit", weight: 1 },
  { name: "Stage drama", weight: 2 },
];

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "lobby",
  owner_user_id: VALID_USER_ID,
};

const updatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: NEW_CATEGORIES,
  owner_user_id: VALID_USER_ID,
  status: "lobby",
  announcement_mode: "live",
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
    supabase: { from } as unknown as UpdateRoomCategoriesDeps["supabase"],
    updatePatches,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpdateRoomCategoriesDeps> = {},
): UpdateRoomCategoriesDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("updateRoomCategories", () => {
  it("rejects invalid roomId with INVALID_ROOM_ID 400", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomCategories(
      { roomId: "not-a-uuid", userId: VALID_USER_ID, categories: NEW_CATEGORIES },
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
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: "", categories: NEW_CATEGORIES },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_USER_ID");
  });

  it("rejects empty categories array with INVALID_CATEGORIES 400", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, categories: [] },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CATEGORIES");
  });

  it("rejects malformed category items with INVALID_CATEGORY 400", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomCategories(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        categories: [{ name: "X" }], // too short
      },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CATEGORY");
  });

  it("rejects duplicate names case-insensitively", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomCategories(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        categories: [{ name: "Vocals" }, { name: "vocals" }],
      },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_CATEGORIES");
  });

  it("returns ROOM_NOT_FOUND 404 when the room doesn't exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, categories: NEW_CATEGORIES },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns FORBIDDEN 403 when caller isn't the owner", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: NON_OWNER_ID, categories: NEW_CATEGORIES },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("returns ROOM_NOT_IN_LOBBY 409 when status isn't lobby", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: { ...defaultRoomRow, status: "voting" },
        error: null,
      },
    });
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, categories: NEW_CATEGORIES },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ROOM_NOT_IN_LOBBY");
  });

  it("happy path: writes the new categories + returns the updated room", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, categories: NEW_CATEGORIES },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.room.categories).toEqual(NEW_CATEGORIES);
    expect(mock.updatePatches).toEqual([
      { categories: NEW_CATEGORIES },
    ]);
  });

  it("treats broadcast failure as non-fatal (warn + return success)", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockRejectedValue(new Error("net down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, categories: NEW_CATEGORIES },
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
    const result = await updateRoomCategories(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, categories: NEW_CATEGORIES },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.status).toBe(500);
    }
  });
});
