import { describe, it, expect, vi } from "vitest";
import {
  refreshContestants,
  type RefreshContestantsDeps,
} from "@/lib/rooms/refreshContestants";
import type { Contestant } from "@/types";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NON_OWNER_ID = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

function mkContestant(code: string, runningOrder: number): Contestant {
  return {
    id: `2026-${code}`,
    year: 2026,
    event: "final",
    countryCode: code,
    country: code.toUpperCase(),
    artist: "A",
    song: "S",
    flagEmoji: "🏳️",
    runningOrder,
  };
}

const FRESH_CONTESTANTS: Contestant[] = [
  mkContestant("ua", 1),
  mkContestant("se", 2),
  mkContestant("fr", 3),
];

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "lobby",
  owner_user_id: VALID_USER_ID,
  year: 2026,
  event: "final",
};

interface MockOpts {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOpts = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };

  const from = vi.fn((table: string) => {
    if (table !== "rooms") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
        })),
      })),
    };
  });

  return {
    supabase: { from } as unknown as RefreshContestantsDeps["supabase"],
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<RefreshContestantsDeps> = {},
): RefreshContestantsDeps {
  return {
    supabase: mock.supabase,
    fetchContestants: vi.fn().mockResolvedValue(FRESH_CONTESTANTS),
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("refreshContestants", () => {
  it("rejects invalid roomId with INVALID_ROOM_ID 400", async () => {
    const mock = makeSupabaseMock();
    const result = await refreshContestants(
      { roomId: "not-a-uuid", userId: VALID_USER_ID },
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
    const result = await refreshContestants(
      { roomId: VALID_ROOM_ID, userId: "" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_USER_ID");
      expect(result.status).toBe(400);
    }
  });

  it("returns ROOM_NOT_FOUND 404 when the room doesn't exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const result = await refreshContestants(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(404);
    }
  });

  it("returns FORBIDDEN 403 when caller is not the owner", async () => {
    const mock = makeSupabaseMock();
    const result = await refreshContestants(
      { roomId: VALID_ROOM_ID, userId: NON_OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.status).toBe(403);
    }
  });

  it("returns ROOM_NOT_IN_LOBBY 409 when status is not lobby", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: { ...defaultRoomRow, status: "voting" },
        error: null,
      },
    });
    const result = await refreshContestants(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_IN_LOBBY");
      expect(result.status).toBe(409);
    }
  });

  it("happy path: returns contestants + broadcasts contestants_refreshed", async () => {
    const mock = makeSupabaseMock();
    const fetchSpy = vi.fn().mockResolvedValue(FRESH_CONTESTANTS);
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(mock, {
      fetchContestants: fetchSpy,
      broadcastRoomEvent: broadcastSpy,
    });
    const result = await refreshContestants(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contestants).toEqual(FRESH_CONTESTANTS);
    }
    expect(fetchSpy).toHaveBeenCalledWith(2026, "final", { bypassCache: true });
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "contestants_refreshed",
    });
  });

  it("treats broadcast failure as non-fatal (logs warn, returns success)", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockRejectedValue(new Error("net down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps(mock, { broadcastRoomEvent: broadcastSpy });
    const result = await refreshContestants(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(broadcastSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("propagates ContestDataError as INTERNAL_ERROR 500", async () => {
    const mock = makeSupabaseMock();
    const fetchSpy = vi.fn().mockRejectedValue(new Error("upstream is down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps(mock, { fetchContestants: fetchSpy });
    const result = await refreshContestants(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.status).toBe(500);
    }
    warnSpy.mockRestore();
  });
});
