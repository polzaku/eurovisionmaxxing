import { describe, it, expect, vi } from "vitest";
import {
  loadResults,
  type LoadResultsDeps,
} from "@/lib/results/loadResults";
import { ContestDataError } from "@/lib/contestants";
import type { Contestant, EventType } from "@/types";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";

const contestant = (
  id: string,
  country: string,
  flag: string,
  order: number,
): Contestant => ({
  id,
  country,
  countryCode: id.slice(-2),
  flagEmoji: flag,
  artist: "A",
  song: "s",
  runningOrder: order,
  event: "final",
  year: 2026,
});

const THREE_CONTESTANTS: Contestant[] = [
  contestant("2026-al", "Albania", "🇦🇱", 1),
  contestant("2026-be", "Belgium", "🇧🇪", 2),
  contestant("2026-cr", "Croatia", "🇭🇷", 3),
];

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  resultsSelect?: Mock;
  membershipsSelect?: Mock;
  hotTakesSelect?: Mock;
  awardsSelect?: Mock;
  /** SELECT * FROM users WHERE id = announcing_user_id (for announcement state). */
  announcerUser?: Mock;
  /** SELECT contestant_id, points_awarded FROM results filtered to announcer's queue. */
  announcerQueue?: Mock;
  /**
   * SELECT user_id, contestant_id, scores, missed FROM votes WHERE room_id = ...
   * (the awards/personalNeighbours SELECT — no .not() chain).
   */
  votesSelect?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? {
    data: {
      id: VALID_ROOM_ID,
      status: "lobby",
      pin: "AAAAAA",
      year: 2026,
      event: "final",
    },
    error: null,
  };
  const resultsSelect = s.resultsSelect ?? { data: [], error: null };
  const membershipsSelect = s.membershipsSelect ?? { data: [], error: null };
  const hotTakesSelect = s.hotTakesSelect ?? { data: [], error: null };
  const awardsSelect = s.awardsSelect ?? { data: [], error: null };
  const announcerUser = s.announcerUser ?? { data: null, error: null };
  const announcerQueue = s.announcerQueue ?? { data: [], error: null };
  const votesSelect = s.votesSelect ?? { data: [], error: null };

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelect),
          })),
        })),
      };
    }
    if (table === "results") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            // .eq("room_id", id).eq("announced", true) for announcing leaderboard,
            // .eq("room_id", id).eq("user_id", announcer) for the announcer queue chain.
            eq: vi.fn(() => {
              // Heuristic: if the announcer-queue chain continues with .gt/.order,
              // dispatch announcerQueue; otherwise resolve as the leaderboard.
              const announcerChain = {
                gt: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue(announcerQueue),
                })),
                then: (...args: unknown[]) =>
                  Promise.resolve(resultsSelect).then(
                    ...(args as [
                      (v: Mock) => unknown,
                      ((err: unknown) => unknown)?,
                    ]),
                  ),
              };
              return announcerChain;
            }),
            // .eq("room_id", id) (then awaited) for done
            then: (...args: unknown[]) =>
              Promise.resolve(resultsSelect).then(
                ...(args as [
                  (v: Mock) => unknown,
                  ((err: unknown) => unknown)?,
                ]),
              ),
          })),
        })),
      };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(announcerUser),
          })),
        })),
      };
    }
    if (table === "room_memberships") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(membershipsSelect),
        })),
      };
    }
    if (table === "votes") {
      // Two call shapes coexist in loadDone:
      //   hot-takes:        .select(...).eq("room_id", id).not("hot_take", "is", null) → awaited
      //   awards/personal:  .select(...).eq("room_id", id)                             → awaited directly
      // We make the object returned by .eq() both directly awaitable (for the awards
      // SELECT) and expose .not() (for the hot-takes SELECT).
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => {
            const eqResult = {
              not: vi.fn().mockResolvedValue(hotTakesSelect),
              then: (
                onFulfilled: (v: Mock) => unknown,
                onRejected?: (err: unknown) => unknown,
              ) => Promise.resolve(votesSelect).then(onFulfilled, onRejected),
            };
            return eqResult;
          }),
        })),
      };
    }
    if (table === "room_awards") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue(awardsSelect),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { supabase: { from } as unknown as LoadResultsDeps["supabase"] };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<LoadResultsDeps> = {},
): LoadResultsDeps {
  return {
    supabase: mock.supabase,
    fetchContestants: vi.fn(async () => THREE_CONTESTANTS),
    fetchContestantsMeta: vi.fn(async () => ({ broadcastStartUtc: null })),
    ...overrides,
  };
}

// ─── input validation + room load ────────────────────────────────────────────

describe("loadResults — input validation & room load", () => {
  it("rejects non-UUID roomId with 400 INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await loadResults(
      { roomId: "not-a-uuid" },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelect: { data: null, error: null },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 500 INTERNAL_ERROR when rooms SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelect: { data: null, error: { message: "db" } },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

// ─── lobby ───────────────────────────────────────────────────────────────────

describe("loadResults — lobby", () => {
  it("returns { pin, broadcastStartUtc } when meta is available", async () => {
    const mock = makeSupabaseMock();
    const fetchMeta = vi.fn(async () => ({
      broadcastStartUtc: "2026-05-16T19:00:00Z",
    }));
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock, { fetchContestantsMeta: fetchMeta }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "lobby",
        pin: "AAAAAA",
        broadcastStartUtc: "2026-05-16T19:00:00Z",
      },
    });
  });

  it("tolerates ContestDataError from fetchContestantsMeta — broadcastStartUtc=null", async () => {
    const mock = makeSupabaseMock();
    const fetchMeta = vi.fn(async () => {
      throw new ContestDataError("no data");
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock, { fetchContestantsMeta: fetchMeta }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: { status: "lobby", broadcastStartUtc: null },
    });
  });
});

// ─── voting / voting_ending / scoring placeholders ───────────────────────────

describe("loadResults — placeholder statuses", () => {
  it.each(["voting", "voting_ending"] as const)(
    "returns { status, pin } for %s",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelect: {
          data: {
            id: VALID_ROOM_ID,
            status,
            pin: "PINPIN",
            year: 2026,
            event: "final",
          },
          error: null,
        },
      });
      const result = await loadResults(
        { roomId: VALID_ROOM_ID },
        makeDeps(mock),
      );
      expect(result).toMatchObject({
        ok: true,
        data: { status, pin: "PINPIN" },
      });
    },
  );

  it("returns bare { status: 'scoring' } for scoring", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "scoring",
          pin: "PP",
          year: 2026,
          event: "final",
        },
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({ ok: true, data: { status: "scoring" } });
  });
});

// ─── announcing ──────────────────────────────────────────────────────────────

describe("loadResults — announcing", () => {
  const announcingRoom = {
    data: {
      id: VALID_ROOM_ID,
      status: "announcing",
      pin: "PINPIN",
      year: 2026,
      event: "final",
    },
    error: null,
  };

  it("returns leaderboard with every contestant at 0 pts when no announced=true rows exist", async () => {
    const mock = makeSupabaseMock({
      roomSelect: announcingRoom,
      resultsSelect: { data: [], error: null },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.data.status !== "announcing") throw new Error("wrong status");
    expect(result.data.leaderboard).toHaveLength(3);
    expect(result.data.leaderboard.every((e) => e.totalPoints === 0)).toBe(true);
    // Contestants list forwarded for client-side flag/country rendering.
    expect(result.data.contestants).toEqual(THREE_CONTESTANTS);
  });

  it("sums only announced=true rows", async () => {
    const mock = makeSupabaseMock({
      roomSelect: announcingRoom,
      resultsSelect: {
        data: [
          {
            user_id: "u-1",
            contestant_id: "2026-al",
            points_awarded: 12,
            announced: true,
          },
          {
            user_id: "u-2",
            contestant_id: "2026-al",
            points_awarded: 10,
            announced: true,
          },
          // Note: the mock only returns what the test provided; the .eq('announced', true)
          // filter is not re-simulated here. This test asserts that the SUM reflects
          // the rows returned.
        ],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    const al = result.data.leaderboard.find((e) => e.contestantId === "2026-al");
    expect(al).toMatchObject({ totalPoints: 22, rank: 1 });
  });

  it("returns 500 when the results SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelect: announcingRoom,
      resultsSelect: { data: null, error: { message: "db" } },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns announcement: null when announcing_user_id is missing (no eligible announcers)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: announcingRoom, // no announcing_user_id field → null path
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcement).toBeNull();
  });

  it("populates announcement state with announcer + pendingReveal when announcing_user_id is set", async () => {
    const announcerUserId = "30000000-0000-4000-8000-000000000003";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom.data,
          announcing_user_id: announcerUserId,
          current_announce_idx: 1,
          announcement_order: [announcerUserId],
        },
        error: null,
      },
      announcerUser: {
        data: { display_name: "Alice", avatar_seed: "alice-seed" },
        error: null,
      },
      announcerQueue: {
        data: [
          { contestant_id: "2026-cr", points_awarded: 6 },
          { contestant_id: "2026-be", points_awarded: 8 },
          { contestant_id: "2026-al", points_awarded: 12 },
        ],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcement).toEqual({
      announcingUserId: announcerUserId,
      announcingDisplayName: "Alice",
      announcingAvatarSeed: "alice-seed",
      currentAnnounceIdx: 1,
      pendingReveal: { contestantId: "2026-be", points: 8 },
      queueLength: 3,
      delegateUserId: null,
      announcerPosition: 1,
      announcerCount: 1,
      skippedUserIds: [],
    });
  });

  // TODO #10 (slice A) — announcerOwnBreakdown gating.
  it("populates announcerOwnBreakdown when callerUserId matches the active announcer", async () => {
    const announcerUserId = "30000000-0000-4000-8000-000000000003";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom.data,
          announcing_user_id: announcerUserId,
          current_announce_idx: 0,
          announcement_order: [announcerUserId],
        },
        error: null,
      },
      announcerUser: {
        data: { display_name: "Alice", avatar_seed: "alice-seed" },
        error: null,
      },
      announcerQueue: {
        data: [
          { contestant_id: "2026-cr", points_awarded: 6 },
          { contestant_id: "2026-be", points_awarded: 8 },
          { contestant_id: "2026-al", points_awarded: 12 },
        ],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID, callerUserId: announcerUserId },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcerOwnBreakdown).toEqual({
      userId: announcerUserId,
      displayName: "Alice",
      avatarSeed: "alice-seed",
      picks: [
        { contestantId: "2026-cr", pointsAwarded: 6 },
        { contestantId: "2026-be", pointsAwarded: 8 },
        { contestantId: "2026-al", pointsAwarded: 12 },
      ],
    });
  });

  it("omits announcerOwnBreakdown (null) when callerUserId does not match the announcer (spoiler-safe)", async () => {
    const announcerUserId = "30000000-0000-4000-8000-000000000003";
    const watcherUserId = "40000000-0000-4000-8000-000000000004";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom.data,
          announcing_user_id: announcerUserId,
          current_announce_idx: 0,
          announcement_order: [announcerUserId],
        },
        error: null,
      },
      announcerUser: {
        data: { display_name: "Alice", avatar_seed: "alice-seed" },
        error: null,
      },
      announcerQueue: {
        data: [{ contestant_id: "2026-al", points_awarded: 12 }],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID, callerUserId: watcherUserId },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcerOwnBreakdown).toBeNull();
  });

  it("omits announcerOwnBreakdown when callerUserId is not provided (default safe)", async () => {
    const announcerUserId = "30000000-0000-4000-8000-000000000003";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom.data,
          announcing_user_id: announcerUserId,
          current_announce_idx: 0,
          announcement_order: [announcerUserId],
        },
        error: null,
      },
      announcerUser: {
        data: { display_name: "Alice", avatar_seed: "alice-seed" },
        error: null,
      },
      announcerQueue: {
        data: [{ contestant_id: "2026-al", points_awarded: 12 }],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID }, // no callerUserId
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcerOwnBreakdown).toBeNull();
  });

  it("computes announcerPosition + announcerCount from announcement_order", async () => {
    const ANN_1 = "30000000-0000-4000-8000-000000000003";
    const ANN_2 = "30000000-0000-4000-8000-000000000004";
    const ANN_3 = "30000000-0000-4000-8000-000000000005";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom.data,
          announcing_user_id: ANN_2, // second of three
          current_announce_idx: 0,
          announcement_order: [ANN_1, ANN_2, ANN_3],
        },
        error: null,
      },
      announcerUser: {
        data: { display_name: "Bob", avatar_seed: "bob" },
        error: null,
      },
      announcerQueue: {
        data: [{ contestant_id: "2026-al", points_awarded: 12 }],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcement?.announcerPosition).toBe(2);
    expect(result.data.announcement?.announcerCount).toBe(3);
  });

  it("exposes delegateUserId when admin has taken control via handoff", async () => {
    const announcerUserId = "30000000-0000-4000-8000-000000000003";
    const ownerUserId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom.data,
          announcing_user_id: announcerUserId,
          current_announce_idx: 0,
          announcement_order: [announcerUserId],
          delegate_user_id: ownerUserId,
        },
        error: null,
      },
      announcerUser: {
        data: { display_name: "Alice", avatar_seed: "alice-seed" },
        error: null,
      },
      announcerQueue: {
        data: [{ contestant_id: "2026-al", points_awarded: 12 }],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcement?.delegateUserId).toBe(ownerUserId);
    // The "active" announcer (the one who taps) is the delegate, but the
    // record-of-record announcer remains the original.
    expect(result.data.announcement?.announcingUserId).toBe(announcerUserId);
  });

  it("returns pendingReveal: null when current_announce_idx is past the queue (transitional)", async () => {
    const announcerUserId = "40000000-0000-4000-8000-000000000004";
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          ...announcingRoom.data,
          announcing_user_id: announcerUserId,
          current_announce_idx: 99,
          announcement_order: [announcerUserId],
        },
        error: null,
      },
      announcerUser: {
        data: { display_name: "Bob", avatar_seed: "bob-seed" },
        error: null,
      },
      announcerQueue: {
        data: [{ contestant_id: "2026-al", points_awarded: 12 }],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "announcing") return;
    expect(result.data.announcement?.pendingReveal).toBeNull();
    expect(result.data.announcement?.queueLength).toBe(1);
  });

  it("returns 500 when fetchContestants throws ContestDataError", async () => {
    const mock = makeSupabaseMock({ roomSelect: announcingRoom });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock, {
        fetchContestants: vi.fn(async () => {
          throw new ContestDataError("no data");
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

// ─── done ────────────────────────────────────────────────────────────────────

describe("loadResults — done", () => {
  const DONE_ROOM_OWNER_ID = "u-owner";
  const doneRoom = {
    data: {
      id: VALID_ROOM_ID,
      status: "done",
      pin: "PIN123",
      year: 2026,
      event: "final" as EventType,
      owner_user_id: DONE_ROOM_OWNER_ID,
    },
    error: null,
  };

  const TWO_USER_MEMBERS = [
    {
      user_id: "u-1",
      users: { display_name: "Alice", avatar_seed: "seed-a" },
    },
    {
      user_id: "u-2",
      users: { display_name: "Bob", avatar_seed: "seed-b" },
    },
  ];

  const TWO_USER_RESULTS = [
    // u-1's picks: AL=12, BE=10, CR=8
    {
      user_id: "u-1",
      contestant_id: "2026-al",
      points_awarded: 12,
      announced: true,
    },
    {
      user_id: "u-1",
      contestant_id: "2026-be",
      points_awarded: 10,
      announced: true,
    },
    {
      user_id: "u-1",
      contestant_id: "2026-cr",
      points_awarded: 8,
      announced: true,
    },
    // u-2's picks: BE=12, AL=10, CR=8
    {
      user_id: "u-2",
      contestant_id: "2026-be",
      points_awarded: 12,
      announced: true,
    },
    {
      user_id: "u-2",
      contestant_id: "2026-al",
      points_awarded: 10,
      announced: true,
    },
    {
      user_id: "u-2",
      contestant_id: "2026-cr",
      points_awarded: 8,
      announced: true,
    },
  ];

  it("returns full payload with leaderboard, breakdowns, hot takes, awards", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      resultsSelect: { data: TWO_USER_RESULTS, error: null },
      membershipsSelect: { data: TWO_USER_MEMBERS, error: null },
      hotTakesSelect: {
        data: [
          {
            user_id: "u-1",
            contestant_id: "2026-al",
            hot_take: "Pure fire.",
            hot_take_edited_at: "2026-04-25T08:00:00.000Z",
          },
          {
            user_id: "u-2",
            contestant_id: "2026-be",
            hot_take: "  ", // whitespace-only → filtered out
            hot_take_edited_at: null,
          },
        ],
        error: null,
      },
      awardsSelect: {
        data: [
          {
            room_id: VALID_ROOM_ID,
            award_key: "harshest_critic",
            award_name: "Harshest critic",
            winner_user_id: "u-1",
            winner_contestant_id: null,
            stat_value: 4.2,
            stat_label: "avg 4.2 / 10",
          },
        ],
        error: null,
      },
    });

    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") throw new Error("status");

    // Leaderboard: AL=22, BE=22 → tied rank 1; CR=16 → rank 3.
    expect(result.data.leaderboard).toEqual([
      { contestantId: "2026-al", totalPoints: 22, rank: 1 },
      { contestantId: "2026-be", totalPoints: 22, rank: 1 },
      { contestantId: "2026-cr", totalPoints: 16, rank: 3 },
    ]);

    // Breakdowns: sorted alphabetically by displayName; each user's picks sorted desc.
    expect(result.data.breakdowns).toHaveLength(2);
    expect(result.data.breakdowns[0].displayName).toBe("Alice");
    expect(result.data.breakdowns[0].picks).toEqual([
      { contestantId: "2026-al", pointsAwarded: 12 },
      { contestantId: "2026-be", pointsAwarded: 10 },
      { contestantId: "2026-cr", pointsAwarded: 8 },
    ]);
    expect(result.data.breakdowns[1].displayName).toBe("Bob");

    // Hot takes: whitespace-only filtered, real one kept. The non-null
    // edited_at flows through so the results-page UI can render the
    // "edited" tag per §8.7.1.
    expect(result.data.hotTakes).toEqual([
      {
        userId: "u-1",
        displayName: "Alice",
        avatarSeed: "seed-a",
        contestantId: "2026-al",
        hotTake: "Pure fire.",
        hotTakeEditedAt: "2026-04-25T08:00:00.000Z",
      },
    ]);

    // Awards forwarded.
    expect(result.data.awards).toHaveLength(1);
    expect(result.data.awards[0]).toMatchObject({
      awardKey: "harshest_critic",
      winnerUserId: "u-1",
      statValue: 4.2,
    });

    // Phase U country drill-down: per-contestant inversion of breakdowns.
    // AL got 12 from Alice + 10 from Bob; BE got 12 from Bob + 10 from Alice;
    // CR got 8 from each. Within a contestant: points desc, then displayName.
    const albania = result.data.contestantBreakdowns.find(
      (b) => b.contestantId === "2026-al",
    );
    expect(albania).toBeDefined();
    expect(albania!.gives.map((g) => g.pointsAwarded)).toEqual([12, 10]);
    expect(albania!.gives[0].displayName).toBe("Alice");
    const croatia = result.data.contestantBreakdowns.find(
      (b) => b.contestantId === "2026-cr",
    );
    expect(croatia!.gives.map((g) => g.displayName)).toEqual(["Alice", "Bob"]);
  });

  it("excludes 0-point rows from breakdowns (ranks 11+)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      resultsSelect: {
        data: [
          {
            user_id: "u-1",
            contestant_id: "2026-al",
            points_awarded: 12,
            announced: true,
          },
          {
            user_id: "u-1",
            contestant_id: "2026-be",
            points_awarded: 0,
            announced: true,
          },
          {
            user_id: "u-1",
            contestant_id: "2026-cr",
            points_awarded: 0,
            announced: true,
          },
        ],
        error: null,
      },
      membershipsSelect: {
        data: [TWO_USER_MEMBERS[0]],
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") return;
    expect(result.data.breakdowns[0].picks).toEqual([
      { contestantId: "2026-al", pointsAwarded: 12 },
    ]);
  });

  it("returns 500 when hot-takes SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      resultsSelect: { data: TWO_USER_RESULTS, error: null },
      membershipsSelect: { data: TWO_USER_MEMBERS, error: null },
      hotTakesSelect: { data: null, error: { message: "db" } },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns 500 when awards SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      resultsSelect: { data: TWO_USER_RESULTS, error: null },
      membershipsSelect: { data: TWO_USER_MEMBERS, error: null },
      awardsSelect: { data: null, error: { message: "db" } },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns empty awards + breakdowns + hotTakes when the room has no activity yet", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") return;
    expect(result.data.breakdowns).toEqual([]);
    expect(result.data.contestantBreakdowns).toEqual([]);
    expect(result.data.hotTakes).toEqual([]);
    expect(result.data.awards).toEqual([]);
    // Leaderboard still includes every contestant at 0.
    expect(result.data.leaderboard).toEqual([
      { contestantId: "2026-al", totalPoints: 0, rank: 1 },
      { contestantId: "2026-be", totalPoints: 0, rank: 1 },
      { contestantId: "2026-cr", totalPoints: 0, rank: 1 },
    ]);
  });

  it("attaches voteDetails to the done payload joining votes.scores with results.points_awarded", async () => {
    const sb = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "done",
          pin: "AAAAAA",
          year: 2026,
          event: "final",
          owner_user_id: "owner-1",
          categories: [{ name: "Vocals", weight: 1, key: "vocals" }],
          announcement_order: null,
          announcing_user_id: null,
          current_announce_idx: null,
          delegate_user_id: null,
          announce_skipped_user_ids: null,
        },
        error: null,
      },
      resultsSelect: {
        data: [
          { user_id: "u1", contestant_id: "2026-al", points_awarded: 12, announced: true },
          { user_id: "u1", contestant_id: "2026-be", points_awarded: 0, announced: true },
        ],
        error: null,
      },
      membershipsSelect: {
        data: [{ user_id: "u1", users: { display_name: "Alice", avatar_seed: "alice" } }],
        error: null,
      },
      hotTakesSelect: {
        data: [
          { user_id: "u1", contestant_id: "2026-al", hot_take: "Yes!", hot_take_edited_at: null },
        ],
        error: null,
      },
      votesSelect: {
        data: [
          { user_id: "u1", contestant_id: "2026-al", scores: { vocals: 10 }, missed: false },
          { user_id: "u1", contestant_id: "2026-be", scores: { vocals: 4 }, missed: false },
        ],
        error: null,
      },
    });

    const result = await loadResults({ roomId: VALID_ROOM_ID }, makeDeps(sb));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") throw new Error("expected done");

    expect(result.data.categories).toEqual([{ name: "Vocals", weight: 1, key: "vocals" }]);

    expect(result.data.voteDetails).toEqual([
      {
        userId: "u1",
        contestantId: "2026-al",
        scores: { vocals: 10 },
        missed: false,
        pointsAwarded: 12,
        hotTake: "Yes!",
        hotTakeEditedAt: null,
      },
      {
        userId: "u1",
        contestantId: "2026-be",
        scores: { vocals: 4 },
        missed: false,
        pointsAwarded: 0,
        hotTake: null,
        hotTakeEditedAt: null,
      },
    ]);
  });
});

// ─── unknown status ──────────────────────────────────────────────────────────

describe("loadResults — unknown/forward-compat status", () => {
  it("falls back to 'voting' placeholder on an unknown status string", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: {
          id: VALID_ROOM_ID,
          status: "future_status_we_havent_shipped",
          pin: "PP",
          year: 2026,
          event: "final",
        },
        error: null,
      },
    });
    const result = await loadResults(
      { roomId: VALID_ROOM_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: true,
      data: { status: "voting", pin: "PP" },
    });
  });
});

// ─── done — personalNeighbours ─────────────────────────────────────────
// (`vi`, `describe`, `it`, `expect` already imported at top of file)

describe("loadResults — done personalNeighbours", () => {
  const ROOM_ID = "11111111-2222-4333-8444-555555555555";
  const OWNER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const ALICE = "11111111-2222-4333-8444-000000000001";
  const BOB = "22222222-3333-4444-8555-000000000002";
  const CAROL = "33333333-4444-4555-8666-000000000003";

  const doneRoom = {
    data: {
      id: ROOM_ID,
      status: "done",
      pin: "DONEEE",
      year: 2026,
      event: "final",
      owner_user_id: OWNER,
    },
    error: null,
  };

  const memberships = {
    data: [
      { user_id: ALICE, users: { display_name: "Alice", avatar_seed: "alice" } },
      { user_id: BOB, users: { display_name: "Bob", avatar_seed: "bob" } },
      { user_id: CAROL, users: { display_name: "Carol", avatar_seed: "carol" } },
    ],
    error: null,
  };

  it("attaches personalNeighbours array on the done payload", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      membershipsSelect: memberships,
      resultsSelect: { data: [], error: null },
      awardsSelect: { data: [], error: null },
    });
    const result = await loadResults({ roomId: ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") return;
    expect(Array.isArray(result.data.personalNeighbours)).toBe(true);
  });

  it("returns empty personalNeighbours when there are <3 voters with signal", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      membershipsSelect: memberships,
      resultsSelect: { data: [], error: null },
      awardsSelect: { data: [], error: null },
    });
    const result = await loadResults({ roomId: ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") return;
    expect(result.data.personalNeighbours).toEqual([]);
  });

  it("produces correct PersonalNeighbour entries when 3 voters have non-trivial scores", async () => {
    // Score pattern chosen so Alice and Carol have identical mean vectors →
    // they are each other's nearest neighbour (reciprocal pair, Pearson = 1).
    // Bob is the contrarian; his two candidates (Alice, Carol) share the same
    // correlation, so the alphabetical tie-break picks Alice.
    //
    //   Alice: AL=[10,9]→9.5, BE=[2,3]→2.5, CR=[7,6]→6.5
    //   Bob:   AL=[2,1]→1.5,  BE=[9,10]→9.5, CR=[4,5]→4.5
    //   Carol: AL=[9,10]→9.5, BE=[3,2]→2.5,  CR=[6,7]→6.5
    const doneRoomWithCategories = {
      data: {
        ...doneRoom.data,
        categories: [
          { name: "Vocals", weight: 1, key: "vocals" },
          { name: "Outfit", weight: 1, key: "outfit" },
        ],
      },
      error: null,
    };

    const votesSelect = {
      data: [
        // Alice
        { user_id: ALICE, contestant_id: "2026-al", scores: { Vocals: 10, Outfit: 9 }, missed: false },
        { user_id: ALICE, contestant_id: "2026-be", scores: { Vocals: 2, Outfit: 3 }, missed: false },
        { user_id: ALICE, contestant_id: "2026-cr", scores: { Vocals: 7, Outfit: 6 }, missed: false },
        // Bob
        { user_id: BOB, contestant_id: "2026-al", scores: { Vocals: 2, Outfit: 1 }, missed: false },
        { user_id: BOB, contestant_id: "2026-be", scores: { Vocals: 9, Outfit: 10 }, missed: false },
        { user_id: BOB, contestant_id: "2026-cr", scores: { Vocals: 4, Outfit: 5 }, missed: false },
        // Carol
        { user_id: CAROL, contestant_id: "2026-al", scores: { Vocals: 9, Outfit: 10 }, missed: false },
        { user_id: CAROL, contestant_id: "2026-be", scores: { Vocals: 3, Outfit: 2 }, missed: false },
        { user_id: CAROL, contestant_id: "2026-cr", scores: { Vocals: 6, Outfit: 7 }, missed: false },
      ],
      error: null,
    };

    const mock = makeSupabaseMock({
      roomSelect: doneRoomWithCategories,
      membershipsSelect: memberships,
      resultsSelect: { data: [], error: null },
      awardsSelect: { data: [], error: null },
      votesSelect,
    });

    const result = await loadResults({ roomId: ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") return;

    const pn = result.data.personalNeighbours;

    // One entry per signal-bearing voter.
    expect(pn).toHaveLength(3);

    // Every entry has the correct PersonalNeighbour shape.
    for (const entry of pn) {
      expect(typeof entry.userId).toBe("string");
      expect(typeof entry.neighbourUserId).toBe("string");
      expect(typeof entry.pearson).toBe("number");
      expect(typeof entry.isReciprocal).toBe("boolean");
    }

    // Alice's nearest neighbour is Carol (identical vectors → Pearson = 1).
    const aliceEntry = pn.find((e) => e.userId === ALICE);
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry!.neighbourUserId).toBe(CAROL);

    // Alice ↔ Carol are a reciprocal pair.
    const carolEntry = pn.find((e) => e.userId === CAROL);
    expect(carolEntry).toBeDefined();
    expect(carolEntry!.neighbourUserId).toBe(ALICE);
    expect(aliceEntry!.isReciprocal).toBe(true);
    expect(carolEntry!.isReciprocal).toBe(true);
  });
});
