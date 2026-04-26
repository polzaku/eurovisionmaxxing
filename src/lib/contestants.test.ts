import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TEST_FIXTURE_YEAR,
  isTestFixtureYear,
  fetchContestants,
  fetchContestantsMeta,
  ContestDataError,
} from "@/lib/contestants";

describe("isTestFixtureYear / TEST_FIXTURE_YEAR", () => {
  beforeEach(() => {});
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("TEST_FIXTURE_YEAR is 9999 (a sentinel that cannot collide with real Eurovision years)", () => {
    expect(TEST_FIXTURE_YEAR).toBe(9999);
  });

  it.each(["development", "test"])(
    "returns true for year=9999 when NODE_ENV=%s",
    (env) => {
      vi.stubEnv("NODE_ENV", env);
      expect(isTestFixtureYear(9999)).toBe(true);
    },
  );

  it("returns false for year=9999 when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isTestFixtureYear(9999)).toBe(false);
  });

  it("returns false for any other year, regardless of NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isTestFixtureYear(2026)).toBe(false);
    expect(isTestFixtureYear(2000)).toBe(false);
  });
});

describe("fetchContestants — test-fixture year", () => {
  beforeEach(() => {});
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the 5-row final fixture in dev (NODE_ENV=development)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const out = await fetchContestants(9999, "final");
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({
      year: 9999,
      event: "final",
      runningOrder: 1,
    });
    // Real country names → flag emoji map should resolve.
    expect(out.every((c) => c.flagEmoji.length > 0)).toBe(true);
  });

  it("throws ContestDataError for year 9999 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fetchContestants(9999, "final")).rejects.toBeInstanceOf(
      ContestDataError,
    );
  });
});

describe("fetchContestantsMeta — test-fixture year", () => {
  beforeEach(() => {});
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns { broadcastStartUtc: null } for the bare-array fixture in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const meta = await fetchContestantsMeta(9999, "final");
    expect(meta).toEqual({ broadcastStartUtc: null });
  });

  it("throws ContestDataError for year 9999 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fetchContestantsMeta(9999, "final")).rejects.toBeInstanceOf(
      ContestDataError,
    );
  });
});
