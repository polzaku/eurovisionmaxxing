import { describe, it, expect } from "vitest";
import {
  localizedAwardName,
  localizedAwardStat,
  localizedAwardExplainer,
} from "./localizedAwardCopy";

// Deterministic translator mock: echoes back `key + JSON(params)` so we
// can assert the exact key path the helper resolves to without needing
// the next-intl runtime.
const t = (
  key: string,
  values?: Record<string, string | number | undefined>,
): string =>
  values
    ? `${key}::${JSON.stringify(values)}`
    : key;

describe("localizedAwardName", () => {
  it("routes personality award keys through awards.personality.<key>.name", () => {
    expect(localizedAwardName(t, "biggest_stan", "Biggest stan")).toBe(
      "awards.personality.biggest_stan.name",
    );
    expect(localizedAwardName(t, "the_enabler", "The enabler")).toBe(
      "awards.personality.the_enabler.name",
    );
  });

  it("routes your_neighbour through its dedicated locale key", () => {
    expect(localizedAwardName(t, "your_neighbour", "Your closest neighbour"))
      .toBe("awards.your_neighbour.name");
  });

  it("strips the English 'Best ' prefix and wraps category awards via awards.bestCategory", () => {
    expect(localizedAwardName(t, "best_vocals", "Best Vocals")).toBe(
      'awards.bestCategory::{"categoryName":"Vocals"}',
    );
    expect(
      localizedAwardName(t, "best_outfit", "Best Outfit Commitment"),
    ).toBe(
      'awards.bestCategory::{"categoryName":"Outfit Commitment"}',
    );
  });

  it("falls back to the server-supplied name for unknown awardKeys", () => {
    expect(localizedAwardName(t, "the_oracle", "The Oracle")).toBe(
      "The Oracle",
    );
  });
});

describe("localizedAwardStat", () => {
  it("renders personality stats with the locale template + value param", () => {
    expect(localizedAwardStat(t, "biggest_stan", 8.9, "8.9 avg")).toBe(
      'awards.personality.biggest_stan.stat::{"value":8.9}',
    );
  });

  it("renders your_neighbour stat via its personality.<key>.stat path (rounded to 1 decimal)", () => {
    expect(localizedAwardStat(t, "your_neighbour", 0.84, "Pearson 0.84")).toBe(
      'awards.personality.your_neighbour.stat::{"value":0.8}',
    );
  });

  it("falls back to the server label for category awards (numeric-suffix is locale-independent in MVP)", () => {
    expect(localizedAwardStat(t, "best_vocals", null, "9.4 avg")).toBe(
      "9.4 avg",
    );
  });

  it("returns null when no statValue + no fallback", () => {
    expect(localizedAwardStat(t, "biggest_stan", null, null)).toBeNull();
    expect(localizedAwardStat(t, "best_vocals", null, null)).toBeNull();
  });

  // SPEC #12 — personality cards previously showed long-tail decimals
  // ("avg 8.9123456 / 10"). Round to one decimal at the helper layer so
  // every locale's stat template renders the same compact number without
  // ICU number-formatting noise.
  it("rounds personality stat values to 1 decimal before interpolation", () => {
    expect(localizedAwardStat(t, "biggest_stan", 8.94, null)).toBe(
      'awards.personality.biggest_stan.stat::{"value":8.9}',
    );
    expect(localizedAwardStat(t, "harshest_critic", 3.155, null)).toBe(
      'awards.personality.harshest_critic.stat::{"value":3.2}',
    );
    expect(localizedAwardStat(t, "your_neighbour", 0.834729, null)).toBe(
      'awards.personality.your_neighbour.stat::{"value":0.8}',
    );
  });

  it("leaves whole-number stat values intact (no trailing .0)", () => {
    expect(localizedAwardStat(t, "biggest_stan", 9, null)).toBe(
      'awards.personality.biggest_stan.stat::{"value":9}',
    );
  });
});

describe("localizedAwardExplainer", () => {
  it("returns null for category awards (self-evident name)", () => {
    expect(localizedAwardExplainer(t, "best_vocals")).toBeNull();
  });

  it("returns the locale-keyed path for personality awards", () => {
    expect(localizedAwardExplainer(t, "biggest_stan")).toBe(
      "awards.explainers.biggest_stan",
    );
  });

  it("returns the locale key for your_neighbour", () => {
    expect(localizedAwardExplainer(t, "your_neighbour")).toBe(
      "awards.explainers.your_neighbour",
    );
  });

  it("returns null for unknown keys", () => {
    expect(localizedAwardExplainer(t, "the_oracle")).toBeNull();
  });
});
