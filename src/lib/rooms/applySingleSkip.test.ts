import { describe, it, expect, vi } from "vitest";
import {
  applySingleSkip,
  type ApplySingleSkipDeps,
} from "@/lib/rooms/applySingleSkip";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const SKIP_USER = "20000000-0000-4000-8000-000000000002";

function makeSupabase() {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const from = vi.fn((table: string) => {
    if (table === "results") {
      return {
        update: vi.fn((patch: Record<string, unknown>) => {
          updates.push({ table, patch });
          const chain = {
            eq: vi.fn(() => chain),
            then: (...args: unknown[]) =>
              Promise.resolve({ data: null, error: null }).then(
                ...(args as [(v: unknown) => unknown]),
              ),
          };
          return chain;
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return {
    supabase: { from } as unknown as ApplySingleSkipDeps["supabase"],
    updates,
  };
}

describe("applySingleSkip", () => {
  it("marks all of the user's results as announced", async () => {
    const mock = makeSupabase();
    const result = await applySingleSkip(
      { roomId: ROOM_ID, skippedUserId: SKIP_USER },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(true);
    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0].patch).toEqual({ announced: true });
  });

  it("returns the skippedUserId on success (so the caller can broadcast)", async () => {
    const mock = makeSupabase();
    const result = await applySingleSkip(
      { roomId: ROOM_ID, skippedUserId: SKIP_USER },
      { supabase: mock.supabase },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.skippedUserId).toBe(SKIP_USER);
  });

  it("500s on DB error", async () => {
    const supabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => {
          const chain = {
            eq: vi.fn(() => chain),
            then: (...args: unknown[]) =>
              Promise.resolve({
                data: null,
                error: { message: "boom" },
              }).then(...(args as [(v: unknown) => unknown])),
          };
          return chain;
        }),
      })),
    };
    const result = await applySingleSkip(
      { roomId: ROOM_ID, skippedUserId: SKIP_USER },
      { supabase: supabase as unknown as ApplySingleSkipDeps["supabase"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});
