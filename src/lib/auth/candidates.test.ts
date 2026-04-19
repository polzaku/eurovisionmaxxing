import { describe, it, expect, vi } from "vitest";
import { listCandidates, type CandidatesDeps } from "@/lib/auth/candidates";

const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

interface MembershipRow {
  users: { id: string; display_name: string; avatar_seed: string };
}

interface MakeDepsOverrides {
  roomExists?: boolean;
  roomSelectError?: { message: string } | null;
  memberships?: MembershipRow[];
  membershipsSelectError?: { message: string } | null;
}

function makeDeps(o: MakeDepsOverrides = {}): {
  deps: CandidatesDeps;
  fromMock: ReturnType<typeof vi.fn>;
  membershipsEq: ReturnType<typeof vi.fn>;
} {
  const roomExists = o.roomExists ?? true;
  const roomSelectError = o.roomSelectError ?? null;
  const memberships = o.memberships ?? [];
  const membershipsSelectError = o.membershipsSelectError ?? null;

  const roomMaybeSingle = vi.fn().mockResolvedValue({
    data: roomSelectError ? null : roomExists ? { id: VALID_ROOM_ID } : null,
    error: roomSelectError,
  });
  const roomEq = vi.fn(() => ({ maybeSingle: roomMaybeSingle }));
  const roomSelect = vi.fn(() => ({ eq: roomEq }));

  const membershipsEq = vi.fn().mockResolvedValue({
    data: membershipsSelectError ? null : memberships,
    error: membershipsSelectError,
  });
  const membershipsSelect = vi.fn(() => ({ eq: membershipsEq }));

  const fromMock = vi.fn((table: string) => {
    if (table === "rooms") return { select: roomSelect };
    if (table === "room_memberships") return { select: membershipsSelect };
    throw new Error(`unexpected table: ${table}`);
  });

  const deps: CandidatesDeps = {
    supabase: { from: fromMock } as unknown as CandidatesDeps["supabase"],
  };

  return { deps, fromMock, membershipsEq };
}

function validInput(extra: Record<string, unknown> = {}) {
  return { displayName: "Alice", roomId: VALID_ROOM_ID, ...extra };
}

describe("listCandidates — body validation", () => {
  it("rejects non-string displayName as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: 42, roomId: VALID_ROOM_ID } as unknown as Parameters<
        typeof listCandidates
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string roomId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: "Alice", roomId: 99 } as unknown as Parameters<
        typeof listCandidates
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects bad displayName as INVALID_DISPLAY_NAME 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: "!", roomId: VALID_ROOM_ID },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects non-uuid roomId as INVALID_ROOM_ID 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: "Alice", roomId: "not-a-uuid" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });
});

describe("listCandidates — room existence", () => {
  it("returns ROOM_NOT_FOUND 404 when the room doesn't exist", async () => {
    const { deps } = makeDeps({ roomExists: false });
    const result = await listCandidates(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns INTERNAL_ERROR 500 when the room select errors", async () => {
    const { deps } = makeDeps({ roomSelectError: { message: "db down" } });
    const result = await listCandidates(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

describe("listCandidates — match logic", () => {
  it("returns an empty array when no members match the name", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Bob", avatar_seed: "sb" } },
      ],
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toEqual({ ok: true, candidates: [] });
  });

  it("returns a match with only userId and avatarSeed (no display_name leak)", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Alice", avatar_seed: "sa" } },
      ],
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toEqual({
      ok: true,
      candidates: [{ userId: USER_A, avatarSeed: "sa" }],
    });
    // explicit leakage guard
    expect(JSON.stringify(result)).not.toContain("display_name");
    expect(JSON.stringify(result)).not.toContain("Alice");
  });

  it("matches case-insensitively", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "ALICE", avatar_seed: "sa" } },
      ],
    });
    const result = await listCandidates(
      { displayName: "alice", roomId: VALID_ROOM_ID },
      deps
    );
    expect(result).toMatchObject({
      ok: true,
      candidates: [{ userId: USER_A }],
    });
  });

  it("matches after trimming and collapsing whitespace", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Lia Bear", avatar_seed: "sa" } },
      ],
    });
    const result = await listCandidates(
      { displayName: "  Lia   Bear  ", roomId: VALID_ROOM_ID },
      deps
    );
    expect(result).toMatchObject({
      ok: true,
      candidates: [{ userId: USER_A }],
    });
  });

  it("returns every matching row when multiple members share the name", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Alice", avatar_seed: "sa" } },
        { users: { id: USER_B, display_name: "Alice", avatar_seed: "sb" } },
      ],
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toEqual({
      ok: true,
      candidates: [
        { userId: USER_A, avatarSeed: "sa" },
        { userId: USER_B, avatarSeed: "sb" },
      ],
    });
  });

  it("queries only by room_id — membership query is scoped so different rooms cannot leak", async () => {
    const { deps, fromMock, membershipsEq } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Alice", avatar_seed: "sa" } },
      ],
    });
    await listCandidates(validInput(), deps);
    const tablesTouched = fromMock.mock.calls.map((c) => c[0]);
    expect(tablesTouched).toContain("rooms");
    expect(tablesTouched).toContain("room_memberships");
    expect(membershipsEq).toHaveBeenCalledWith("room_id", VALID_ROOM_ID);
  });

  it("returns INTERNAL_ERROR 500 when the memberships select errors", async () => {
    const { deps } = makeDeps({
      membershipsSelectError: { message: "boom" },
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
