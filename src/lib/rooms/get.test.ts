import { describe, it, expect, vi } from "vitest";
import type { Contestant } from "@/types";
import { ContestDataError } from "@/lib/contestants";
import { getRoom, type GetRoomDeps } from "@/lib/rooms/get";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";

const roomRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
  owner_user_id: "user-owner",
  status: "lobby",
  announcement_mode: "instant",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: null,
  allow_now_performing: false,
  created_at: "2026-04-19T12:00:00Z",
};

const membershipRows = [
  {
    user_id: "user-owner",
    joined_at: "2026-04-19T12:00:00Z",
    is_ready: false,
    ready_at: null,
    users: { display_name: "Owner", avatar_seed: "seed-owner" },
  },
  {
    user_id: "user-guest",
    joined_at: "2026-04-19T12:05:00Z",
    is_ready: true,
    ready_at: null,
    users: { display_name: "Guest", avatar_seed: "seed-guest" },
  },
];

const contestants: Contestant[] = [
  {
    id: "2026-ua",
    country: "Ukraine",
    countryCode: "ua",
    flagEmoji: "🇺🇦",
    artist: "TestArtist",
    song: "TestSong",
    runningOrder: 1,
    event: "final",
    year: 2026,
  },
];

interface MockOptions {
  roomResult?: { data: unknown; error: { message: string } | null };
  membershipsResult?: { data: unknown; error: { message: string } | null };
  votesResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomResult = opts.roomResult ?? { data: roomRow, error: null };
  const membershipsResult =
    opts.membershipsResult ?? { data: membershipRows, error: null };
  const votesResult = opts.votesResult ?? { data: [], error: null };

  const roomSelectCalls: Array<{ table: string; eq?: { col: string; val: unknown } }> = [];
  const membershipSelectCalls: Array<{ table: string; eq?: { col: string; val: unknown }; select: string }> = [];
  const votesSelectCalls: Array<{
    table: string;
    eq1: { col: string; val: unknown };
    eq2: { col: string; val: unknown };
  }> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            roomSelectCalls.push({ table, eq: { col, val } });
            return {
              maybeSingle: vi.fn().mockResolvedValue(roomResult),
            };
          }),
        })),
      };
    }
    if (table === "room_memberships") {
      return {
        select: vi.fn((select: string) => ({
          eq: vi.fn((col: string, val: unknown) => {
            membershipSelectCalls.push({ table, eq: { col, val }, select });
            return Promise.resolve(membershipsResult);
          }),
        })),
      };
    }
    if (table === "votes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col1: string, val1: unknown) => ({
            eq: vi.fn((col2: string, val2: unknown) => {
              votesSelectCalls.push({
                table,
                eq1: { col: col1, val: val1 },
                eq2: { col: col2, val: val2 },
              });
              return Promise.resolve(votesResult);
            }),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as GetRoomDeps["supabase"],
    roomSelectCalls,
    membershipSelectCalls,
    votesSelectCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<GetRoomDeps> = {}
): GetRoomDeps {
  return {
    supabase: mock.supabase,
    fetchContestants: vi.fn().mockResolvedValue(contestants),
    ...overrides,
  };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("getRoom — happy path", () => {
  it("returns room, memberships (with display name + avatar), and contestants", async () => {
    const mock = makeSupabaseMock();
    const fetchSpy = vi.fn().mockResolvedValue(contestants);
    const result = await getRoom(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock, { fetchContestants: fetchSpy })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.room).toMatchObject({
      id: VALID_ROOM_ID,
      pin: "AAAAAA",
      year: 2026,
      event: "final",
      status: "lobby",
      ownerUserId: "user-owner",
      announcementMode: "instant",
    });
    expect(result.data.memberships).toEqual([
      {
        userId: "user-owner",
        displayName: "Owner",
        avatarSeed: "seed-owner",
        joinedAt: "2026-04-19T12:00:00Z",
        isReady: false,
        readyAt: null,
      },
      {
        userId: "user-guest",
        displayName: "Guest",
        avatarSeed: "seed-guest",
        joinedAt: "2026-04-19T12:05:00Z",
        isReady: true,
        readyAt: null,
      },
    ]);
    expect(result.data.contestants).toEqual(contestants);
    expect(fetchSpy).toHaveBeenCalledWith(2026, "final");
  });

  it("queries rooms by id and memberships by room_id", async () => {
    const mock = makeSupabaseMock();
    await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock));
    expect(mock.roomSelectCalls).toEqual([
      { table: "rooms", eq: { col: "id", val: VALID_ROOM_ID } },
    ]);
    expect(mock.membershipSelectCalls).toHaveLength(1);
    expect(mock.membershipSelectCalls[0]).toMatchObject({
      table: "room_memberships",
      eq: { col: "room_id", val: VALID_ROOM_ID },
    });
  });

  it("skips rows where the joined user record is missing (defensive)", async () => {
    const mock = makeSupabaseMock({
      membershipsResult: {
        data: [
          {
            user_id: "user-ghost",
            joined_at: "2026-04-19T12:00:00Z",
            is_ready: false,
            ready_at: null,
            users: null,
          },
          ...membershipRows,
        ],
        error: null,
      },
    });
    const result = await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.memberships).toHaveLength(2);
    expect(result.data.memberships.map((m) => m.userId)).toEqual([
      "user-owner",
      "user-guest",
    ]);
  });
});

// ─── roomId validation ──────────────────────────────────────────────────────

describe("getRoom — roomId validation", () => {
  it("rejects a non-string roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await getRoom({ roomId: 42 }, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.roomSelectCalls).toEqual([]);
  });

  it("rejects a malformed roomId string with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await getRoom({ roomId: "not-a-uuid" }, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_ROOM_ID" },
    });
    expect(mock.roomSelectCalls).toEqual([]);
  });

  it("rejects an empty roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await getRoom({ roomId: "" }, makeDeps(mock));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ROOM_ID" } });
  });
});

// ─── not-found + DB errors ──────────────────────────────────────────────────

describe("getRoom — not found / DB errors", () => {
  it("returns ROOM_NOT_FOUND (404) when the room query yields no row", async () => {
    const mock = makeSupabaseMock({
      roomResult: { data: null, error: null },
    });
    const result = await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("does NOT call fetchContestants or query memberships when the room is missing", async () => {
    const mock = makeSupabaseMock({
      roomResult: { data: null, error: null },
    });
    const fetchSpy = vi.fn();
    await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock, { fetchContestants: fetchSpy }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mock.membershipSelectCalls).toEqual([]);
  });

  it("returns INTERNAL_ERROR when the room query errors", async () => {
    const mock = makeSupabaseMock({
      roomResult: { data: null, error: { message: "connection refused" } },
    });
    const result = await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns INTERNAL_ERROR when the memberships query errors", async () => {
    const mock = makeSupabaseMock({
      membershipsResult: { data: null, error: { message: "bad join" } },
    });
    const result = await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

// ─── contest-data errors ────────────────────────────────────────────────────

describe("getRoom — contest data errors", () => {
  it("returns INTERNAL_ERROR when fetchContestants throws ContestDataError", async () => {
    const mock = makeSupabaseMock();
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new ContestDataError("Contest data not found for 2026 final"));
    const result = await getRoom(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock, { fetchContestants: fetchSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("lets unexpected (non-ContestDataError) errors bubble up", async () => {
    const mock = makeSupabaseMock();
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("boom"));
    await expect(
      getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock, { fetchContestants: fetchSpy }))
    ).rejects.toThrow(TypeError);
  });
});

// ─── votes rehydration ──────────────────────────────────────────────────────

const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("getRoom — votes rehydration", () => {
  it("omits the votes query and returns votes: [] when userId is not provided", async () => {
    const mock = makeSupabaseMock();
    const result = await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.votes).toEqual([]);
    expect(mock.votesSelectCalls).toEqual([]);
  });

  it("queries votes by (room_id, user_id) when userId is provided", async () => {
    const mock = makeSupabaseMock();
    await getRoom(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(mock.votesSelectCalls).toHaveLength(1);
    expect(mock.votesSelectCalls[0]).toEqual({
      table: "votes",
      eq1: { col: "room_id", val: VALID_ROOM_ID },
      eq2: { col: "user_id", val: VALID_USER_ID },
    });
  });

  it("maps vote rows to VoteView and returns them when userId matches", async () => {
    const mock = makeSupabaseMock({
      votesResult: {
        data: [
          {
            contestant_id: "2026-ua",
            scores: { Vocals: 7, Staging: 9 },
            missed: false,
            hot_take: "iconic",
            updated_at: "2026-04-25T12:00:00Z",
          },
          {
            contestant_id: "2026-se",
            scores: null,
            missed: true,
            hot_take: null,
            updated_at: "2026-04-25T12:01:00Z",
          },
        ],
        error: null,
      },
    });
    const result = await getRoom(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.votes).toEqual([
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, Staging: 9 },
        missed: false,
        hotTake: "iconic",
        updatedAt: "2026-04-25T12:00:00Z",
      },
      {
        contestantId: "2026-se",
        scores: null,
        missed: true,
        hotTake: null,
        updatedAt: "2026-04-25T12:01:00Z",
      },
    ]);
  });

  it("rejects a non-UUID userId with INVALID_USER_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await getRoom(
      { roomId: VALID_ROOM_ID, userId: "not-a-uuid" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("falls back to votes: [] when the votes query errors (progressive enhancement)", async () => {
    const mock = makeSupabaseMock({
      votesResult: { data: null, error: { message: "db boom" } },
    });
    const result = await getRoom(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.votes).toEqual([]);
  });
});
