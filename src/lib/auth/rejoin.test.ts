import { describe, it, expect, vi } from "vitest";
import { rejoinUser, type RejoinDeps } from "@/lib/auth/rejoin";

// ─── Test helpers ────────────────────────────────────────────────────────────

const VALID_USER_ID = "11111111-2222-4333-8444-555555555555";
const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_TOKEN = "token-plaintext-fixed";
const FAKE_HASH = "BCRYPT_HASH_FIXED";
const NOW_ISO = "2026-04-19T12:00:00.000Z";

interface MakeDepsOverrides {
  row?: {
    id: string;
    display_name: string;
    avatar_seed: string;
    rejoin_token_hash: string;
  } | null;
  selectError?: { message: string } | null;
  compareResult?: boolean;
  updateError?: { message: string } | null;
}

function makeDeps(o: MakeDepsOverrides = {}) {
  const row =
    o.row === undefined
      ? {
          id: VALID_USER_ID,
          display_name: "Lia Bear",
          avatar_seed: "seed-abc",
          rejoin_token_hash: FAKE_HASH,
        }
      : o.row;
  const selectError = o.selectError ?? null;
  const compareResult = o.compareResult ?? true;
  const updateError = o.updateError ?? null;

  const maybeSingleMock = vi
    .fn()
    .mockResolvedValue({ data: row, error: selectError });
  const selectEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const selectMock = vi.fn(() => ({ eq: selectEqMock }));

  const updateEqMock = vi.fn().mockResolvedValue({ error: updateError });
  const updateMock = vi.fn(() => ({ eq: updateEqMock }));

  const fromMock = vi.fn(() => ({
    select: selectMock,
    update: updateMock,
  }));

  const compareSpy = vi.fn(async () => compareResult);
  const nowSpy = vi.fn(() => NOW_ISO);

  const deps: RejoinDeps = {
    supabase: { from: fromMock } as unknown as RejoinDeps["supabase"],
    compareToken: compareSpy,
    now: nowSpy,
  };

  return {
    deps,
    fromMock,
    selectMock,
    selectEqMock,
    maybeSingleMock,
    updateMock,
    updateEqMock,
    compareSpy,
    nowSpy,
  };
}

function validInput(extra: Record<string, unknown> = {}) {
  return { userId: VALID_USER_ID, rejoinToken: VALID_TOKEN, ...extra };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("rejoinUser — happy path", () => {
  it("returns the three user fields on valid input + matching hash", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(validInput(), deps);
    expect(result).toEqual({
      ok: true,
      user: {
        userId: VALID_USER_ID,
        displayName: "Lia Bear",
        avatarSeed: "seed-abc",
      },
    });
  });

  it("calls compareToken exactly once with (plaintext, stored hash)", async () => {
    const { deps, compareSpy } = makeDeps();
    await rejoinUser(validInput(), deps);
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith(VALID_TOKEN, FAKE_HASH);
  });

  it("updates last_seen_at with deps.now() after successful compare", async () => {
    const { deps, updateMock, updateEqMock, nowSpy } = makeDeps();
    await rejoinUser(validInput(), deps);
    expect(nowSpy).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ last_seen_at: NOW_ISO });
    expect(updateEqMock).toHaveBeenCalledWith("id", VALID_USER_ID);
  });

  it("accepts a syntactically valid roomId and does NOT query rooms or room_memberships", async () => {
    const { deps, fromMock } = makeDeps();
    const result = await rejoinUser(validInput({ roomId: VALID_ROOM_ID }), deps);
    expect(result).toMatchObject({ ok: true });
    const tablesTouched = fromMock.mock.calls.map((c) => c[0]);
    expect(tablesTouched.every((t) => t === "users")).toBe(true);
    expect(tablesTouched).not.toContain("rooms");
    expect(tablesTouched).not.toContain("room_memberships");
  });
});

// ─── Compare-fail side-effects ───────────────────────────────────────────────

describe("rejoinUser — compare-fail side-effects", () => {
  it("does NOT call the last_seen_at update when compare returns false", async () => {
    const { deps, updateMock } = makeDeps({ compareResult: false });
    await rejoinUser(validInput(), deps);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ─── Body validation ─────────────────────────────────────────────────────────

describe("rejoinUser — body validation", () => {
  it("rejects missing userId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { rejoinToken: VALID_TOKEN } as unknown as Parameters<typeof rejoinUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects missing rejoinToken as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: VALID_USER_ID } as unknown as Parameters<typeof rejoinUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string userId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: 42, rejoinToken: VALID_TOKEN } as unknown as Parameters<
        typeof rejoinUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string rejoinToken as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: VALID_USER_ID, rejoinToken: null } as unknown as Parameters<
        typeof rejoinUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-uuid userId as INVALID_BODY 400 with field=userId", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: "not-a-uuid", rejoinToken: VALID_TOKEN },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "userId" },
    });
  });

  it("rejects non-string roomId when present as INVALID_BODY 400 with field=roomId", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: VALID_USER_ID, rejoinToken: VALID_TOKEN, roomId: 123 } as unknown as Parameters<
        typeof rejoinUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "roomId" },
    });
  });
});

// ─── Auth failures ───────────────────────────────────────────────────────────

describe("rejoinUser — auth failures", () => {
  it("returns USER_NOT_FOUND 404 when no row matches; does NOT call compare or update", async () => {
    const { deps, compareSpy, updateMock } = makeDeps({ row: null });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "USER_NOT_FOUND" },
    });
    expect(compareSpy).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_TOKEN 401 when compare returns false; does NOT call update", async () => {
    const { deps, updateMock } = makeDeps({ compareResult: false });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 401,
      error: { code: "INVALID_TOKEN" },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ─── Supabase errors ─────────────────────────────────────────────────────────

describe("rejoinUser — supabase errors", () => {
  it("returns INTERNAL_ERROR 500 when the select call errors", async () => {
    const { deps } = makeDeps({ selectError: { message: "db unreachable" } });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns INTERNAL_ERROR 500 when the last_seen_at update errors after a successful compare", async () => {
    const { deps } = makeDeps({ updateError: { message: "update failed" } });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

// ─── Leakage ─────────────────────────────────────────────────────────────────

describe("rejoinUser — never leaks plaintext token", () => {
  it.each([
    ["USER_NOT_FOUND", { row: null } as MakeDepsOverrides],
    ["INVALID_TOKEN", { compareResult: false } as MakeDepsOverrides],
    ["select error", { selectError: { message: "boom" } } as MakeDepsOverrides],
    ["update error", { updateError: { message: "boom" } } as MakeDepsOverrides],
  ])(
    "never includes plaintext rejoinToken in the %s error result",
    async (_label, overrides) => {
      const { deps } = makeDeps(overrides);
      const result = await rejoinUser(validInput(), deps);
      expect(JSON.stringify(result)).not.toContain(VALID_TOKEN);
    }
  );
});
