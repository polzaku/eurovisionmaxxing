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
});
