import { describe, it, expect } from "vitest";
import { summarizeContestantStatus } from "@/lib/voting/contestantStatus";

describe("summarizeContestantStatus", () => {
  it("returns 'missed' when missedByContestant flag is set, even with full scores", () => {
    const result = summarizeContestantStatus(
      "c1",
      { c1: { Vocals: 7, Stage: 8 } },
      { c1: true },
      ["Vocals", "Stage"]
    );
    expect(result).toBe("missed");
  });

  it("returns 'scored' when all category names have numeric scores", () => {
    const result = summarizeContestantStatus(
      "c1",
      { c1: { Vocals: 7, Stage: 8 } },
      {},
      ["Vocals", "Stage"]
    );
    expect(result).toBe("scored");
  });

  it("returns 'unscored' when at least one category has no numeric score", () => {
    const result = summarizeContestantStatus(
      "c1",
      { c1: { Vocals: 7 } },
      {},
      ["Vocals", "Stage"]
    );
    expect(result).toBe("unscored");
  });

  it("returns 'unscored' when contestant has no entry in either map", () => {
    expect(summarizeContestantStatus("c1", {}, {}, ["Vocals"])).toBe("unscored");
  });

  it("returns 'unscored' for an empty categoryNames list (defensive)", () => {
    expect(summarizeContestantStatus("c1", { c1: {} }, {}, [])).toBe("unscored");
  });
});
