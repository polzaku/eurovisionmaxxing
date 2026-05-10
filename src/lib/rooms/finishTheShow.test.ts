import { describe, it, expect, vi } from "vitest";
import {
  finishTheShow,
  type FinishTheShowDeps,
} from "@/lib/rooms/finishTheShow";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";

const exhaustedRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcement_order: [U1, U2],
  announcing_user_id: null,
  announce_skipped_user_ids: [U1, U2],
  batch_reveal_mode: false,
};

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  resultsByUserSelect?: Map<string, Mock>;
  userSelect?: Mock;
  roomUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: exhaustedRoom, error: null };
  // Default: U1 has a pending result, U2 has none
  const resultsByUserSelect =
    s.resultsByUserSelect ??
    new Map([
      [U1, { data: { contestant_id: "2025-AU" }, error: null }],
      [U2, { data: null, error: null }],
    ]);
  const userSelect =
    s.userSelect ?? { data: { display_name: "Alice" }, error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };

  const roomUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
    isFilters?: Array<{ col: string }>;
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
          const isFilters: Array<{ col: string }> = [];
          roomUpdateCalls.push({ patch, eqs, isFilters });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            is: vi.fn((col: string) => {
              isFilters.push({ col });
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
      // Each call to from("results").select(...).eq(...).eq(...).eq(...).limit(1).maybeSingle()
      // We need to return different values based on the user_id eq filter.
      // We'll capture user_id from the eq chain.
      let capturedUserId: string | null = null;
      const chain = {
        eq: vi.fn((col: string, val: unknown) => {
          if (col === "user_id") capturedUserId = val as string;
          return chain;
        }),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(() => {
          const result = resultsByUserSelect.get(capturedUserId ?? "") ?? {
            data: null,
            error: null,
          };
          return Promise.resolve(result);
        }),
      };
      return {
        select: vi.fn(() => chain),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as FinishTheShowDeps["supabase"],
    roomUpdateCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<FinishTheShowDeps> = {},
): FinishTheShowDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── input validation ─────────────────────────────────────────────────────────

describe("finishTheShow — input validation", () => {
  it("1. 400 INVALID_ROOM_ID on non-UUID", async () => {
    const result = await finishTheShow(
      { roomId: "not-a-uuid", userId: OWNER_ID },
      makeDeps(makeSupabaseMock()),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });
});

// ─── authorization ────────────────────────────────────────────────────────────

describe("finishTheShow — authorization", () => {
  it("2. 403 FORBIDDEN when caller != owner", async () => {
    const mock = makeSupabaseMock();
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: U1 },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
  });
});

// ─── room state guards ────────────────────────────────────────────────────────

describe("finishTheShow — room state guards", () => {
  it("3. 409 NOT_IN_CASCADE_EXHAUST_STATE when announcing_user_id is set", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...exhaustedRoom, announcing_user_id: U1 },
        error: null,
      },
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "NOT_IN_CASCADE_EXHAUST_STATE" },
    });
  });

  it("4. 409 NOT_IN_CASCADE_EXHAUST_STATE when batch_reveal_mode is already true", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...exhaustedRoom, batch_reveal_mode: true },
        error: null,
      },
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "NOT_IN_CASCADE_EXHAUST_STATE" },
    });
  });

  it("5. 409 NO_PENDING_REVEALS when no skipped user has unrevealed results", async () => {
    const mock = makeSupabaseMock({
      resultsByUserSelect: new Map([
        [U1, { data: null, error: null }],
        [U2, { data: null, error: null }],
      ]),
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "NO_PENDING_REVEALS" },
    });
  });
});

// ─── race condition ───────────────────────────────────────────────────────────

describe("finishTheShow — race", () => {
  it("6. 409 FINISH_SHOW_RACED when conditional UPDATE returns no row", async () => {
    const mock = makeSupabaseMock({
      roomUpdate: { data: null, error: null },
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "FINISH_SHOW_RACED" },
    });
  });
});

// ─── happy path ───────────────────────────────────────────────────────────────

describe("finishTheShow — happy path", () => {
  it("7. picks U1, sets batch_reveal_mode=true + announcing_user_id=U1, broadcasts batch_reveal_started", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toMatchObject({
      ok: true,
      announcingUserId: U1,
      displayName: "Alice",
    });
    expect(mock.roomUpdateCalls).toHaveLength(1);
    const patch = mock.roomUpdateCalls[0].patch;
    expect(patch.batch_reveal_mode).toBe(true);
    expect(patch.announcing_user_id).toBe(U1);
    expect(patch.current_announce_idx).toBe(0);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "batch_reveal_started",
      announcingUserId: U1,
      displayName: "Alice",
    });
  });

  it("8. skips users with all-announced results: U1 has none pending, U2 has → picks U2", async () => {
    const mock = makeSupabaseMock({
      resultsByUserSelect: new Map([
        [U1, { data: null, error: null }],
        [U2, { data: { contestant_id: "2025-AU" }, error: null }],
      ]),
      userSelect: { data: { display_name: "Bob" }, error: null },
    });
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy }),
    );
    expect(result).toMatchObject({
      ok: true,
      announcingUserId: U2,
      displayName: "Bob",
    });
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "batch_reveal_started",
      announcingUserId: U2,
      displayName: "Bob",
    });
  });
});
