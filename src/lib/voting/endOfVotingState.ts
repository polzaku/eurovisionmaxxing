import type { Contestant } from "@/types";
import { scoredCount } from "@/components/voting/scoredCount";

export type EndOfVotingState =
  | { kind: "allScored"; total: number }
  | { kind: "missedSome"; missed: Contestant[] }
  | { kind: "unscored"; unscored: Contestant[] };

export interface EndOfVotingStateInput {
  contestants: readonly Contestant[];
  categoryNames: readonly string[];
  scoresByContestant: Record<
    string,
    Record<string, number | null> | undefined
  >;
  missedByContestant: Record<string, boolean>;
}

export function endOfVotingState(
  input: EndOfVotingStateInput
): EndOfVotingState {
  const { contestants, categoryNames, scoresByContestant, missedByContestant } =
    input;

  const missed: Contestant[] = [];
  const unscored: Contestant[] = [];

  for (const c of contestants) {
    if (missedByContestant[c.id]) {
      missed.push(c);
      continue;
    }
    const filled = scoredCount(scoresByContestant[c.id], categoryNames);
    if (filled !== categoryNames.length) {
      unscored.push(c);
    }
  }

  if (unscored.length > 0) return { kind: "unscored", unscored };
  if (missed.length > 0) return { kind: "missedSome", missed };
  return { kind: "allScored", total: contestants.length };
}
