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
});
