import { describe, it, expect } from "vitest";
import { loadOwnPoints } from "./loadOwnPoints";

interface FakeRoom {
  id: string;
  status: string;
}
interface FakeMembership {
  user_id: string;
}
interface FakeResult {
  contestant_id: string;
  points_awarded: number;
}
interface FakeVote {
  contestant_id: string;
  hot_take: string | null;
}

function mockDeps(opts: {
  room?: FakeRoom | null;
  membership?: FakeMembership | null;
  results?: FakeResult[] | null;
  votes?: FakeVote[] | null;
}) {
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
          select() {
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
          },
        };
      }
      if (table === "results") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq: async () =>
                    opts.results !== null && opts.results !== undefined
                      ? { data: opts.results, error: null }
                      : { data: null, error: { code: "23000" } },
                };
              },
            };
          },
        };
      }
      if (table === "votes") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq: async () =>
                    opts.votes !== null && opts.votes !== undefined
                      ? { data: opts.votes, error: null }
                      : { data: null, error: { code: "23000" } },
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

  return { supabase };
}

describe("loadOwnPoints — input validation", () => {
  it("rejects non-string roomId", async () => {
    const { supabase } = mockDeps({});
    const result = await loadOwnPoints(
      { roomId: 42, userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
      expect(result.error.field).toBe("roomId");
      expect(result.status).toBe(400);
    }
  });

  it("rejects empty-string roomId", async () => {
    const { supabase } = mockDeps({});
    const result = await loadOwnPoints(
      { roomId: "", userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
      expect(result.error.field).toBe("roomId");
    }
  });

  it("rejects non-string userId", async () => {
    const { supabase } = mockDeps({});
    const result = await loadOwnPoints(
      { roomId: "r1", userId: null },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
      expect(result.error.field).toBe("userId");
      expect(result.status).toBe(400);
    }
  });

  it("rejects empty-string userId", async () => {
    const { supabase } = mockDeps({});
    const result = await loadOwnPoints(
      { roomId: "r1", userId: "" },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
      expect(result.error.field).toBe("userId");
    }
  });
});

describe("loadOwnPoints — room state", () => {
  it("404 when room not found", async () => {
    const { supabase } = mockDeps({ room: null });
    const result = await loadOwnPoints(
      { roomId: "missing", userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(404);
    }
  });

  it("409 ROOM_NOT_ANNOUNCING when status is 'voting'", async () => {
    const { supabase } = mockDeps({
      room: { id: "r1", status: "voting" },
    });
    const result = await loadOwnPoints(
      { roomId: "r1", userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_ANNOUNCING");
      expect(result.status).toBe(409);
    }
  });

  it("409 ROOM_NOT_ANNOUNCING when status is 'lobby'", async () => {
    const { supabase } = mockDeps({
      room: { id: "r1", status: "lobby" },
    });
    const result = await loadOwnPoints(
      { roomId: "r1", userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_ANNOUNCING");
      expect(result.status).toBe(409);
    }
  });
});

describe("loadOwnPoints — authorization", () => {
  it("403 when user is not a room member", async () => {
    const { supabase } = mockDeps({
      room: { id: "r1", status: "announcing" },
      membership: null,
    });
    const result = await loadOwnPoints(
      { roomId: "r1", userId: "outsider" },
      { supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(403);
    }
  });
});

describe("loadOwnPoints — happy path", () => {
  it("returns entries with Eurovision pointsAwarded from results + hotTake from votes", async () => {
    const { supabase } = mockDeps({
      room: { id: "r1", status: "announcing" },
      membership: { user_id: "u1" },
      results: [
        { contestant_id: "2025-SE", points_awarded: 12 },
        { contestant_id: "2025-NO", points_awarded: 10 },
        { contestant_id: "2025-FI", points_awarded: 0 },
      ],
      votes: [
        { contestant_id: "2025-SE", hot_take: "Amazing act!" },
        { contestant_id: "2025-NO", hot_take: null },
      ],
    });
    const result = await loadOwnPoints(
      { roomId: "r1", userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(3);
      const se = result.entries.find((e) => e.contestantId === "2025-SE");
      expect(se?.pointsAwarded).toBe(12);
      expect(se?.hotTake).toBe("Amazing act!");

      const no = result.entries.find((e) => e.contestantId === "2025-NO");
      expect(no?.pointsAwarded).toBe(10);
      expect(no?.hotTake).toBeNull();

      const fi = result.entries.find((e) => e.contestantId === "2025-FI");
      expect(fi?.pointsAwarded).toBe(0);
      expect(fi?.hotTake).toBeNull();
    }
  });

  it("works when status is 'done'", async () => {
    const { supabase } = mockDeps({
      room: { id: "r1", status: "done" },
      membership: { user_id: "u1" },
      results: [{ contestant_id: "2025-SE", points_awarded: 8 }],
      votes: [],
    });
    const result = await loadOwnPoints(
      { roomId: "r1", userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries[0].pointsAwarded).toBe(8);
    }
  });

  it("hotTake is null when contestant has no vote row", async () => {
    const { supabase } = mockDeps({
      room: { id: "r1", status: "announcing" },
      membership: { user_id: "u1" },
      results: [{ contestant_id: "2025-SE", points_awarded: 5 }],
      votes: [], // no vote row for SE
    });
    const result = await loadOwnPoints(
      { roomId: "r1", userId: "u1" },
      { supabase },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries[0].hotTake).toBeNull();
    }
  });
});
