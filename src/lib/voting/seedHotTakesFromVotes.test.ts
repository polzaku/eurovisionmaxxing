import { describe, it, expect } from "vitest";
import { seedHotTakesFromVotes } from "@/lib/voting/seedHotTakesFromVotes";
import type { VoteView } from "@/lib/rooms/get";

function vote(partial: Partial<VoteView>): VoteView {
  return {
    contestantId: "2026-FR",
    scores: null,
    missed: false,
    hotTake: null,
    updatedAt: "2026-04-26T12:00:00Z",
    ...partial,
  };
}

describe("seedHotTakesFromVotes", () => {
  it("returns an empty map for no votes", () => {
    expect(seedHotTakesFromVotes([], ["2026-FR", "2026-DE"])).toEqual({});
  });

  it("includes only contestants with non-empty hotTake", () => {
    const votes: VoteView[] = [
      vote({ contestantId: "2026-FR", hotTake: "this slaps" }),
      vote({ contestantId: "2026-DE", hotTake: null }),
      vote({ contestantId: "2026-IT", hotTake: "" }),
      vote({ contestantId: "2026-UK", hotTake: "douze points" }),
    ];
    const result = seedHotTakesFromVotes(votes, [
      "2026-FR",
      "2026-DE",
      "2026-IT",
      "2026-UK",
    ]);
    expect(result).toEqual({
      "2026-FR": "this slaps",
      "2026-UK": "douze points",
    });
  });

  it("filters out votes for contestants not in the room's roster", () => {
    const votes: VoteView[] = [
      vote({ contestantId: "2026-FR", hotTake: "kept" }),
      vote({ contestantId: "2026-XX-stale", hotTake: "discarded" }),
    ];
    const result = seedHotTakesFromVotes(votes, ["2026-FR", "2026-DE"]);
    expect(result).toEqual({ "2026-FR": "kept" });
  });
});
