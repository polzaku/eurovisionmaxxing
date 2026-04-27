import { describe, it, expect, vi } from "vitest";
import { markReady } from "./markReady";

interface FakeRoom {
  id: string;
  status: string;
  announcement_mode: string;
}
interface FakeMembership {
  is_ready: boolean;
  ready_at: string | null;
}
interface FakeCounts {
  ready: number;
  total: number;
}

function mockDeps(opts: {
  room?: FakeRoom | null;
  membership?: FakeMembership | null;
  updateReturns?: { ready_at: string };
  countsAfter?: FakeCounts;
}) {
  const broadcastRoomEvent = vi.fn().mockResolvedValue(undefined);
  const supabase = {
    from(table: string) {
      if (table === "rooms") {
        return {
          select() {
            return {
              eq() {
                return {
                  single: async () =>
                    opts.room
                      ? { data: opts.room, error: null }
                      : { data: null, error: { code: "PGRST116" } },
                };
              },
            };
          },
        };
      }
      if (table === "room_memberships") {
        return {
          select(columns: string) {
            // Two distinct selects: existing membership lookup vs. recount.
            // Disambiguate by columns string.
            if (columns.includes("is_ready") && columns.includes("ready_at")) {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        single: async () =>
                          opts.membership
                            ? { data: opts.membership, error: null }
                            : { data: null, error: { code: "PGRST116" } },
                      };
                    },
                  };
                },
              };
            }
            // Counts query returns rows shaped { is_ready: bool }.
            return {
              eq: async () => {
                const { ready, total } = opts.countsAfter ?? {
                  ready: 0,
                  total: 0,
                };
                const rows = [
                  ...Array.from({ length: ready }, () => ({ is_ready: true })),
                  ...Array.from({ length: total - ready }, () => ({
                    is_ready: false,
                  })),
                ];
                return { data: rows, error: null };
              },
            };
          },
          update() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      select() {
                        return {
                          single: async () =>
                            opts.updateReturns
                              ? { data: opts.updateReturns, error: null }
                              : { data: null, error: { code: "23000" } },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient<
    import("@/types/database").Database
  >;

  return { supabase, broadcastRoomEvent };
}

describe("markReady — input validation", () => {
  it("rejects non-string roomId", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({});
    const result = await markReady(
      { roomId: 42, userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
    }
  });

  it("rejects non-string userId", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({});
    const result = await markReady(
      { roomId: "r1", userId: null },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
    }
  });
});

describe("markReady — room state", () => {
  it("404 when room not found", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({ room: null });
    const result = await markReady(
      { roomId: "missing", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(404);
    }
  });

  it("409 ROOM_NOT_INSTANT when announcement_mode != 'instant'", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "live" },
      membership: { is_ready: false, ready_at: null },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_INSTANT");
      expect(result.status).toBe(409);
    }
  });

  it("409 ROOM_NOT_ANNOUNCING when status != 'announcing'", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "voting", announcement_mode: "instant" },
      membership: { is_ready: false, ready_at: null },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_ANNOUNCING");
      expect(result.status).toBe(409);
    }
  });
});

describe("markReady — authorization", () => {
  it("403 when user is not a room member", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "instant" },
      membership: null,
    });
    const result = await markReady(
      { roomId: "r1", userId: "outsider" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(403);
    }
  });
});

describe("markReady — happy path", () => {
  it("sets is_ready, broadcasts member_ready, returns counts", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "instant" },
      membership: { is_ready: false, ready_at: null },
      updateReturns: { ready_at: "2026-04-27T10:00:00.000Z" },
      countsAfter: { ready: 1, total: 3 },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readyAt).toBe("2026-04-27T10:00:00.000Z");
      expect(result.readyCount).toBe(1);
      expect(result.totalCount).toBe(3);
    }
    expect(broadcastRoomEvent).toHaveBeenCalledWith("r1", {
      type: "member_ready",
      userId: "u1",
      readyAt: "2026-04-27T10:00:00.000Z",
      readyCount: 1,
      totalCount: 3,
    });
  });

  it("idempotent: already-ready member returns existing readyAt without re-broadcast", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "instant" },
      membership: { is_ready: true, ready_at: "2026-04-27T09:00:00.000Z" },
      countsAfter: { ready: 2, total: 3 },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readyAt).toBe("2026-04-27T09:00:00.000Z");
    }
    expect(broadcastRoomEvent).not.toHaveBeenCalled();
  });
});
