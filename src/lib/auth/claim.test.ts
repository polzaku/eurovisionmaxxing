import { describe, it, expect, vi } from "vitest";
import { claimIdentity, type ClaimDeps } from "@/lib/auth/claim";

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const STORED_NAME = "Alice";
const NEW_TOKEN = "new-plaintext-token";
const NEW_HASH = "BCRYPT_NEW_HASH";
const NOW_ISO = "2026-04-19T12:00:00.000Z";

interface MakeDepsOverrides {
  membershipRow?: {
    users: { id: string; display_name: string; avatar_seed: string };
  } | null;
  membershipError?: { message: string } | null;
  updateError?: { message: string } | null;
}

function makeDeps(o: MakeDepsOverrides = {}) {
  const membershipError = o.membershipError ?? null;
  const defaultRow = {
    users: { id: VALID_USER_ID, display_name: STORED_NAME, avatar_seed: "sa" },
  };
  const row = membershipError
    ? null
    : o.membershipRow === undefined
      ? defaultRow
      : o.membershipRow;
  const updateError = o.updateError ?? null;

  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: row, error: membershipError });
  const eqUser = vi.fn(() => ({ maybeSingle }));
  const eqRoom = vi.fn(() => ({ eq: eqUser }));
  const selectMembership = vi.fn(() => ({ eq: eqRoom }));

  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const updateMock = vi.fn(() => ({ eq: updateEq }));

  const fromMock = vi.fn((_table: string) => ({
    select: selectMembership,
    update: updateMock,
  }));

  const hashSpy = vi.fn(async () => NEW_HASH);
  const genTokenSpy = vi.fn(() => NEW_TOKEN);
  const nowSpy = vi.fn(() => NOW_ISO);

  const deps: ClaimDeps = {
    supabase: { from: fromMock } as unknown as ClaimDeps["supabase"],
    hashToken: hashSpy,
    generateRejoinToken: genTokenSpy,
    now: nowSpy,
  };

  return { deps, fromMock, selectMembership, updateMock, updateEq, hashSpy, genTokenSpy, nowSpy };
}

function validInput(extra: Record<string, unknown> = {}) {
  return {
    userId: VALID_USER_ID,
    roomId: VALID_ROOM_ID,
    displayName: STORED_NAME,
    ...extra,
  };
}

describe("claimIdentity — body validation", () => {
  it("rejects non-string userId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: 1, roomId: VALID_ROOM_ID, displayName: STORED_NAME } as unknown as Parameters<
        typeof claimIdentity
      >[0],
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400, error: { code: "INVALID_BODY" } });
  });

  it("rejects non-uuid userId as INVALID_USER_ID 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: "nope", roomId: VALID_ROOM_ID, displayName: STORED_NAME },
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("rejects non-uuid roomId as INVALID_ROOM_ID 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: VALID_USER_ID, roomId: "nope", displayName: STORED_NAME },
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("rejects bad displayName as INVALID_DISPLAY_NAME 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: VALID_USER_ID, roomId: VALID_ROOM_ID, displayName: "!" },
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });
});

describe("claimIdentity — verification failures", () => {
  it("returns CANDIDATE_NOT_FOUND 404 when no membership row exists", async () => {
    const { deps, updateMock, hashSpy } = makeDeps({ membershipRow: null });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "CANDIDATE_NOT_FOUND" },
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it("returns CANDIDATE_NOT_FOUND 404 when stored display_name doesn't match (case-insensitive)", async () => {
    const { deps, updateMock } = makeDeps({
      membershipRow: {
        users: { id: VALID_USER_ID, display_name: "Bob", avatar_seed: "sa" },
      },
    });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "CANDIDATE_NOT_FOUND" },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns INTERNAL_ERROR 500 when the select errors", async () => {
    const { deps } = makeDeps({ membershipError: { message: "boom" } });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

describe("claimIdentity — happy path", () => {
  it("returns the new token + canonical stored displayName + avatarSeed", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(validInput({ displayName: "  alice  " }), deps);
    expect(result).toEqual({
      ok: true,
      user: {
        userId: VALID_USER_ID,
        rejoinToken: NEW_TOKEN,
        displayName: STORED_NAME,
        avatarSeed: "sa",
      },
    });
  });

  it("writes the new bcrypt hash and refreshed last_seen_at", async () => {
    const { deps, updateMock, updateEq, hashSpy, nowSpy } = makeDeps();
    await claimIdentity(validInput(), deps);
    expect(hashSpy).toHaveBeenCalledWith(NEW_TOKEN);
    expect(nowSpy).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({
      rejoin_token_hash: NEW_HASH,
      last_seen_at: NOW_ISO,
    });
    expect(updateEq).toHaveBeenCalledWith("id", VALID_USER_ID);
  });

  it("returns INTERNAL_ERROR 500 when the update errors", async () => {
    const { deps } = makeDeps({ updateError: { message: "boom" } });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

describe("claimIdentity — never leaks the new plaintext token in error paths", () => {
  it.each([
    ["CANDIDATE_NOT_FOUND", { membershipRow: null } as MakeDepsOverrides],
    ["INVALID_BODY", { membershipRow: null } as MakeDepsOverrides, "invalid"],
    ["INTERNAL_ERROR select", { membershipError: { message: "b" } } as MakeDepsOverrides],
  ])("never includes the new token in the %s result", async (_label, overrides, _extra?: string) => {
    const { deps } = makeDeps(overrides);
    const result = await claimIdentity(validInput(), deps);
    expect(JSON.stringify(result)).not.toContain(NEW_TOKEN);
  });
});
