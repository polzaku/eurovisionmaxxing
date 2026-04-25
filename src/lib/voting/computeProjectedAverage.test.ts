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
});
