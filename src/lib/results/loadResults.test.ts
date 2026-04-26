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
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            not: vi.fn().mockResolvedValue(hotTakesSelect),
          })),
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
    });
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
  const doneRoom = {
    data: {
      id: VALID_ROOM_ID,
      status: "done",
      pin: "PIN123",
      year: 2026,
      event: "final" as EventType,
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
          },
          {
            user_id: "u-2",
            contestant_id: "2026-be",
            hot_take: "  ", // whitespace-only → filtered out
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

    // Hot takes: whitespace-only filtered, real one kept.
    expect(result.data.hotTakes).toEqual([
      {
        userId: "u-1",
        displayName: "Alice",
        avatarSeed: "seed-a",
        contestantId: "2026-al",
        hotTake: "Pure fire.",
      },
    ]);

    // Awards forwarded.
    expect(result.data.awards).toHaveLength(1);
    expect(result.data.awards[0]).toMatchObject({
      awardKey: "harshest_critic",
      winnerUserId: "u-1",
      statValue: 4.2,
    });
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
    expect(result.data.hotTakes).toEqual([]);
    expect(result.data.awards).toEqual([]);
    // Leaderboard still includes every contestant at 0.
    expect(result.data.leaderboard).toEqual([
      { contestantId: "2026-al", totalPoints: 0, rank: 1 },
      { contestantId: "2026-be", totalPoints: 0, rank: 1 },
      { contestantId: "2026-cr", totalPoints: 0, rank: 1 },
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
