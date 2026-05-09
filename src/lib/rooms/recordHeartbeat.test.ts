import { describe, it, expect, vi } from "vitest";
import {
  recordHeartbeat,
  type RecordHeartbeatDeps,
} from "@/lib/rooms/recordHeartbeat";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "10000000-0000-4000-8000-000000000001";

type Mock = { data: unknown; error: { message: string } | null };
interface Scripted {
  membershipUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const membershipUpdate =
    s.membershipUpdate ?? { data: { user_id: USER_ID }, error: null };

  const updateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];

  const from = vi.fn((table: string) => {
    if (table === "room_memberships") {
      return {
        update: vi.fn((patch: Record<string, unknown>) => {
          const eqs: Array<{ col: string; val: unknown }> = [];
          updateCalls.push({ patch, eqs });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(membershipUpdate),
            })),
          };
          return chain;
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as RecordHeartbeatDeps["supabase"],
    updateCalls,
  };
}

describe("recordHeartbeat", () => {
  it("400s on non-UUID roomId", async () => {
    const result = await recordHeartbeat(
      { roomId: "not-a-uuid", userId: USER_ID },
      { supabase: makeSupabaseMock().supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ROOM_ID");
      expect(result.status).toBe(400);
    }
  });

  it("400s on empty userId", async () => {
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: "" },
      { supabase: makeSupabaseMock().supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_USER_ID");
  });

  it("404s when no membership row matches", async () => {
    const mock = makeSupabaseMock({
      membershipUpdate: { data: null, error: null },
    });
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(404);
    }
  });

  it("500s on DB error", async () => {
    const mock = makeSupabaseMock({
      membershipUpdate: { data: null, error: { message: "boom" } },
    });
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("happy path UPDATEs last_seen_at filtered by (room_id, user_id)", async () => {
    const mock = makeSupabaseMock();
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(true);
    expect(mock.updateCalls).toHaveLength(1);
    const call = mock.updateCalls[0];
    expect(call.patch).toHaveProperty("last_seen_at");
    expect(typeof call.patch.last_seen_at).toBe("string");
    expect(call.eqs).toEqual(
      expect.arrayContaining([
        { col: "room_id", val: VALID_ROOM_ID },
        { col: "user_id", val: USER_ID },
      ]),
    );
  });

  it("idempotent — two consecutive calls both succeed", async () => {
    const mock = makeSupabaseMock();
    const r1 = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    const r2 = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mock.updateCalls).toHaveLength(2);
  });
});
