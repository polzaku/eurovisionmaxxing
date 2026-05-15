import { describe, it, expect, vi } from "vitest";
import { upsertVote, type UpsertVoteDeps } from "@/lib/votes/upsert";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "voting",
  categories: [
    { name: "Vocals", weight: 1 },
    { name: "Staging", weight: 1 },
  ],
};

const defaultMembership = { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID };

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  membershipSelectResult?: { data: unknown; error: { message: string } | null };
  existingVoteSelectResult?: { data: unknown; error: { message: string } | null };
  voteUpsertResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const membershipSelectResult =
    opts.membershipSelectResult ?? { data: defaultMembership, error: null };
  const existingVoteSelectResult =
    opts.existingVoteSelectResult ?? { data: null, error: null };
  const voteUpsertResult =
    opts.voteUpsertResult ??
    {
      data: {
        id: "cccccccc-dddd-4eee-8fff-111111111111",
        room_id: VALID_ROOM_ID,
        user_id: VALID_USER_ID,
        contestant_id: VALID_CONTESTANT_ID,
        scores: null,
        missed: false,
        hot_take: null,
        hot_take_edited_at: null,
        updated_at: "2026-04-21T12:00:00Z",
      },
      error: null,
    };

  const upsertPayloads: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<Record<string, unknown> | undefined> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
          })),
        })),
      };
    }
    if (table === "room_memberships") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(membershipSelectResult),
            })),
          })),
        })),
      };
    }
    if (table === "votes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue(existingVoteSelectResult),
              })),
            })),
          })),
        })),
        upsert: vi.fn((payload: Record<string, unknown>, options?: Record<string, unknown>) => {
          upsertPayloads.push(payload);
          upsertOptions.push(options);
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue(voteUpsertResult),
            })),
          };
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as UpsertVoteDeps["supabase"],
    upsertPayloads,
    upsertOptions,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpsertVoteDeps> = {}
): UpsertVoteDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("upsertVote — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const broadcast = vi.fn();
    const result = await upsertVote(
      {
        roomId: "not-a-uuid",
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.upsertPayloads).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        {
          roomId: VALID_ROOM_ID,
          userId,
          contestantId: VALID_CONTESTANT_ID,
        },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );

  it.each([
    undefined,
    null,
    42,
    "",
    "2026",
    "2026-",
    "2026-united-kingdom",
    "2026-GB",
    "26-gb",
    "2026-g",
    "2026-gbr",
  ])(
    "rejects bad contestantId (%s) with INVALID_CONTESTANT_ID",
    async (contestantId) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, contestantId },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_CONTESTANT_ID", field: "contestantId" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );
});

describe("upsertVote — body shape validation", () => {
  const baseInput = {
    roomId: VALID_ROOM_ID,
    userId: VALID_USER_ID,
    contestantId: VALID_CONTESTANT_ID,
  };

  it("rejects non-object scores with INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, scores: "not-an-object" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "scores" },
    });
    expect(mock.upsertPayloads).toEqual([]);
  });

  it.each([0, 11, 5.5, -1, "7", NaN])(
    "rejects score value %s with INVALID_BODY",
    async (bad) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        { ...baseInput, scores: { Vocals: bad } },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_BODY", field: "scores.Vocals" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );

  // TODO #1 — the ScoreRow reducer (`nextScore`) treats a re-tap on the
  // currently-selected score button as a retract → emits `null`. The
  // Autosaver forwards that through the wire as `scores: { Cat: null }`.
  // The server previously rejected null with INVALID_BODY → the voting
  // card flashed "Save failed" on every retract. Null is now a valid
  // retract signal: the server accepts it and the merge step deletes
  // that category from the existing JSONB row.
  it("accepts null score value (retract) — does not return INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, scores: { Vocals: null } },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
  });

  it("rejects score key not present in rooms.categories with INVALID_CATEGORY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, scores: { NotACategory: 7 } },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_CATEGORY", field: "scores.NotACategory" },
    });
    expect(mock.upsertPayloads).toEqual([]);
  });

  it.each(["yes", 1, []])(
    "rejects non-boolean missed (%s) with INVALID_BODY",
    async (bad) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        { ...baseInput, missed: bad },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_BODY", field: "missed" },
      });
    }
  );

  it("rejects non-string, non-null hotTake with INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, hotTake: 42 },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "hotTake" },
    });
  });

  it("rejects hotTake longer than 140 chars with INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, hotTake: "x".repeat(141) },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "hotTake" },
    });
  });
});

describe("upsertVote — happy path", () => {
  const baseInput = {
    roomId: VALID_ROOM_ID,
    userId: VALID_USER_ID,
    contestantId: VALID_CONTESTANT_ID,
  };

  it("first write (no existing row): UPSERTs with scores, returns vote + scoredCount", async () => {
    const persisted = {
      id: "dddddddd-eeee-4fff-8000-111111111111",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 9 },
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await upsertVote(
      {
        ...baseInput,
        scores: { Vocals: 7, Staging: 9 },
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vote).toMatchObject({
      roomId: VALID_ROOM_ID,
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 9 },
      missed: false,
      hotTake: null,
    });
    expect(result.scoredCount).toBe(2);

    expect(mock.upsertPayloads).toHaveLength(1);
    expect(mock.upsertPayloads[0]).toMatchObject({
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 9 },
      missed: false,
      hot_take: null,
    });
    expect(mock.upsertOptions[0]).toMatchObject({
      onConflict: "room_id,user_id,contestant_id",
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "voting_progress",
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scoredCount: 2,
    });
  });

  it("empty body (just identity fields): upserts empty row, broadcasts scoredCount=0", async () => {
    const persisted = {
      id: "eeeeeeee-ffff-4000-8111-222222222222",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: {},
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await upsertVote(baseInput, makeDeps(mock, { broadcastRoomEvent: broadcast }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoredCount).toBe(0);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "voting_progress",
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scoredCount: 0,
    });
  });

  it("returns 500 INTERNAL_ERROR when the UPSERT errors", async () => {
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: null, error: { message: "boom" } },
    });
    const result = await upsertVote(baseInput, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("retract: scores: { X: null } removes X from existing merged scores", async () => {
    // TODO #1 — the autosave round-trip when the user re-taps the
    // selected score button must drop that category from the persisted
    // JSONB and update scoredCount accordingly. Other categories stay.
    const existing = {
      scores: { Vocals: 7, Staging: 5 },
      missed: false,
      hot_take: null,
    };
    const persisted = {
      id: "ffffffff-1111-4222-8333-444444444444",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Staging: 5 },
      missed: false,
      hot_take: null,
      updated_at: "2026-05-15T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: null },
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.upsertPayloads[0]).toMatchObject({
      // Vocals is *gone*, not present-with-null.
      scores: { Staging: 5 },
    });
    expect((mock.upsertPayloads[0].scores as Record<string, unknown>).Vocals)
      .toBeUndefined();
    expect(result.scoredCount).toBe(1);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "voting_progress",
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scoredCount: 1,
    });
  });

  it("retract: retracting the last remaining score leaves an empty scores object", async () => {
    const existing = {
      scores: { Vocals: 7 },
      missed: false,
      hot_take: null,
    };
    const persisted = {
      id: "ffffffff-2222-4333-8444-555555555555",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: {},
      missed: false,
      hot_take: null,
      updated_at: "2026-05-15T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: null },
      },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.upsertPayloads[0]).toMatchObject({ scores: {} });
    expect(result.scoredCount).toBe(0);
  });

  it("merges partial scores into existing row (preserves untouched categories)", async () => {
    const existing = {
      scores: { Vocals: 5, Staging: 5 },
      missed: false,
      hot_take: "ok",
    };
    const persisted = {
      id: "ffffffff-0000-4111-8222-333333333333",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 9, Staging: 5 },
      missed: false,
      hot_take: "ok",
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: 9 }, // only Vocals this time
      },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.upsertPayloads[0]).toMatchObject({
      scores: { Vocals: 9, Staging: 5 },
      missed: false,
      hot_take: "ok",
    });
    expect(result.scoredCount).toBe(2);
  });

  it("missed: true → broadcasts scoredCount=0 even with scores present", async () => {
    const persisted = {
      id: "11111111-aaaa-4bbb-8ccc-222222222222",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 8 },
      missed: true,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        missed: true,
        scores: { Vocals: 7, Staging: 8 },
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoredCount).toBe(0);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "voting_progress",
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scoredCount: 0,
    });
  });

  it("omitting hotTake preserves existing hot_take", async () => {
    const existing = {
      scores: { Vocals: 5 },
      missed: false,
      hot_take: "keep me",
    };
    const persisted = {
      id: "22222222-bbbb-4ccc-8ddd-333333333333",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 9 },
      missed: false,
      hot_take: "keep me",
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: 9 },
      },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    expect(mock.upsertPayloads[0]).toMatchObject({ hot_take: "keep me" });
  });

  it("hotTake: null clears existing hot_take", async () => {
    const existing = {
      scores: {},
      missed: false,
      hot_take: "gone soon",
    };
    const persisted = {
      id: "33333333-cccc-4ddd-8eee-444444444444",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: {},
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        hotTake: null,
      },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    expect(mock.upsertPayloads[0]).toMatchObject({ hot_take: null });
  });

  it("commits the DB write even when the broadcast throws (logs warning)", async () => {
    const persisted = {
      id: "44444444-dddd-4eee-8fff-555555555555",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 4 },
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi
      .fn()
      .mockRejectedValue(new Error("ws closed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await upsertVote(
        {
          roomId: VALID_ROOM_ID,
          userId: VALID_USER_ID,
          contestantId: VALID_CONTESTANT_ID,
          scores: { Vocals: 4 },
        },
        makeDeps(mock, { broadcastRoomEvent: broadcast })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.scoredCount).toBe(1);
      expect(mock.upsertPayloads).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("upsertVote — room & membership guards", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const broadcast = vi.fn();
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.upsertPayloads).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("returns 404 ROOM_NOT_FOUND when the room SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: { message: "db boom" } },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 403 FORBIDDEN when caller is not a room member", async () => {
    const mock = makeSupabaseMock({
      membershipSelectResult: { data: null, error: null },
    });
    const broadcast = vi.fn();
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(mock.upsertPayloads).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(["lobby", "scoring", "announcing", "done"])(
    "returns 409 ROOM_NOT_VOTING when room status is %s",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: { ...defaultRoomRow, status },
          error: null,
        },
      });
      const result = await upsertVote(
        {
          roomId: VALID_ROOM_ID,
          userId: VALID_USER_ID,
          contestantId: VALID_CONTESTANT_ID,
        },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_VOTING" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );
});

// ─── §8.7.1 hot-take edit detection ─────────────────────────────────────────

describe("upsertVote — hot_take_edited_at semantics (§8.7.1)", () => {
  it("first hot-take save (no previous content) does NOT stamp edited_at", async () => {
    const mock = makeSupabaseMock({
      existingVoteSelectResult: {
        data: { scores: null, missed: false, hot_take: null, hot_take_edited_at: null },
        error: null,
      },
    });
    await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        hotTake: "Iconic opening",
      },
      makeDeps(mock),
    );
    expect(mock.upsertPayloads[0]).toMatchObject({
      hot_take: "Iconic opening",
      hot_take_edited_at: null,
    });
  });

  it("editing an existing hot-take (different content) stamps edited_at to now", async () => {
    const mock = makeSupabaseMock({
      existingVoteSelectResult: {
        data: {
          scores: null,
          missed: false,
          hot_take: "Old take",
          hot_take_edited_at: null,
        },
        error: null,
      },
    });
    await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        hotTake: "New take",
      },
      makeDeps(mock),
    );
    const payload = mock.upsertPayloads[0];
    expect(payload.hot_take).toBe("New take");
    // Stamped to a non-null ISO string (now()).
    expect(payload.hot_take_edited_at).toEqual(expect.any(String));
    expect(typeof payload.hot_take_edited_at).toBe("string");
    expect(
      Number.isFinite(Date.parse(payload.hot_take_edited_at as string)),
    ).toBe(true);
  });

  it("re-saving identical content preserves the existing edited_at (no re-stamp)", async () => {
    const ORIGINAL_EDITED_AT = "2026-04-25T08:00:00.000Z";
    const mock = makeSupabaseMock({
      existingVoteSelectResult: {
        data: {
          scores: null,
          missed: false,
          hot_take: "Stable text",
          hot_take_edited_at: ORIGINAL_EDITED_AT,
        },
        error: null,
      },
    });
    await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        hotTake: "Stable text",
      },
      makeDeps(mock),
    );
    expect(mock.upsertPayloads[0]).toMatchObject({
      hot_take: "Stable text",
      hot_take_edited_at: ORIGINAL_EDITED_AT,
    });
  });

  it("deletion (hotTake=null) clears edited_at per §8.7.2", async () => {
    const mock = makeSupabaseMock({
      existingVoteSelectResult: {
        data: {
          scores: null,
          missed: false,
          hot_take: "About to be deleted",
          hot_take_edited_at: "2026-04-25T08:00:00.000Z",
        },
        error: null,
      },
    });
    await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        hotTake: null,
      },
      makeDeps(mock),
    );
    expect(mock.upsertPayloads[0]).toMatchObject({
      hot_take: null,
      hot_take_edited_at: null,
    });
  });

  it("save WITHOUT touching hot_take preserves both hot_take and edited_at", async () => {
    // Caller updates only `scores`; hot_take + edited_at must round-trip
    // unchanged. This protects against an autosave that flips the chip
    // off when the user wasn't editing the hot-take.
    const ORIGINAL_EDITED_AT = "2026-04-25T08:00:00.000Z";
    const mock = makeSupabaseMock({
      existingVoteSelectResult: {
        data: {
          scores: { Vocals: 5 },
          missed: false,
          hot_take: "Untouched",
          hot_take_edited_at: ORIGINAL_EDITED_AT,
        },
        error: null,
      },
    });
    await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Staging: 7 },
      },
      makeDeps(mock),
    );
    expect(mock.upsertPayloads[0]).toMatchObject({
      hot_take: "Untouched",
      hot_take_edited_at: ORIGINAL_EDITED_AT,
    });
  });
});
