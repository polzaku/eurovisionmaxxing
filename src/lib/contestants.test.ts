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

describe("fetchContestants — wrapper-shape JSON support (R2 #238)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads contestants from wrapper-shape JSON file (test fixture)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const contestants = await fetchContestants(TEST_FIXTURE_YEAR, "final");
    expect(Array.isArray(contestants)).toBe(true);
    expect(contestants.length).toBeGreaterThan(0);
    expect(contestants[0]).toMatchObject({
      country: expect.any(String),
      artist: expect.any(String),
      song: expect.any(String),
      runningOrder: expect.any(Number),
    });
  });
});

describe("contestants — artistPreviewUrl pass-through (R2 #240)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves artistPreviewUrl on the domain Contestant when JSON includes it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const contestants = await fetchContestants(TEST_FIXTURE_YEAR, "final");
    const withPreview = contestants.find((c) => c.artistPreviewUrl);
    expect(withPreview).toBeDefined();
    expect(typeof withPreview!.artistPreviewUrl).toBe("string");
    expect(withPreview!.artistPreviewUrl).toMatch(/^https?:\/\//);
  });

  it("leaves artistPreviewUrl undefined on contestants where the JSON entry omits it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const contestants = await fetchContestants(TEST_FIXTURE_YEAR, "final");
    const withoutPreview = contestants.find((c) => !c.artistPreviewUrl);
    expect(withoutPreview).toBeDefined();
    expect(withoutPreview!.artistPreviewUrl).toBeUndefined();
  });
});

describe("fetchContestantsMeta — test-fixture year", () => {
  beforeEach(() => {});
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns broadcastStartUtc from wrapper-shape fixture in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const meta = await fetchContestantsMeta(9999, "final");
    expect(meta).toEqual({ broadcastStartUtc: "2026-05-16T19:00:00Z" });
  });

  it("throws ContestDataError for year 9999 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fetchContestantsMeta(9999, "final")).rejects.toBeInstanceOf(
      ContestDataError,
    );
  });
});
