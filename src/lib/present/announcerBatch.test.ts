import { describe, it, expect } from "vitest";
import { derivePicks } from "./announcerBatch";
import type { Contestant } from "@/types";

function mk(code: string, country: string, order: number): Contestant {
  return {
    id: `2026-${code}`,
    year: 2026,
    event: "final",
    countryCode: code,
    country,
    artist: "A",
    song: "S",
    flagEmoji: `flag-${code}`,
    runningOrder: order,
  };
}

const CONTESTANTS = new Map([
  ["2026-se", mk("se", "Sweden", 1)],
  ["2026-ua", mk("ua", "Ukraine", 2)],
  ["2026-fr", mk("fr", "France", 3)],
]);

describe("derivePicks", () => {
  it("returns [] when committed is undefined", () => {
    const live = [{ contestantId: "2026-se", totalPoints: 5, rank: 1 }];
    expect(derivePicks(undefined, live, CONTESTANTS)).toEqual([]);
  });

  it("returns [] when live is undefined", () => {
    const committed = [{ contestantId: "2026-se", totalPoints: 5, rank: 1 }];
    expect(derivePicks(committed, undefined, CONTESTANTS)).toEqual([]);
  });

  it("returns [] when live equals committed (no picks yet)", () => {
    const same = [{ contestantId: "2026-se", totalPoints: 5, rank: 1 }];
    expect(derivePicks(same, same, CONTESTANTS)).toEqual([]);
  });

  it("returns one entry per delta contestant, sorted ascending by points", () => {
    const committed = [
      { contestantId: "2026-se", totalPoints: 10, rank: 1 },
      { contestantId: "2026-ua", totalPoints: 8, rank: 2 },
      { contestantId: "2026-fr", totalPoints: 2, rank: 3 },
    ];
    const live = [
      { contestantId: "2026-se", totalPoints: 12, rank: 1 }, // +2
      { contestantId: "2026-ua", totalPoints: 16, rank: 2 }, // +8
      { contestantId: "2026-fr", totalPoints: 3, rank: 3 }, //  +1
    ];
    const picks = derivePicks(committed, live, CONTESTANTS);
    expect(picks.map((p) => ({ id: p.contestantId, pts: p.points }))).toEqual([
      { id: "2026-fr", pts: 1 },
      { id: "2026-se", pts: 2 },
      { id: "2026-ua", pts: 8 },
    ]);
  });

  it("attaches country + flag from the contestant lookup", () => {
    const committed = [{ contestantId: "2026-se", totalPoints: 0, rank: 1 }];
    const live = [{ contestantId: "2026-se", totalPoints: 12, rank: 1 }];
    const [pick] = derivePicks(committed, live, CONTESTANTS);
    expect(pick).toMatchObject({
      contestantId: "2026-se",
      country: "Sweden",
      flagEmoji: "flag-se",
      points: 12,
    });
  });

  it("falls back to contestantId + '🏳️' when contestant lookup misses", () => {
    const committed = [{ contestantId: "2026-zz", totalPoints: 0, rank: 1 }];
    const live = [{ contestantId: "2026-zz", totalPoints: 7, rank: 1 }];
    const [pick] = derivePicks(committed, live, CONTESTANTS);
    expect(pick).toMatchObject({
      contestantId: "2026-zz",
      country: "2026-zz",
      flagEmoji: "🏳️",
      points: 7,
    });
  });

  it("treats contestants missing from committed as zero baseline", () => {
    // Live introduced a contestant the snapshot didn't carry — full live
    // total counts as the announcer's contribution.
    const committed = [{ contestantId: "2026-se", totalPoints: 5, rank: 1 }];
    const live = [
      { contestantId: "2026-se", totalPoints: 5, rank: 1 },
      { contestantId: "2026-ua", totalPoints: 10, rank: 2 },
    ];
    const picks = derivePicks(committed, live, CONTESTANTS);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ contestantId: "2026-ua", points: 10 });
  });

  it("ignores negative or zero deltas (defensive: shouldn't happen in practice)", () => {
    const committed = [
      { contestantId: "2026-se", totalPoints: 10, rank: 1 },
      { contestantId: "2026-ua", totalPoints: 5, rank: 2 },
    ];
    const live = [
      { contestantId: "2026-se", totalPoints: 8, rank: 1 }, // -2 (defensive ignore)
      { contestantId: "2026-ua", totalPoints: 5, rank: 2 }, // 0
    ];
    expect(derivePicks(committed, live, CONTESTANTS)).toEqual([]);
  });
});
