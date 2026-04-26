import { describe, it, expect, vi } from "vitest";
import type { VotingCategory } from "@/types";
import { createRoom, type CreateRoomDeps } from "@/lib/rooms/create";

// ─── Test helpers ────────────────────────────────────────────────────────────

const validCategories: VotingCategory[] = [
  { name: "Vocals", weight: 1 },
  { name: "Staging", weight: 2 },
];

const validInput = {
  year: 2026,
  event: "final" as const,
  categories: validCategories,
  announcementMode: "instant" as const,
  allowNowPerforming: false,
  userId: "user-owner",
};

interface MockSupabaseOptions {
  /** Sequence of responses to consecutive `rooms` inserts. Defaults to a single success. */
  roomsInserts?: Array<{ data: unknown; error: { code?: string; message: string } | null }>;
  /** Response for the single `room_memberships` insert. */
  membershipsInsert?: { error: { message: string } | null };
  /** Response for a `rooms` delete (rollback). */
  roomsDelete?: { error: { message: string } | null };
}

function makeSupabaseMock(opts: MockSupabaseOptions = {}) {
  const roomsInserts = opts.roomsInserts ?? [
    { data: null, error: null }, // default: one success (caller supplies data shape if they care)
  ];
  let roomsInsertCallIdx = 0;

  const roomsInsertRows: unknown[] = [];
  const membershipsInsertRows: unknown[] = [];
  const roomsDeleteCalls: Array<{ column: string; value: unknown }> = [];

  const roomsInsertSpy = vi.fn((row: unknown) => {
    roomsInsertRows.push(row);
    const response = roomsInserts[roomsInsertCallIdx] ?? {
      data: null,
      error: { message: "no mock response configured" },
    };
    roomsInsertCallIdx += 1;
    const chain = {
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(response),
      })),
    };
    return chain;
  });

  const roomsDeleteSpy = vi.fn(() => ({
    eq: vi.fn((column: string, value: unknown) => {
      roomsDeleteCalls.push({ column, value });
      return Promise.resolve(opts.roomsDelete ?? { error: null });
    }),
  }));

  const membershipsInsertSpy = vi.fn((row: unknown) => {
    membershipsInsertRows.push(row);
    return Promise.resolve(opts.membershipsInsert ?? { error: null });
  });

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        insert: roomsInsertSpy,
        delete: roomsDeleteSpy,
      };
    }
    if (table === "room_memberships") {
      return { insert: membershipsInsertSpy };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as CreateRoomDeps["supabase"],
    from,
    roomsInsertSpy,
    membershipsInsertSpy,
    roomsDeleteSpy,
    roomsInsertRows,
    membershipsInsertRows,
    roomsDeleteCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<CreateRoomDeps> = {}
): CreateRoomDeps {
  return {
    supabase: mock.supabase,
    generateRoomId: () => "room-uuid-fixed",
    generatePin: (len: number) => "A".repeat(len),
    currentYear: () => 2026,
    maxShortPinRetries: 5,
    maxLongPinRetries: 5,
    ...overrides,
  };
}

/** Shape returned by supabase `insert().select().single()` — matches the `rooms` row. */
function rowFor(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "room-uuid-fixed",
      pin: "AAAAAA",
      year: 2026,
      event: "final",
      categories: validCategories,
      owner_user_id: "user-owner",
      status: "lobby",
      announcement_mode: "instant",
      announcement_order: null,
      announcing_user_id: null,
      current_announce_idx: 0,
      now_performing_id: null,
      allow_now_performing: false,
      created_at: "2026-04-19T12:00:00Z",
      ...overrides,
    },
    error: null,
  };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("createRoom — happy path", () => {
  it("returns the created room with generated id, pin, and lobby status", async () => {
    const mock = makeSupabaseMock({ roomsInserts: [rowFor()] });
    const deps = makeDeps(mock);

    const result = await createRoom(validInput, deps);

    expect(result).toEqual({
      ok: true,
      room: {
        id: "room-uuid-fixed",
        pin: "AAAAAA",
        year: 2026,
        event: "final",
        categories: validCategories,
        ownerUserId: "user-owner",
        status: "lobby",
        announcementMode: "instant",
        announcementOrder: null,
        announcingUserId: null,
        currentAnnounceIdx: 0,
        nowPerformingId: null,
        allowNowPerforming: false,
        createdAt: "2026-04-19T12:00:00Z",
      },
    });
  });

  it("inserts a row into rooms with snake_case columns matching the input", async () => {
    const mock = makeSupabaseMock({ roomsInserts: [rowFor()] });
    const deps = makeDeps(mock);

    await createRoom(validInput, deps);

    expect(mock.roomsInsertRows).toHaveLength(1);
    expect(mock.roomsInsertRows[0]).toMatchObject({
      id: "room-uuid-fixed",
      pin: "AAAAAA",
      year: 2026,
      event: "final",
      categories: validCategories,
      owner_user_id: "user-owner",
      announcement_mode: "instant",
      allow_now_performing: false,
    });
  });

  it("adds the owner to room_memberships", async () => {
    const mock = makeSupabaseMock({ roomsInserts: [rowFor()] });
    const deps = makeDeps(mock);

    await createRoom(validInput, deps);

    expect(mock.membershipsInsertRows).toEqual([
      { room_id: "room-uuid-fixed", user_id: "user-owner" },
    ]);
  });
});

// ─── Input-body validation ───────────────────────────────────────────────────

describe("createRoom — body validation", () => {
  it("rejects a non-string userId as INVALID_USER_ID without touching the DB", async () => {
    const mock = makeSupabaseMock();
    const deps = makeDeps(mock);

    const result = await createRoom({ ...validInput, userId: 42 }, deps);

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID" },
    });
    expect(mock.roomsInsertSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty userId as INVALID_USER_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom({ ...validInput, userId: "" }, makeDeps(mock));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_USER_ID" } });
  });

  it("rejects non-boolean allowNowPerforming as INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, allowNowPerforming: "yes" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_BODY" } });
  });
});

describe("createRoom — year validation", () => {
  it("rejects year below 2000 as INVALID_YEAR", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom({ ...validInput, year: 1999 }, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_YEAR", field: "year" },
    });
  });

  it("rejects year above currentYear as INVALID_YEAR", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, year: 2030 },
      makeDeps(mock, { currentYear: () => 2026 })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_YEAR" } });
  });

  it("rejects non-integer year as INVALID_YEAR", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom({ ...validInput, year: 2026.5 }, makeDeps(mock));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_YEAR" } });
  });

  it("rejects string year as INVALID_YEAR", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, year: "2026" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_YEAR" } });
  });

  it("accepts year 2000 (lower bound)", async () => {
    const mock = makeSupabaseMock({ roomsInserts: [rowFor({ year: 2000 })] });
    const result = await createRoom({ ...validInput, year: 2000 }, makeDeps(mock));
    expect(result).toMatchObject({ ok: true });
  });

  it("accepts year 9999 (test fixture) when NODE_ENV !== 'production'", async () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      const mock = makeSupabaseMock({ roomsInserts: [rowFor({ year: 9999 })] });
      const result = await createRoom(
        { ...validInput, year: 9999 },
        makeDeps(mock, { currentYear: () => 2026 })
      );
      expect(result).toMatchObject({ ok: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects year 9999 (test fixture) in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const mock = makeSupabaseMock();
      const result = await createRoom(
        { ...validInput, year: 9999 },
        makeDeps(mock, { currentYear: () => 2026 })
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_YEAR" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("createRoom — event validation", () => {
  it.each(["semi1", "semi2", "final"] as const)(
    "accepts event=%s",
    async (event) => {
      const mock = makeSupabaseMock({ roomsInserts: [rowFor({ event })] });
      const result = await createRoom({ ...validInput, event }, makeDeps(mock));
      expect(result).toMatchObject({ ok: true });
    }
  );

  it("rejects an unknown event as INVALID_EVENT", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom({ ...validInput, event: "quarter" }, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_EVENT", field: "event" },
    });
  });
});

describe("createRoom — announcementMode validation", () => {
  it.each(["live", "instant"] as const)(
    "accepts announcementMode=%s",
    async (mode) => {
      const mock = makeSupabaseMock({
        roomsInserts: [rowFor({ announcement_mode: mode })],
      });
      const result = await createRoom(
        { ...validInput, announcementMode: mode },
        makeDeps(mock)
      );
      expect(result).toMatchObject({ ok: true });
    }
  );

  it("rejects an unknown announcementMode", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, announcementMode: "scheduled" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_ANNOUNCEMENT_MODE", field: "announcementMode" },
    });
  });
});

describe("createRoom — categories validation", () => {
  it("rejects non-array categories", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, categories: "vocals,staging" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CATEGORIES" } });
  });

  it("rejects empty categories array", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom({ ...validInput, categories: [] }, makeDeps(mock));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CATEGORIES" } });
  });

  it("rejects more than 8 categories", async () => {
    const mock = makeSupabaseMock();
    const nine: VotingCategory[] = Array.from({ length: 9 }, (_, i) => ({
      name: `Cat${i}`,
      weight: 1,
    }));
    const result = await createRoom(
      { ...validInput, categories: nine },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CATEGORIES" } });
  });

  it("rejects duplicate category names (case-insensitive, trimmed)", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      {
        ...validInput,
        categories: [
          { name: "Vocals", weight: 1 },
          { name: "  vocals ", weight: 1 },
        ],
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CATEGORIES" } });
  });

  it("rejects a category with a short name (<2 chars)", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, categories: [{ name: "V", weight: 1 }] },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_CATEGORY" },
    });
  });

  it("rejects a category with an out-of-range weight", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, categories: [{ name: "Vocals", weight: 6 }] },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CATEGORY" } });
  });

  it("rejects a category with a non-integer weight", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      { ...validInput, categories: [{ name: "Vocals", weight: 1.5 }] },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CATEGORY" } });
  });

  it("defaults a missing weight to 1", async () => {
    const mock = makeSupabaseMock({ roomsInserts: [rowFor()] });
    await createRoom(
      { ...validInput, categories: [{ name: "Vocals" }] },
      makeDeps(mock)
    );
    expect(mock.roomsInsertRows[0]).toMatchObject({
      categories: [{ name: "Vocals", weight: 1 }],
    });
  });

  it("accepts a category with no hint field", async () => {
    const mock = makeSupabaseMock({ roomsInserts: [rowFor()] });
    const result = await createRoom(
      { ...validInput, categories: [{ name: "Vocals", weight: 1 }] },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("rejects a hint longer than 80 characters", async () => {
    const mock = makeSupabaseMock();
    const result = await createRoom(
      {
        ...validInput,
        categories: [{ name: "Vocals", weight: 1, hint: "x".repeat(81) }],
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CATEGORY" } });
  });
});

// ─── PIN collision retry ─────────────────────────────────────────────────────

/** Postgres unique-violation error shape returned by supabase-js. */
const uniqueViolation = { code: "23505", message: "duplicate key value" };

describe("createRoom — PIN collision retry", () => {
  it("retries up to 5 times on 6-char PIN unique violations, then succeeds", async () => {
    const mock = makeSupabaseMock({
      roomsInserts: [
        { data: null, error: uniqueViolation },
        { data: null, error: uniqueViolation },
        rowFor({ pin: "SUCCSS" }),
      ],
    });
    const pinSpy = vi.fn((len: number) => {
      const seq = ["FIRST1", "SECND2", "SUCCSS"];
      return seq[pinSpy.mock.calls.length - 1] ?? "X".repeat(len);
    });

    const result = await createRoom(validInput, makeDeps(mock, { generatePin: pinSpy }));

    expect(result).toMatchObject({ ok: true, room: { pin: "SUCCSS" } });
    expect(pinSpy).toHaveBeenCalledTimes(3);
    // All three retries used the short (6-char) PIN.
    expect(pinSpy.mock.calls.map((c) => c[0])).toEqual([6, 6, 6]);
  });

  it("falls back to 7-char PIN after 5 short-PIN collisions", async () => {
    const mock = makeSupabaseMock({
      roomsInserts: [
        { data: null, error: uniqueViolation }, // short attempt 1
        { data: null, error: uniqueViolation }, // short attempt 2
        { data: null, error: uniqueViolation }, // short attempt 3
        { data: null, error: uniqueViolation }, // short attempt 4
        { data: null, error: uniqueViolation }, // short attempt 5
        rowFor({ pin: "LONGPIN" }), // long attempt 1 succeeds
      ],
    });
    const pinSpy = vi.fn((len: number) => "X".repeat(len));

    const result = await createRoom(validInput, makeDeps(mock, { generatePin: pinSpy }));

    expect(result).toMatchObject({ ok: true, room: { pin: "LONGPIN" } });
    const lengths = pinSpy.mock.calls.map((c) => c[0]);
    expect(lengths).toEqual([6, 6, 6, 6, 6, 7]);
  });

  it("returns INTERNAL_ERROR after exhausting short and long retries", async () => {
    const collisions = Array.from({ length: 10 }, () => ({
      data: null,
      error: uniqueViolation,
    }));
    const mock = makeSupabaseMock({ roomsInserts: collisions });
    const pinSpy = vi.fn((len: number) => "X".repeat(len));

    const result = await createRoom(validInput, makeDeps(mock, { generatePin: pinSpy }));

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    // 5 short + 5 long attempts.
    expect(pinSpy).toHaveBeenCalledTimes(10);
  });

  it("does NOT retry on non-unique-violation errors; returns INTERNAL_ERROR immediately", async () => {
    const mock = makeSupabaseMock({
      roomsInserts: [
        { data: null, error: { code: "42P01", message: "relation does not exist" } },
      ],
    });
    const pinSpy = vi.fn((len: number) => "X".repeat(len));

    const result = await createRoom(validInput, makeDeps(mock, { generatePin: pinSpy }));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(pinSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Membership rollback ─────────────────────────────────────────────────────

describe("createRoom — membership failure rollback", () => {
  it("deletes the just-inserted room when the membership insert fails, then returns INTERNAL_ERROR", async () => {
    const mock = makeSupabaseMock({
      roomsInserts: [rowFor()],
      membershipsInsert: { error: { message: "boom" } },
    });

    const result = await createRoom(validInput, makeDeps(mock));

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(mock.roomsDeleteCalls).toEqual([
      { column: "id", value: "room-uuid-fixed" },
    ]);
  });

  it("does NOT delete the room when membership insert succeeds", async () => {
    const mock = makeSupabaseMock({ roomsInserts: [rowFor()] });

    const result = await createRoom(validInput, makeDeps(mock));

    expect(result).toMatchObject({ ok: true });
    expect(mock.roomsDeleteCalls).toEqual([]);
  });
});
