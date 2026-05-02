import { describe, it, expect } from "vitest";
import type { Contestant } from "@/types";
import {
  endOfVotingCardVariant,
  type EndOfVotingCardInput,
} from "./endOfVotingCardVariant";

const C = (id: string, country: string, runningOrder: number): Contestant => ({
  id,
  country,
  countryCode: id.slice(-2),
  flagEmoji: "🏳️",
  artist: "A",
  song: "S",
  runningOrder,
  event: "final",
  year: 2026,
});

const CATEGORIES = ["vocals", "outfit"];
const fullScores = () => ({ vocals: 7, outfit: 8 });

const C_AL = C("2026-al", "Albania", 1);
const C_BE = C("2026-be", "Belgium", 2);
const C_CY = C("2026-cy", "Cyprus", 3);

function input(over: Partial<EndOfVotingCardInput> = {}): EndOfVotingCardInput {
  return {
    contestants: [C_AL, C_BE, C_CY],
    categoryNames: CATEGORIES,
    scoresByContestant: {},
    missedByContestant: {},
    onLastContestant: true,
    viewerRole: "guest",
    ...over,
  };
}

describe("endOfVotingCardVariant — gating", () => {
  it("returns none when viewer is not on the last contestant", () => {
    const v = endOfVotingCardVariant(
      input({
        onLastContestant: false,
        scoresByContestant: {
          "2026-al": fullScores(),
          "2026-be": fullScores(),
          "2026-cy": fullScores(),
        },
      }),
    );
    expect(v).toEqual({ kind: "none" });
  });

  it("returns none for a guest with none of (a)/(b)/(c) firing", () => {
    const v = endOfVotingCardVariant(input());
    expect(v).toEqual({ kind: "none" });
  });

  it("returns none for an admin with none of (a)/(b)/(c) firing", () => {
    const v = endOfVotingCardVariant(input({ viewerRole: "admin" }));
    expect(v).toEqual({ kind: "none" });
  });

  it("returns none when contestants list is empty", () => {
    const v = endOfVotingCardVariant(input({ contestants: [] }));
    expect(v).toEqual({ kind: "none" });
  });
});

describe("endOfVotingCardVariant — guest variants", () => {
  it("returns guestAllScored when (a) holds and viewer scored every contestant", () => {
    const v = endOfVotingCardVariant(
      input({
        scoresByContestant: {
          "2026-al": fullScores(),
          "2026-be": fullScores(),
          "2026-cy": fullScores(),
        },
      }),
    );
    expect(v).toEqual({ kind: "guestAllScored", total: 3 });
  });

  it("returns guestMissedSome when (a) holds, no unscored, but at least one missed", () => {
    const v = endOfVotingCardVariant(
      input({
        scoresByContestant: {
          "2026-al": fullScores(),
          "2026-cy": fullScores(),
        },
        missedByContestant: { "2026-be": true },
      }),
    );
    expect(v.kind).toBe("guestMissedSome");
    if (v.kind === "guestMissedSome") {
      expect(v.missed.map((c) => c.id)).toEqual(["2026-be"]);
    }
  });

  it("returns guestUnscored when (a) holds (last contestant done) but earlier ones unscored", () => {
    const v = endOfVotingCardVariant(
      input({
        scoresByContestant: {
          "2026-cy": fullScores(),
        },
      }),
    );
    expect(v.kind).toBe("guestUnscored");
    if (v.kind === "guestUnscored") {
      expect(v.unscored.map((c) => c.id)).toEqual(["2026-al", "2026-be"]);
    }
  });

  it("treats `missed=true` on the last contestant as completing it for (a)", () => {
    const v = endOfVotingCardVariant(
      input({
        scoresByContestant: {
          "2026-al": fullScores(),
          "2026-be": fullScores(),
        },
        missedByContestant: { "2026-cy": true },
      }),
    );
    expect(v.kind).toBe("guestMissedSome");
  });

  it("returns guestRoomMomentum when (b) fires but viewer hasn't completed the last contestant", () => {
    const v = endOfVotingCardVariant(
      input({
        scoresByContestant: {
          "2026-al": fullScores(),
          // viewer not done with 2026-cy (last)
        },
        roomCompletion: {
          lastContestantCompletedOthers: 3,
          eligibleVoterCount: 4,
          allEligibleAllDone: false,
        },
      }),
    );
    expect(v.kind).toBe("guestRoomMomentum");
    if (v.kind === "guestRoomMomentum") {
      // Both 2026-be and 2026-cy unscored from viewer's perspective
      expect(v.unscored.map((c) => c.id)).toEqual(["2026-be", "2026-cy"]);
    }
  });
});

describe("endOfVotingCardVariant — host variants", () => {
  it("returns hostAllDone when condition (c) holds for an admin viewer", () => {
    const v = endOfVotingCardVariant(
      input({
        viewerRole: "admin",
        scoresByContestant: {
          "2026-al": fullScores(),
          "2026-be": fullScores(),
          "2026-cy": fullScores(),
        },
        roomCompletion: {
          lastContestantCompletedOthers: 3,
          eligibleVoterCount: 4,
          allEligibleAllDone: true,
        },
      }),
    );
    expect(v).toEqual({ kind: "hostAllDone", ready: 4, total: 4 });
  });

  it("returns hostMostDone when (b) holds but (c) does not, for an admin", () => {
    const v = endOfVotingCardVariant(
      input({
        viewerRole: "admin",
        scoresByContestant: {
          // host hasn't finished last contestant
          "2026-al": fullScores(),
        },
        roomCompletion: {
          lastContestantCompletedOthers: 3,
          eligibleVoterCount: 4,
          allEligibleAllDone: false,
        },
      }),
    );
    expect(v.kind).toBe("hostMostDone");
    if (v.kind === "hostMostDone") {
      expect(v.ready).toBe(3);
      expect(v.total).toBe(4);
    }
  });

  it("returns hostSelfDoneOnly when only (a) holds for an admin viewer", () => {
    const v = endOfVotingCardVariant(
      input({
        viewerRole: "admin",
        scoresByContestant: {
          "2026-cy": fullScores(),
          // earlier contestants unscored, but admin completed the last one
        },
        roomCompletion: {
          lastContestantCompletedOthers: 0,
          eligibleVoterCount: 4,
          allEligibleAllDone: false,
        },
      }),
    );
    expect(v.kind).toBe("hostSelfDoneOnly");
    if (v.kind === "hostSelfDoneOnly") {
      expect(v.ready).toBe(1);
      expect(v.total).toBe(4);
    }
  });

  it("prefers (c) > (b) > (a) for admins", () => {
    // (c) wins over (b) — even though both could be true, (c) implies (b)
    const cWins = endOfVotingCardVariant(
      input({
        viewerRole: "admin",
        scoresByContestant: {
          "2026-al": fullScores(),
          "2026-be": fullScores(),
          "2026-cy": fullScores(),
        },
        roomCompletion: {
          lastContestantCompletedOthers: 3,
          eligibleVoterCount: 4,
          allEligibleAllDone: true,
        },
      }),
    );
    expect(cWins.kind).toBe("hostAllDone");

    // (b) wins over (a) — viewer also satisfies (a) but (b) takes priority
    const bWins = endOfVotingCardVariant(
      input({
        viewerRole: "admin",
        scoresByContestant: {
          "2026-al": fullScores(),
          "2026-be": fullScores(),
          "2026-cy": fullScores(),
        },
        roomCompletion: {
          lastContestantCompletedOthers: 3,
          eligibleVoterCount: 4,
          allEligibleAllDone: false,
        },
      }),
    );
    expect(bWins.kind).toBe("hostMostDone");
  });
});

describe("endOfVotingCardVariant — boundaries", () => {
  it("(b) requires strictly >50% — exactly half does not fire", () => {
    const v = endOfVotingCardVariant(
      input({
        viewerRole: "admin",
        scoresByContestant: {
          "2026-al": fullScores(),
        },
        roomCompletion: {
          lastContestantCompletedOthers: 2, // half of 4
          eligibleVoterCount: 4,
          allEligibleAllDone: false,
        },
      }),
    );
    expect(v).toEqual({ kind: "none" });
  });

  it("(b) fires once strictly more than half", () => {
    const v = endOfVotingCardVariant(
      input({
        viewerRole: "admin",
        scoresByContestant: {
          "2026-al": fullScores(),
        },
        roomCompletion: {
          lastContestantCompletedOthers: 3, // 75% of 4
          eligibleVoterCount: 4,
          allEligibleAllDone: false,
        },
      }),
    );
    expect(v.kind).toBe("hostMostDone");
  });

  it("uses the last contestant by array order, not running-order field", () => {
    // contestants array is [AL=1, BE=2, CY=3]; the last in *array* is the last
    // contestant for gating purposes. Callers pass them already sorted.
    const reordered = [C_CY, C_AL, C_BE];
    const v = endOfVotingCardVariant({
      contestants: reordered,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-be": fullScores() }, // last in array
      missedByContestant: {},
      onLastContestant: true,
      viewerRole: "guest",
    });
    expect(v.kind).toBe("guestUnscored");
  });
});
