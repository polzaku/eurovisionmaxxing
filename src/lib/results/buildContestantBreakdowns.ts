import type { UserBreakdown } from "@/lib/results/loadResults";

export interface ContestantGive {
  userId: string;
  displayName: string;
  avatarSeed: string;
  pointsAwarded: number;
}

export interface ContestantBreakdown {
  contestantId: string;
  /** Sorted by pointsAwarded desc, then displayName asc as a stable tiebreak. */
  gives: ContestantGive[];
}

/**
 * Inverts the per-user `breakdowns` array into a per-contestant view used by
 * the `/results/[id]` leaderboard drill-down (Phase U — country drill-down).
 *
 * The upstream loader (`loadResults` → `done`) already drops 0-point picks
 * when building `UserBreakdown.picks`, so unranked contestants never appear
 * here — that's the single source of truth for "who got points from whom"
 * and we don't fabricate empty rows for the bottom of the field.
 */
export function buildContestantBreakdowns(
  breakdowns: UserBreakdown[],
): ContestantBreakdown[] {
  const byContestant = new Map<string, ContestantGive[]>();
  for (const b of breakdowns) {
    for (const pick of b.picks) {
      const list = byContestant.get(pick.contestantId) ?? [];
      list.push({
        userId: b.userId,
        displayName: b.displayName,
        avatarSeed: b.avatarSeed,
        pointsAwarded: pick.pointsAwarded,
      });
      byContestant.set(pick.contestantId, list);
    }
  }
  const result: ContestantBreakdown[] = [];
  for (const [contestantId, gives] of byContestant.entries()) {
    gives.sort((a, b) => {
      if (a.pointsAwarded !== b.pointsAwarded) {
        return b.pointsAwarded - a.pointsAwarded;
      }
      return a.displayName.localeCompare(b.displayName);
    });
    result.push({ contestantId, gives });
  }
  return result;
}
