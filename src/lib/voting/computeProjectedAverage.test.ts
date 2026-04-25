import { describe, it, expect } from "vitest";
import { computeProjectedAverage } from "@/lib/voting/computeProjectedAverage";

describe("computeProjectedAverage", () => {
  it("returns all-5 defaults when there are no votes", () => {
    const result = computeProjectedAverage(
      {},
      {},
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(result.perCategory).toEqual({ Vocals: 5, Stage: 5 });
    expect(result.overall).toBe(5);
  });

  it("averages a single contestant's scored values per category", () => {
    const result = computeProjectedAverage(
      { c1: { Vocals: 8, Stage: 6 } },
      {},
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(result.perCategory).toEqual({ Vocals: 8, Stage: 6 });
    expect(result.overall).toBe(7); // mean(8, 6) = 7
  });

  it("averages across multiple contestants per category", () => {
    const result = computeProjectedAverage(
      {
        c1: { Vocals: 8, Stage: 6 },
        c2: { Vocals: 6, Stage: 4 },
        c3: { Vocals: 10, Stage: 5 },
      },
      {},
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(result.perCategory).toEqual({ Vocals: 8, Stage: 5 }); // mean(8,6,10)=8, mean(6,4,5)=5
    expect(result.overall).toBe(7); // mean(8, 5) = 6.5 → 7
  });

  it("excludes contestants flagged as missed even if their scores are still in the map", () => {
    const result = computeProjectedAverage(
      {
        c1: { Vocals: 8, Stage: 6 },
        c2: { Vocals: 2, Stage: 2 }, // would drag the average down
      },
      { c2: true },
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(result.perCategory).toEqual({ Vocals: 8, Stage: 6 });
  });

  it("treats a category with no scored values as default 5 even when others have votes", () => {
    const result = computeProjectedAverage(
      { c1: { Vocals: 9 } }, // Stage missing
      {},
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(result.perCategory).toEqual({ Vocals: 9, Stage: 5 });
    expect(result.overall).toBe(7); // mean(9, 5) = 7
  });

  it("ignores null score values", () => {
    const result = computeProjectedAverage(
      { c1: { Vocals: null, Stage: 8 } },
      {},
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(result.perCategory).toEqual({ Vocals: 5, Stage: 8 });
  });

  it("rounds to nearest int — 6.5 → 7, 6.33 → 6", () => {
    const result1 = computeProjectedAverage(
      { c1: { Vocals: 6 }, c2: { Vocals: 7 } },
      {},
      [{ name: "Vocals" }]
    );
    expect(result1.perCategory.Vocals).toBe(7); // mean(6,7)=6.5 → 7

    const result2 = computeProjectedAverage(
      { c1: { Vocals: 6 }, c2: { Vocals: 6 }, c3: { Vocals: 7 } },
      {},
      [{ name: "Vocals" }]
    );
    expect(result2.perCategory.Vocals).toBe(6); // mean(6,6,7)=6.33 → 6
  });

  it("clamps overall to 1..10 (top end)", () => {
    const single10 = computeProjectedAverage(
      { c1: { Vocals: 10, Stage: 10 } },
      {},
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(single10.overall).toBe(10);
  });
});
