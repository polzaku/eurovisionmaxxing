import { describe, it, expect, vi } from "vitest";
import { onboardUser, type OnboardDeps } from "@/lib/auth/onboard";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<OnboardDeps> = {}): {
  deps: OnboardDeps;
  insertSpy: ReturnType<typeof vi.fn>;
  hashSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn().mockResolvedValue({ error: null });
  // Fake hash deliberately does NOT contain the plaintext, so we can assert
  // that the plaintext token never leaks into the inserted row or error responses.
  const hashSpy = vi.fn(async (_plaintext: string) => "BCRYPT_HASH_FIXED");
  const deps: OnboardDeps = {
    supabase: {
      from: vi.fn(() => ({ insert: insertSpy })),
    } as unknown as OnboardDeps["supabase"],
    hashToken: hashSpy,
    generateUserId: () => "user-uuid-fixed",
    generateRejoinToken: () => "token-uuid-fixed",
    ...overrides,
  };
  return { deps, insertSpy, hashSpy };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("onboardUser — happy path", () => {
  it("returns the four user fields on valid input", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "seed-abc" },
      deps
    );
    expect(result).toEqual({
      ok: true,
      user: {
        userId: "user-uuid-fixed",
        rejoinToken: "token-uuid-fixed",
        displayName: "Lia",
        avatarSeed: "seed-abc",
      },
    });
  });

  it("inserts the bcrypt hash, never the plaintext token", async () => {
    const { deps, insertSpy, hashSpy } = makeDeps();
    await onboardUser({ displayName: "Lia", avatarSeed: "seed-abc" }, deps);
    expect(hashSpy).toHaveBeenCalledWith("token-uuid-fixed");
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertedRow = insertSpy.mock.calls[0][0];
    expect(insertedRow).toMatchObject({
      id: "user-uuid-fixed",
      display_name: "Lia",
      avatar_seed: "seed-abc",
      rejoin_token_hash: "BCRYPT_HASH_FIXED",
    });
    // Crucial: the plaintext token must not appear in the DB row
    expect(JSON.stringify(insertedRow)).not.toContain("token-uuid-fixed");
  });

  it("trims leading and trailing whitespace from displayName", async () => {
    const { deps, insertSpy } = makeDeps();
    const result = await onboardUser(
      { displayName: "   Lia   ", avatarSeed: "seed-abc" },
      deps
    );
    expect(result).toMatchObject({ ok: true, user: { displayName: "Lia" } });
    expect(insertSpy.mock.calls[0][0].display_name).toBe("Lia");
  });

  it("collapses internal whitespace in displayName", async () => {
    const { deps, insertSpy } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia  Bear", avatarSeed: "seed-abc" },
      deps
    );
    expect(result).toMatchObject({ ok: true, user: { displayName: "Lia Bear" } });
    expect(insertSpy.mock.calls[0][0].display_name).toBe("Lia Bear");
  });

  it("accepts a 24-char displayName", async () => {
    const { deps } = makeDeps();
    const name = "A".repeat(24);
    const result = await onboardUser({ displayName: name, avatarSeed: "x" }, deps);
    expect(result).toMatchObject({ ok: true, user: { displayName: name } });
  });

  it("accepts a 2-char displayName", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser({ displayName: "Li", avatarSeed: "x" }, deps);
    expect(result).toMatchObject({ ok: true, user: { displayName: "Li" } });
  });

  it("accepts hyphens in displayName", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Mary-Jane", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({ ok: true, user: { displayName: "Mary-Jane" } });
  });
});

// ─── Validation failures ─────────────────────────────────────────────────────

describe("onboardUser — body validation", () => {
  it("rejects missing displayName as INVALID_BODY", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { avatarSeed: "x" } as unknown as Parameters<typeof onboardUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects missing avatarSeed as INVALID_BODY", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia" } as unknown as Parameters<typeof onboardUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string displayName as INVALID_BODY", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: 42, avatarSeed: "x" } as unknown as Parameters<
        typeof onboardUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });
});

describe("onboardUser — displayName validation", () => {
  it("rejects 1-char trimmed name as INVALID_DISPLAY_NAME", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser({ displayName: "L", avatarSeed: "x" }, deps);
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects 25-char name as INVALID_DISPLAY_NAME", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "A".repeat(25), avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects whitespace-only name (trims to empty) as INVALID_DISPLAY_NAME", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "     ", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects punctuation in name", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia!", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects HTML-like characters in name", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "<script>", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects emoji in name", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia🎤", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });
});

describe("onboardUser — avatarSeed validation", () => {
  it("rejects empty avatarSeed as INVALID_AVATAR_SEED", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser({ displayName: "Lia", avatarSeed: "" }, deps);
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_AVATAR_SEED", field: "avatarSeed" },
    });
  });

  it("rejects 65-char avatarSeed as INVALID_AVATAR_SEED", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "x".repeat(65) },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_AVATAR_SEED", field: "avatarSeed", params: { limit: 64 } },
    });
  });

  it("accepts a 64-char avatarSeed (boundary)", async () => {
    const { deps } = makeDeps();
    const seed = "x".repeat(64);
    const result = await onboardUser({ displayName: "Lia", avatarSeed: seed }, deps);
    expect(result).toMatchObject({ ok: true, user: { avatarSeed: seed } });
  });
});

// ─── Supabase failure path ───────────────────────────────────────────────────

describe("onboardUser — supabase errors", () => {
  it("returns INTERNAL_ERROR 500 when supabase insert fails", async () => {
    const { deps } = makeDeps({});
    (deps.supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      {
        insert: vi.fn().mockResolvedValue({
          error: { message: "duplicate key value violates unique constraint" },
        }),
      }
    );
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("never includes the plaintext rejoin token in the error response", async () => {
    const { deps } = makeDeps();
    (deps.supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      {
        insert: vi.fn().mockResolvedValue({ error: { message: "boom" } }),
      }
    );
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "x" },
      deps
    );
    expect(JSON.stringify(result)).not.toContain("token-uuid-fixed");
  });
});