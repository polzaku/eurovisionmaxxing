import { describe, it, expect } from "vitest";
import {
  leaderboardSequence,
  type LeaderboardSnapshot,
} from "./leaderboardSequence";
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

function mkContestant(id: string, country = id): Contestant {
  return {
    id,
    year: 2026,
    event: "final",
    countryCode: id.split("-")[1] ?? "XX",
    country,
    artist: "Artist",
    song: "Song",
    flagEmoji: "🏳️",
    runningOrder: 1,
  };
}

describe("leaderboardSequence", () => {
  it("returns one initial snapshot when there are no contestants", () => {
    const seq = leaderboardSequence([], []);
    expect(seq).toHaveLength(1);
    expect(seq[0]).toEqual([]);
  });

  it("produces N+1 snapshots for N contestants (initial + one per reveal)", () => {
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    expect(seq).toHaveLength(4);
  });

  it("initial snapshot has every contestant at 0 pts and null rank, sorted by contestantId", () => {
    const contestants = [
      mkContestant("2026-UK"),
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    expect(seq[0]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-AT", pointsAwarded: 0, rank: null },
      { contestantId: "2026-FR", pointsAwarded: 0, rank: null },
      { contestantId: "2026-UK", pointsAwarded: 0, rank: null },
    ]);
  });

  it("reveals worst-first; intermediate snapshots include partial reveals re-sorted by points desc", () => {
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // After step 1: AT (worst, 4 pts) is revealed; FR + UK still at 0.
    expect(seq[1]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-AT", pointsAwarded: 4, rank: 3 },
      { contestantId: "2026-FR", pointsAwarded: 0, rank: null },
      { contestantId: "2026-UK", pointsAwarded: 0, rank: null },
    ]);
    // After step 2: FR (8 pts) climbs above AT.
    expect(seq[2]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-FR", pointsAwarded: 8, rank: 2 },
      { contestantId: "2026-AT", pointsAwarded: 4, rank: 3 },
      { contestantId: "2026-UK", pointsAwarded: 0, rank: null },
    ]);
    // Final snapshot: full leaderboard.
    expect(seq[3]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-UK", pointsAwarded: 12, rank: 1 },
      { contestantId: "2026-FR", pointsAwarded: 8, rank: 2 },
      { contestantId: "2026-AT", pointsAwarded: 4, rank: 3 },
    ]);
  });

  it("preserves competition-rank ties in the final snapshot (1, 2, 2, 4 pattern)", () => {
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-IT"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-IT", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 4 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // Final snapshot ranks reflect input.
    expect(seq[seq.length - 1].map((s) => s.rank)).toEqual([1, 2, 2, 4]);
  });

  it("walks worst-first using contestantId as the inner tiebreak among tied final ranks", () => {
    // FR (8, rank 2) and IT (8, rank 2) — IT comes first alphabetically by id "2026-IT" > "2026-FR" so FR is "worse" in walk order.
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-IT"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-FR", totalPoints: 8, rank: 1 },
      { contestantId: "2026-IT", totalPoints: 8, rank: 1 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // First reveal is the worst — AT (rank 3).
    const firstRevealed = seq[1].find((s) => s.pointsAwarded > 0);
    expect(firstRevealed?.contestantId).toBe("2026-AT");
    // Second reveal walks ties worst-first by contestantId desc within the tie band.
    // IT > FR alphabetically, so within the "rank 1, 8 pts" tie band, IT is revealed before FR.
    const secondRevealed = seq[2]
      .filter((s) => s.pointsAwarded > 0)
      .map((s) => s.contestantId)
      .sort();
    expect(secondRevealed).toEqual(["2026-AT", "2026-IT"]);
  });

  it("includes contestants in the field that are missing from the leaderboard at 0 pts (defensive)", () => {
    // Real data always seeds via buildLeaderboardSeeded so this is unreachable, but the helper is robust.
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      // FR missing from the leaderboard.
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 2 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // Initial includes FR at 0.
    const ids = seq[0].map((s) => s.contestantId);
    expect(ids).toContain("2026-FR");
    // FR stays at 0 in every snapshot — never gets revealed.
    for (const snap of seq) {
      const fr = snap.find((s) => s.contestantId === "2026-FR");
      expect(fr?.pointsAwarded).toBe(0);
      expect(fr?.rank).toBeNull();
    }
    // 2 reveals happened (UK + AT), so 3 snapshots total.
    expect(seq).toHaveLength(3);
  });

  it("handles 0-point leaderboard entries — they still count as a reveal step (rank becomes non-null)", () => {
    const contestants = [mkContestant("2026-AT"), mkContestant("2026-UK")];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 8, rank: 1 },
      { contestantId: "2026-AT", totalPoints: 0, rank: 2 },
    ];

    const seq = leaderboardSequence(final, contestants);
    expect(seq).toHaveLength(3);
    // Step 1: AT (worst per leaderboard) gets revealed at 0 pts; rank is now 2 (no longer null).
    const at1 = seq[1].find((s) => s.contestantId === "2026-AT");
    expect(at1).toEqual({ contestantId: "2026-AT", pointsAwarded: 0, rank: 2 });
  });
});
