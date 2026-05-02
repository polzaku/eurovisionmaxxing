import { describe, it, expect, vi } from "vitest";
import {
  skipAnnouncer,
  type SkipAnnouncerDeps,
} from "@/lib/rooms/skipAnnouncer";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";

const announcingRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcement_order: [U1, U2],
  announcing_user_id: U1,
  current_announce_idx: 0,
  announce_skipped_user_ids: [],
};

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  userSelect?: Mock;
  resultsUpdate?: { error: { message: string } | null };
  roomUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: announcingRoom, error: null };
  const userSelect =
    s.userSelect ?? { data: { display_name: "Alice" }, error: null };
  const resultsUpdate = s.resultsUpdate ?? { error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };

  const resultsUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];
  const roomUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelect),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          const eqs: Array<{ col: string; val: unknown }> = [];
          roomUpdateCalls.push({ patch, eqs });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(roomUpdate),
            })),
          };
          return chain;
        }),
      };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(userSelect),
          })),
        })),
      };
    }
    if (table === "results") {
      return {
        update: vi.fn((patch: Record<string, unknown>) => {
          const eqs: Array<{ col: string; val: unknown }> = [];
          resultsUpdateCalls.push({ patch, eqs });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            then: (...args: unknown[]) =>
              Promise.resolve({ data: null, ...resultsUpdate }).then(
                ...(args as [(v: unknown) => unknown]),
              ),
          };
          return chain;
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as SkipAnnouncerDeps["supabase"],
    resultsUpdateCalls,
    roomUpdateCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<SkipAnnouncerDeps> = {},
): SkipAnnouncerDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── input validation ────────────────────────────────────────────────────────

describe("skipAnnouncer — input validation", () => {
  it("rejects non-UUID roomId", async () => {
    const result = await skipAnnouncer(
      { roomId: "no", userId: OWNER_ID },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("rejects empty userId", async () => {
    const result = await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: "" },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });
});

// ─── room state guards ───────────────────────────────────────────────────────

describe("skipAnnouncer — room state", () => {
  it("returns 404 ROOM_NOT_FOUND", async () => {
    const mock = makeSupabaseMock({ roomSelect: { data: null, error: null } });
    const result = await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it.each(["lobby", "voting", "scoring", "done"])(
    "returns 409 ROOM_NOT_ANNOUNCING when status is %s",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelect: { data: { ...announcingRoom, status }, error: null },
      });
      const result = await skipAnnouncer(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock),
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_ANNOUNCING" },
      });
    },
  );

  it("returns 409 ROOM_NOT_ANNOUNCING when announcement_order is empty", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [],
          announcing_user_id: null,
        },
        error: null,
      },
    });
    const result = await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_ANNOUNCING" },
    });
  });
});

// ─── auth ───────────────────────────────────────────────────────────────────

describe("skipAnnouncer — authorization", () => {
  it("returns 403 FORBIDDEN for a non-owner caller (even if they're the current announcer)", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn();
    const result = await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: U1 }, // U1 is the announcer, not owner
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(mock.roomUpdateCalls).toEqual([]);
  });
});

// ─── happy path ─────────────────────────────────────────────────────────────

describe("skipAnnouncer — happy path", () => {
  it("advances pointer to the next announcer + appends skipped user to the array", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toMatchObject({
      ok: true,
      skippedUserId: U1,
      skippedDisplayName: "Alice",
      nextAnnouncingUserId: U2,
      finished: false,
    });
    expect(mock.roomUpdateCalls).toHaveLength(1);
    const patch = mock.roomUpdateCalls[0].patch;
    expect(patch.announcing_user_id).toBe(U2);
    expect(patch.current_announce_idx).toBe(0);
    expect(patch.announce_skipped_user_ids).toEqual([U1]);
    expect(patch.status).toBeUndefined(); // not finished
  });

  it("marks all of skipped user's results as announced (silent leaderboard update)", async () => {
    const mock = makeSupabaseMock();
    await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(mock.resultsUpdateCalls).toHaveLength(1);
    const call = mock.resultsUpdateCalls[0];
    expect(call.patch).toEqual({ announced: true });
    expect(call.eqs).toEqual([
      { col: "room_id", val: VALID_ROOM_ID },
      { col: "user_id", val: U1 },
    ]);
  });

  it("broadcasts announce_skip with the skipped user's display name", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "announce_skip",
      userId: U1,
      displayName: "Alice",
    });
  });

  it("does not duplicate user if already in announce_skipped_user_ids", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...announcingRoom, announce_skipped_user_ids: [U1] },
        error: null,
      },
    });
    await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    const patch = mock.roomUpdateCalls[0].patch;
    expect(patch.announce_skipped_user_ids).toEqual([U1]);
  });
});

// ─── last-announcer skip → done ─────────────────────────────────────────────

describe("skipAnnouncer — finishing the show", () => {
  it("transitions room to `done` when the last announcer is skipped", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom,
          announcement_order: [U1, U2],
          announcing_user_id: U2,
        },
        error: null,
      },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toMatchObject({
      ok: true,
      finished: true,
      nextAnnouncingUserId: null,
    });
    const patch = mock.roomUpdateCalls[0].patch;
    expect(patch.announcing_user_id).toBeNull();
    expect(patch.status).toBe("done");

    // Both announce_skip and status_changed:done broadcasts should fire.
    const events = (broadcastSpy.mock.calls as Array<[unknown, unknown]>).map(
      ([, e]) => e,
    );
    expect(events).toContainEqual({
      type: "announce_skip",
      userId: U2,
      displayName: "Alice",
    });
    expect(events).toContainEqual({
      type: "status_changed",
      status: "done",
    });
  });
});

// ─── race ───────────────────────────────────────────────────────────────────

describe("skipAnnouncer — race", () => {
  it("returns 409 ANNOUNCE_RACED when the conditional UPDATE matches no row", async () => {
    const mock = makeSupabaseMock({
      roomUpdate: { data: null, error: null },
    });
    const result = await skipAnnouncer(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "ANNOUNCE_RACED" },
    });
  });
});
