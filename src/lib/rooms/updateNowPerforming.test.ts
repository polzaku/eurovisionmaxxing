import { describe, it, expect, vi } from "vitest";
import {
  updateRoomNowPerforming,
  type UpdateNowPerformingDeps,
} from "@/lib/rooms/updateNowPerforming";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "voting",
  owner_user_id: VALID_USER_ID,
  allow_now_performing: true,
};

const defaultUpdatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
  owner_user_id: VALID_USER_ID,
  status: "voting",
  announcement_mode: "instant",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: VALID_CONTESTANT_ID,
  allow_now_performing: true,
  created_at: "2026-04-19T12:00:00Z",
};

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  roomUpdateResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const roomUpdateResult =
    opts.roomUpdateResult ?? { data: defaultUpdatedRow, error: null };

  const selectEqCalls: Array<{ col: string; val: unknown }> = [];
  const updatePatches: Array<Record<string, unknown>> = [];
  const updateEqCalls: Array<{ col: string; val: unknown }> = [];

  const from = vi.fn((table: string) => {
    if (table !== "rooms") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn((col: string, val: unknown) => {
          selectEqCalls.push({ col, val });
          return { maybeSingle: vi.fn().mockResolvedValue(roomSelectResult) };
        }),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        return {
          eq: vi.fn((col: string, val: unknown) => {
            updateEqCalls.push({ col, val });
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(roomUpdateResult),
              })),
            };
          }),
        };
      }),
    };
  });

  return {
    supabase: { from } as unknown as UpdateNowPerformingDeps["supabase"],
    selectEqCalls,
    updatePatches,
    updateEqCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpdateNowPerformingDeps> = {}
): UpdateNowPerformingDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("updateRoomNowPerforming — happy path", () => {
  it("sets now_performing_id, broadcasts, returns { room }", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toMatchObject({
      id: VALID_ROOM_ID,
      nowPerformingId: VALID_CONTESTANT_ID,
    });
    expect(mock.updatePatches).toEqual([
      { now_performing_id: VALID_CONTESTANT_ID },
    ]);
    expect(mock.updateEqCalls).toEqual([{ col: "id", val: VALID_ROOM_ID }]);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "now_performing",
      contestantId: VALID_CONTESTANT_ID,
    });
  });
});
