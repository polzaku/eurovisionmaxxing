import { describe, it, expect, vi } from "vitest";
import { joinByPin, type JoinByPinDeps } from "@/lib/rooms/joinByPin";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  membershipUpsertResult?: { error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? {
      data: { id: VALID_ROOM_ID, status: "lobby" },
      error: null,
    };
  const membershipUpsertResult =
    opts.membershipUpsertResult ?? { error: null };

  const roomEqArgs: Array<{ col: string; val: unknown }> = [];
  const upsertRows: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<Record<string, unknown>> = [];

  const roomMaybeSingleSpy = vi.fn().mockResolvedValue(roomSelectResult);
  const membershipUpsertSpy = vi.fn((row: Record<string, unknown>, options: Record<string, unknown>) => {
    upsertRows.push(row);
    upsertOptions.push(options);
    return Promise.resolve(membershipUpsertResult);
  });

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            roomEqArgs.push({ col, val });
            return { maybeSingle: roomMaybeSingleSpy };
          }),
        })),
      };
    }
    if (table === "room_memberships") {
      return { upsert: membershipUpsertSpy };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as JoinByPinDeps["supabase"],
    roomEqArgs,
    upsertRows,
    upsertOptions,
    roomMaybeSingleSpy,
    membershipUpsertSpy,
  };
}

function makeDeps(mock: ReturnType<typeof makeSupabaseMock>): JoinByPinDeps {
  return { supabase: mock.supabase };
}

describe("joinByPin — happy path", () => {
  it("returns { roomId } and upserts membership for a lobby room", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toEqual({ ok: true, roomId: VALID_ROOM_ID });
    expect(mock.upsertRows).toEqual([
      { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
    ]);
    expect(mock.upsertOptions[0]).toMatchObject({
      onConflict: "room_id,user_id",
      ignoreDuplicates: true,
    });
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEF" }]);
  });
});

describe("joinByPin — PIN normalization", () => {
  it("uppercases lowercase PIN before lookup", async () => {
    const mock = makeSupabaseMock();
    await joinByPin({ pin: "abcdef", userId: VALID_USER_ID }, makeDeps(mock));
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEF" }]);
  });

  it("trims whitespace around the PIN", async () => {
    const mock = makeSupabaseMock();
    await joinByPin({ pin: "  ABCDEF ", userId: VALID_USER_ID }, makeDeps(mock));
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEF" }]);
  });

  it("accepts a 7-char PIN (fallback range per §6.2)", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: { id: VALID_ROOM_ID, status: "lobby" },
        error: null,
      },
    });
    const result = await joinByPin(
      { pin: "ABCDEFG", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: true });
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEFG" }]);
  });
});

describe("joinByPin — PIN validation", () => {
  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string PIN (%s) with INVALID_PIN",
    async (pin) => {
      const mock = makeSupabaseMock();
      const result = await joinByPin(
        { pin, userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_PIN", field: "pin" },
      });
      expect(mock.roomEqArgs).toEqual([]);
    }
  );

  it("rejects a 5-char PIN", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "ABCDE", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PIN" } });
  });

  it("rejects an 8-char PIN", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "ABCDEFGH", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PIN" } });
  });

  it("rejects PIN containing a char outside PIN_CHARSET (e.g. '0')", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "AAA0AA", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PIN" } });
    expect(mock.roomEqArgs).toEqual([]);
  });
});

describe("joinByPin — userId validation", () => {
  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await joinByPin(
        { pin: "ABCDEF", userId },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.roomEqArgs).toEqual([]);
    }
  );
});

describe("joinByPin — room not found", () => {
  it("returns 404 ROOM_NOT_FOUND when no room matches the PIN", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.membershipUpsertSpy).not.toHaveBeenCalled();
  });

  it("returns 404 ROOM_NOT_FOUND on room SELECT error (no row either way)", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: { message: "boom" } },
    });
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });
});

describe("joinByPin — status guard", () => {
  it.each(["scoring", "announcing", "done"] as const)(
    "rejects status=%s with 409 ROOM_NOT_JOINABLE",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: { id: VALID_ROOM_ID, status },
          error: null,
        },
      });
      const result = await joinByPin(
        { pin: "ABCDEF", userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_JOINABLE" },
      });
      expect(mock.membershipUpsertSpy).not.toHaveBeenCalled();
    }
  );

  it.each(["lobby", "voting"] as const)(
    "accepts status=%s and upserts membership",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: { id: VALID_ROOM_ID, status },
          error: null,
        },
      });
      const result = await joinByPin(
        { pin: "ABCDEF", userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({ ok: true, roomId: VALID_ROOM_ID });
    }
  );
});

describe("joinByPin — idempotency", () => {
  it("calling twice in a row both succeed with the same roomId", async () => {
    const mock = makeSupabaseMock();
    const first = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    const second = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(first).toEqual({ ok: true, roomId: VALID_ROOM_ID });
    expect(second).toEqual({ ok: true, roomId: VALID_ROOM_ID });
    expect(mock.upsertOptions).toEqual([
      { onConflict: "room_id,user_id", ignoreDuplicates: true },
      { onConflict: "room_id,user_id", ignoreDuplicates: true },
    ]);
  });
});

describe("joinByPin — DB error", () => {
  it("returns 500 INTERNAL_ERROR when the membership upsert fails", async () => {
    const mock = makeSupabaseMock({
      membershipUpsertResult: { error: { message: "FK violation: user does not exist" } },
    });
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
