import { describe, it, expect, vi } from "vitest";
import { setDelegate, type SetDelegateDeps } from "@/lib/rooms/setDelegate";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_USER_ID = "20000000-0000-4000-8000-000000000002";

const announcingRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcing_user_id: OTHER_USER_ID,
};

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  roomUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: announcingRoom, error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };

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
        const chain = {
          eq: vi.fn(() => chain),
          select: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomUpdate),
          })),
        };
        return chain;
      }),
    };
  });

  return {
    supabase: { from } as unknown as SetDelegateDeps["supabase"],
    updatePatches,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<SetDelegateDeps> = {},
): SetDelegateDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("setDelegate — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const result = await setDelegate(
      { roomId: "no", userId: OWNER_ID, takeControl: true },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("rejects missing userId with INVALID_USER_ID", async () => {
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: "", takeControl: true },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("rejects non-boolean takeControl with INVALID_BODY", async () => {
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, takeControl: "yes" },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_BODY", field: "takeControl" },
    });
  });
});

describe("setDelegate — authorization & status", () => {
  it("returns 404 when room missing", async () => {
    const mock = makeSupabaseMock({
      roomSelect: { data: null, error: null },
    });
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, takeControl: true },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 403 FORBIDDEN when caller is not the owner", async () => {
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: OTHER_USER_ID, takeControl: true },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
  });

  it.each(["lobby", "voting", "scoring", "done"])(
    "returns 409 ROOM_NOT_ANNOUNCING when status is %s",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelect: {
          data: { ...announcingRoom, status },
          error: null,
        },
      });
      const result = await setDelegate(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID, takeControl: true },
        makeDeps(mock),
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_ANNOUNCING" },
      });
    },
  );
});

describe("setDelegate — happy path", () => {
  it("takeControl=true sets delegate_user_id to the owner", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, takeControl: true },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toEqual({ ok: true, delegateUserId: OWNER_ID });
    expect(mock.updatePatches).toEqual([{ delegate_user_id: OWNER_ID }]);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "status_changed",
      status: "announcing",
    });
  });

  it("takeControl=false clears delegate_user_id", async () => {
    const mock = makeSupabaseMock();
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, takeControl: false },
      makeDeps(mock),
    );
    expect(result).toEqual({ ok: true, delegateUserId: null });
    expect(mock.updatePatches).toEqual([{ delegate_user_id: null }]);
  });

  it("returns 500 when the UPDATE fails", async () => {
    const mock = makeSupabaseMock({
      roomUpdate: { data: null, error: { message: "boom" } },
    });
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, takeControl: true },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("survives a broadcast failure (logs warn, returns success)", async () => {
    const mock = makeSupabaseMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broadcastSpy = vi.fn().mockRejectedValue(new Error("ch down"));
    const result = await setDelegate(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, takeControl: true },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
