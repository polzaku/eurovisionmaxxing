import { describe, it, expect } from "vitest";
import en from "./en.json";

// SPEC #12 — personality awards are rendered to *every viewer*, not just
// the winner. Explainers must therefore reference the winner in the
// third person ("they / their"). Using first-person copy ("you / your")
// reads as if the viewer themselves won the award and is confusing when
// the winner is someone else in the room.
//
// Two exceptions:
//   - `the_dark_horse` is about a contestant (no winner-user), already
//     phrased neutrally.
//   - `your_neighbour` is intentionally viewer-personalized — the
//     ceremony renders one card per viewer, so 1st-person reads
//     correctly there.
describe("en.json — personality award explainers use 3rd-person copy", () => {
  const thirdPersonExplainers = [
    "harshest_critic",
    "biggest_stan",
    "hive_mind_master",
    "most_contrarian",
    "neighbourhood_voters",
    "fashion_stan",
    "the_enabler",
  ] as const;

  for (const key of thirdPersonExplainers) {
    it(`explainers.${key} contains no "you" / "your"`, () => {
      const explainers = en.awards.explainers as Record<string, string>;
      const txt = explainers[key];
      expect(txt, `explainers.${key} missing`).toBeTypeOf("string");
      // Word-boundary match so substrings like "your_neighbour" inside
      // sentences wouldn't false-positive (none today, but future-proof).
      expect(txt, `explainers.${key} still uses 1st person: "${txt}"`)
        .not.toMatch(/\byou\b|\byour\b/i);
    });
  }
});
