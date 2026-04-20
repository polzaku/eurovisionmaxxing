import { describe, it, expect, vi } from "vitest";
import {
  joinRoomByMembership,
  type JoinRoomDeps,
} from "@/lib/rooms/joinRoom";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const defaultRoomRow = { id: VALID_ROOM_ID, status: "lobby" };
const defaultUserRow = {
  display_name: "Alice",
  avatar_seed: "seed-abc",
};

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  upsertResult?: { error: { message: string } | null };
  userSelectResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const upsertResult = opts.upsertResult ?? { error: null };
  const userSelectResult =
    opts.userSelectResult ?? { data: defaultUserRow, error: null };

  const roomEqArgs: Array<{ col: string; val: unknown }> = [];
  const upsertRows: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<Record<string, unknown>> = [];
  const userEqArgs: Array<{ col: string; val: unknown }> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            roomEqArgs.push({ col, val });
            return {
              maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
            };
          }),
        })),
      };
    }
    if (table === "room_memberships") {
      return {
        upsert: vi.fn(
          (row: Record<string, unknown>, options: Record<string, unknown>) => {
            upsertRows.push(row);
            upsertOptions.push(options);
            return Promise.resolve(upsertResult);
          }
        ),
      };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            userEqArgs.push({ col, val });
            return {
              maybeSingle: vi.fn().mockResolvedValue(userSelectResult),
            };
          }),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as JoinRoomDeps["supabase"],
    roomEqArgs,
    upsertRows,
    upsertOptions,
    userEqArgs,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<JoinRoomDeps> = {}
): JoinRoomDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("joinRoomByMembership — happy path", () => {
  it("upserts membership, reads user, broadcasts user_joined, returns { ok: true }", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await joinRoomByMembership(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toEqual({ ok: true });
    expect(mock.upsertRows).toEqual([
      { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
    ]);
    expect(mock.upsertOptions[0]).toMatchObject({
      onConflict: "room_id,user_id",
      ignoreDuplicates: true,
    });
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "user_joined",
      user: {
        id: VALID_USER_ID,
        displayName: "Alice",
        avatarSeed: "seed-abc",
      },
    });
  });
});
