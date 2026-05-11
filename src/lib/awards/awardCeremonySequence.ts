import type { Contestant, RoomAward } from "@/types";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";
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

/**
 * Synthetic award shape used by the personal-neighbour ceremony card. Mirrors
 * the `RoomAward` field set so the existing sequence machinery (sorting,
 * keying) keeps working without a special case. `winnerUserId` is the
 * viewer; `winnerUserIdB` is the neighbour.
 */
function syntheticPersonalNeighbourAward(
  viewer: MemberView,
  neighbour: MemberView,
  pearson: number,
): RoomAward {
  return {
    roomId: "",
    awardKey: "your_neighbour",
    awardName: "Your closest neighbour",
    winnerUserId: viewer.userId,
    winnerUserIdB: neighbour.userId,
    winnerContestantId: null,
    statValue: pearson,
    statLabel: `Pearson ${pearson.toFixed(2)}`,
  };
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
    }
  | {
      kind: "personal-neighbour";
      award: RoomAward;
      viewerUser: MemberView;
      neighbourUser: MemberView;
      pearson: number;
      isReciprocal: boolean;
    };

const PERSONALITY_RANK = new Map<string, number>(
  PERSONALITY_AWARD_KEYS.map((k, i) => [k, i]),
);

// Personal-neighbour slots immediately after neighbourhood_voters in the
// SPEC §11.3 sequence. We give it the rank of neighbourhood_voters + 0.5
// so the existing sort places it correctly without changing the canonical
// PERSONALITY_AWARD_KEYS list (which represents persisted awards only).
const NEIGHBOURHOOD_RANK =
  PERSONALITY_RANK.get("neighbourhood_voters") ?? 99;
const PERSONAL_NEIGHBOUR_RANK = NEIGHBOURHOOD_RANK + 0.5;

export interface PersonalNeighbourOptions {
  personalNeighbours?: PersonalNeighbour[];
  viewerUserId?: string | null;
}

/**
 * Produces the ordered card sequence for the SPEC §11.3 cinematic reveal.
 * Category awards lead in voting-category order; personality awards follow
 * the SPEC-prescribed `PERSONALITY_AWARD_KEYS` order (Biggest stan first,
 * The enabler always last). The synthetic `your_neighbour` card (§11.2 V1.1)
 * is spliced immediately after `neighbourhood_voters` when both
 * `personalNeighbours` and `viewerUserId` resolve to an entry.
 * Awards whose winner can't be resolved against the members/contestants
 * pools are dropped defensively.
 */
export function awardCeremonySequence(
  awards: RoomAward[],
  contestants: Contestant[],
  members: MemberView[],
  categories: VotingCategoryLite[],
  options: PersonalNeighbourOptions = {},
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

  // Splice the personal-neighbour synthetic card if the viewer has an entry
  // and both ends resolve against the member roster.
  const { personalNeighbours, viewerUserId } = options;
  if (personalNeighbours && viewerUserId) {
    const entry = personalNeighbours.find((p) => p.userId === viewerUserId);
    if (entry) {
      const viewer = memberById.get(entry.userId);
      const neighbour = memberById.get(entry.neighbourUserId);
      if (viewer && neighbour) {
        cards.push({
          kind: "personal-neighbour",
          award: syntheticPersonalNeighbourAward(
            viewer,
            neighbour,
            entry.pearson,
          ),
          viewerUser: viewer,
          neighbourUser: neighbour,
          pearson: entry.pearson,
          isReciprocal: entry.isReciprocal,
        });
      }
    }
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
    const ai = rankFor(a.award.awardKey);
    const bi = rankFor(b.award.awardKey);
    return ai - bi;
  });

  return cards;
}

function rankFor(awardKey: string): number {
  if (awardKey === "your_neighbour") return PERSONAL_NEIGHBOUR_RANK;
  return PERSONALITY_RANK.get(awardKey) ?? 99;
}
