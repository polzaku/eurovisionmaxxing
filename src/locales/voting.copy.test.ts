import { describe, it, expect } from "vitest";
import en from "./en.json";

// TODO #4 — the jump-to drawer ScoredByChip used to render "4 / 5
// scored", which testers couldn't tell from "4 / 5 categories" (the
// per-contestant category count). Disambiguate the chip copy so the
// units are explicit: "4 / 5 people scored" and "everyone scored".
//
// Guard the rendered words so an accidental revert can't silently
// re-introduce the ambiguity.
describe("en.json — ScoredByChip copy disambiguates people from categories", () => {
  it("voting.scoredChip.partial says 'people scored' (count is people, not categories)", () => {
    expect(en.voting.scoredChip.partial).toMatch(/people/i);
    expect(en.voting.scoredChip.partial).toMatch(/scored/i);
  });

  it("voting.scoredChip.all says 'everyone scored' (parallel to partial)", () => {
    expect(en.voting.scoredChip.all).toMatch(/everyone/i);
    expect(en.voting.scoredChip.all).toMatch(/scored/i);
  });
});
