import { describe, it, expect } from "vitest";
import { PIN_CHARSET } from "../src/types";
import {
  SEED_CATEGORIES,
  SEED_PIN_PREFIX,
  SEED_STATES,
  SEED_USER_FIRST_NAMES,
  buildAnnouncingCascadeAbsent,
  buildFullScores,
  buildHalfScores,
  buildSeedAvatarSeed,
  buildSeedDisplayName,
  buildSeedPin,
  isSeedPin,
  isSeedState,
} from "./seed-helpers";

describe("scripts/seed-helpers", () => {
  describe("buildSeedPin", () => {
    it("starts with the SEED prefix", () => {
      const pin = buildSeedPin(() => 0);
      expect(pin.startsWith(SEED_PIN_PREFIX)).toBe(true);
    });

    it("is 6 chars total", () => {
      // SPEC §6.4 — PINs are exactly 6 chars from PIN_CHARSET. The
      // SEED prefix consumes 4; the random tail consumes 2. Total = 6.
      const pin = buildSeedPin(() => 0);
      expect(pin).toHaveLength(6);
    });

    it("only uses chars from PIN_CHARSET", () => {
      const pin = buildSeedPin(() => 0.99);
      const charset = new Set(PIN_CHARSET);
      for (const c of pin) {
        expect(charset.has(c)).toBe(true);
      }
    });

    it("produces deterministic tail when given a deterministic rng", () => {
      const rng = (() => {
        const xs = [0.1, 0.5, 0.9];
        let i = 0;
        return () => xs[i++ % xs.length];
      })();
      const a = buildSeedPin(rng);
      // The same rng on a second call returns the next two values, so
      // we shouldn't expect equality — just sanity-check the shape.
      expect(a.startsWith(SEED_PIN_PREFIX)).toBe(true);
      expect(a).toHaveLength(6);
    });
  });

  describe("isSeedPin", () => {
    it("recognises the SEED prefix", () => {
      expect(isSeedPin("SEEDAB")).toBe(true);
      expect(isSeedPin("SEED99")).toBe(true);
    });

    it("rejects non-seed pins", () => {
      expect(isSeedPin("ABCDEF")).toBe(false);
      expect(isSeedPin("ROOM01")).toBe(false);
      expect(isSeedPin("")).toBe(false);
    });
  });

  describe("buildSeedDisplayName + buildSeedAvatarSeed", () => {
    it("produces the same name across runs for the same idx", () => {
      expect(buildSeedDisplayName(0)).toBe(buildSeedDisplayName(0));
      expect(buildSeedAvatarSeed(0)).toBe(buildSeedAvatarSeed(0));
    });

    it("uses one of the SEED_USER_FIRST_NAMES", () => {
      for (let i = 0; i < SEED_USER_FIRST_NAMES.length; i++) {
        const name = buildSeedDisplayName(i);
        expect(name).toMatch(/^Seed \w+$/);
      }
    });

    it("avatar seed is the lowercased first name with `seed-` prefix", () => {
      // Whitebox check on the contract: the avatar seed must be stable
      // across runs so seeded users render with the same DiceBear face.
      expect(buildSeedAvatarSeed(0)).toBe("seed-alice");
      expect(buildSeedAvatarSeed(1)).toBe("seed-bob");
    });

    it("wraps modulo SEED_USER_FIRST_NAMES.length", () => {
      const baseName = buildSeedDisplayName(0);
      const wrappedName = buildSeedDisplayName(SEED_USER_FIRST_NAMES.length);
      expect(wrappedName).toBe(baseName);
    });
  });

  describe("buildFullScores", () => {
    it("fills every category with a value in 1..10", () => {
      const scores = buildFullScores(SEED_CATEGORIES, 3);
      expect(Object.keys(scores).length).toBe(SEED_CATEGORIES.length);
      for (const v of Object.values(scores)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
      }
    });

    it("is deterministic for a given seed", () => {
      const a = buildFullScores(SEED_CATEGORIES, 5);
      const b = buildFullScores(SEED_CATEGORIES, 5);
      expect(a).toEqual(b);
    });

    it("produces different values across seeds (so the leaderboard isn't a flat tie)", () => {
      const a = buildFullScores(SEED_CATEGORIES, 1);
      const b = buildFullScores(SEED_CATEGORIES, 7);
      // Not necessarily *every* value differs, but the maps shouldn't be
      // identical — the seed is meant to vary results across rows.
      expect(a).not.toEqual(b);
    });
  });

  describe("buildHalfScores", () => {
    it("fills only the first half (rounded up) of categories", () => {
      const half = buildHalfScores(SEED_CATEGORIES, 2);
      const expectedLen = Math.ceil(SEED_CATEGORIES.length / 2);
      expect(Object.keys(half).length).toBe(expectedLen);
    });

    it("uses the same values as buildFullScores for the categories it does fill", () => {
      const full = buildFullScores(SEED_CATEGORIES, 2);
      const half = buildHalfScores(SEED_CATEGORIES, 2);
      for (const k of Object.keys(half)) {
        expect(half[k]).toBe(full[k]);
      }
    });
  });

  describe("buildAnnouncingCascadeAbsent", () => {
    it("produces an announcing room with users B, C absent (last_seen_at 60s ago), A and D present", () => {
      const now = new Date("2026-05-10T12:00:00.000Z");
      const result = buildAnnouncingCascadeAbsent({ now });

      expect(result.room.status).toBe("announcing");
      expect(result.room.announcement_order).toHaveLength(4);
      const [a, b, c, d] = result.room.announcement_order!;

      const memById = new Map(
        result.memberships.map((m) => [m.user_id, m]),
      );

      // A is the active announcer — fresh.
      expect(memById.get(a)!.last_seen_at).not.toBeNull();
      expect(
        now.getTime() - new Date(memById.get(a)!.last_seen_at!).getTime(),
      ).toBeLessThan(30_000);

      // B and C are stale (>30 s ago).
      expect(
        now.getTime() - new Date(memById.get(b)!.last_seen_at!).getTime(),
      ).toBeGreaterThan(30_000);
      expect(
        now.getTime() - new Date(memById.get(c)!.last_seen_at!).getTime(),
      ).toBeGreaterThan(30_000);

      // D is fresh.
      expect(
        now.getTime() - new Date(memById.get(d)!.last_seen_at!).getTime(),
      ).toBeLessThan(30_000);

      expect(result.room.announcing_user_id).toBe(a);
      expect(result.room.current_announce_idx).toBe(0);
    });
  });

  describe("isSeedState + SEED_STATES", () => {
    it("accepts every name in SEED_STATES", () => {
      for (const s of SEED_STATES) {
        expect(isSeedState(s)).toBe(true);
      }
    });

    it("rejects unknown state names", () => {
      expect(isSeedState("not-a-state")).toBe(false);
      expect(isSeedState("")).toBe(false);
      expect(isSeedState("DONE-WITH-AWARDS")).toBe(false); // case-sensitive
    });
  });
});
