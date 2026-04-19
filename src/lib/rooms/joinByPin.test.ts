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
