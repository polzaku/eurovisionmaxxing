import { describe, it, expect } from "vitest";
import { seedMissedFromVotes } from "@/lib/voting/seedMissedFromVotes";
import type { VoteView } from "@/lib/rooms/get";

function vote(partial: Partial<VoteView>): VoteView {
  return {
    contestantId: "2026-FR",
    scores: null,
    missed: false,
    hotTake: null,
    updatedAt: "2026-04-25T12:00:00Z",
    ...partial,
  };
}

describe("seedMissedFromVotes", () => {
  it("returns an empty map for no votes", () => {
    expect(seedMissedFromVotes([], ["2026-FR", "2026-DE"])).toEqual({});
  });

  it("includes only contestants with missed: true", () => {
    const votes: VoteView[] = [
      vote({ contestantId: "2026-FR", missed: true }),
      vote({ contestantId: "2026-DE", missed: false }),
      vote({ contestantId: "2026-IT", missed: true }),
    ];
    const result = seedMissedFromVotes(votes, ["2026-FR", "2026-DE", "2026-IT"]);
    expect(result).toEqual({ "2026-FR": true, "2026-IT": true });
  });

  it("filters out votes for contestants not in the room's roster", () => {
    const votes: VoteView[] = [
      vote({ contestantId: "2026-FR", missed: true }),
      vote({ contestantId: "2026-XX-stale", missed: true }),
    ];
    const result = seedMissedFromVotes(votes, ["2026-FR", "2026-DE"]);
    expect(result).toEqual({ "2026-FR": true });
  });
});
