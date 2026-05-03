import type { Contestant, RoomAward } from "@/types";
import { PERSONALITY_AWARD_KEYS, categoryAwardKey } from "./awardKeys";

export interface MemberView {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

export interface VotingCategoryLite {
  name: string;
  key?: string;
}

export type CeremonyCard =
  | {
      kind: "contestant";
      award: RoomAward;
      contestant: Contestant | null;
    }
  | {
      kind: "user";
      award: RoomAward;
      winner: MemberView | null;
      partner: MemberView | null;
    };

const PERSONALITY_RANK = new Map<string, number>(
  PERSONALITY_AWARD_KEYS.map((k, i) => [k, i]),
);

/**
 * Produces the ordered card sequence for the SPEC §11.3 cinematic reveal.
 * Category awards lead in voting-category order; personality awards follow
 * the SPEC-prescribed `PERSONALITY_AWARD_KEYS` order (Biggest stan first,
 * The enabler always last). Awards whose winner can't be resolved against
 * the members/contestants pools are dropped defensively.
 */
export function awardCeremonySequence(
  awards: RoomAward[],
  contestants: Contestant[],
  members: MemberView[],
  categories: VotingCategoryLite[],
): CeremonyCard[] {
  const contestantById = new Map(contestants.map((c) => [c.id, c]));
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const categoryOrder = new Map<string, number>(
    categories.map((c, i) => [
      categoryAwardKey({ name: c.name, weight: 1, key: c.key }),
      i,
    ]),
  );

  const cards: CeremonyCard[] = [];

  for (const a of awards) {
    if (a.awardKey.startsWith("best_") || a.winnerContestantId) {
      cards.push({
        kind: "contestant",
        award: a,
        contestant: a.winnerContestantId
          ? contestantById.get(a.winnerContestantId) ?? null
          : null,
      });
      continue;
    }

    const winner = a.winnerUserId ? memberById.get(a.winnerUserId) : undefined;
    if (!winner) continue;

    const partner = a.winnerUserIdB
      ? memberById.get(a.winnerUserIdB) ?? null
      : null;

    cards.push({ kind: "user", award: a, winner, partner });
  }

  cards.sort((a, b) => {
    const aCat = a.award.awardKey.startsWith("best_");
    const bCat = b.award.awardKey.startsWith("best_");
    if (aCat && !bCat) return -1;
    if (!aCat && bCat) return 1;
    if (aCat && bCat) {
      const ai = categoryOrder.get(a.award.awardKey) ?? 99;
      const bi = categoryOrder.get(b.award.awardKey) ?? 99;
      return ai - bi;
    }
    const ai = PERSONALITY_RANK.get(a.award.awardKey) ?? 99;
    const bi = PERSONALITY_RANK.get(b.award.awardKey) ?? 99;
    return ai - bi;
  });

  return cards;
}
