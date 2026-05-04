import type { Contestant } from "@/types";
import { scoredCount } from "@/components/voting/scoredCount";
import { endOfVotingState } from "./endOfVotingState";

/**
 * Variant rendered by <EndOfVotingCard>.
 *
 * SPEC §8.11 — gates the card on three OR'd conditions evaluated only
 * when the user is on the last contestant:
 *   (a) Self-finished — viewer has fully scored or marked missed every
 *       category on the last contestant.
 *   (b) Room momentum — strictly more than half of eligible voters have
 *       fully voted on the last contestant.
 *   (c) Room finished — every eligible voter has fully voted on every
 *       contestant.
 *
 * If none hold the card is suppressed (`{ kind: "none" }`). Otherwise
 * the variant is chosen by viewer role × user state per §8.11.2.
 */
export type EndOfVotingCardVariant =
  | { kind: "none" }
  | { kind: "guestAllScored"; total: number }
  | { kind: "guestMissedSome"; missed: Contestant[] }
  | { kind: "guestUnscored"; unscored: Contestant[] }
  | { kind: "guestRoomMomentum"; unscored: Contestant[] }
  | { kind: "hostAllDone"; ready: number; total: number }
  | { kind: "hostMostDone"; ready: number; total: number }
  | { kind: "hostSelfDoneOnly"; ready: number; total: number }
  /**
   * SPEC §8.11.2 "Count semantics — no degenerate `1 of 1` fallback".
   * Fires when condition (a) holds (the host finished their own vote on
   * the last contestant) but no `roomCompletion` data is available — drop
   * the count entirely rather than print misleading "1 of 1 done so far".
   * Conditions (b) and (c) require room data by definition, so the
   * `hostMostDone` / `hostAllDone` variants don't have a no-count form.
   */
  | { kind: "hostSelfDoneOnlyNoCount" };

export interface EndOfVotingCardInput {
  contestants: readonly Contestant[];
  categoryNames: readonly string[];
  scoresByContestant: Record<
    string,
    Record<string, number | null> | undefined
  >;
  missedByContestant: Record<string, boolean>;
  /** Whether the viewer is currently on the last contestant in the array. */
  onLastContestant: boolean;
  viewerRole: "admin" | "guest";
  /**
   * Optional room-wide completion data. If absent, only condition (a) can
   * fire — (b) and (c) require knowing how other voters are progressing.
   * Numbers count voters *other than* the viewer, so the helper can add
   * the viewer's own state from local vote data without double-counting.
   */
  roomCompletion?: {
    /** Other voters who have fully voted on the last contestant. */
    lastContestantCompletedOthers: number;
    /** Total eligible voter count, including the viewer. */
    eligibleVoterCount: number;
    /** True iff every eligible voter has fully voted on every contestant. */
    allEligibleAllDone: boolean;
  };
}

function viewerCompletedContestant(
  c: Contestant,
  scoresByContestant: EndOfVotingCardInput["scoresByContestant"],
  missedByContestant: EndOfVotingCardInput["missedByContestant"],
  categoryNames: readonly string[],
): boolean {
  if (missedByContestant[c.id]) return true;
  return scoredCount(scoresByContestant[c.id], categoryNames) === categoryNames.length;
}

export function endOfVotingCardVariant(
  input: EndOfVotingCardInput,
): EndOfVotingCardVariant {
  if (!input.onLastContestant) return { kind: "none" };

  const last = input.contestants[input.contestants.length - 1];
  if (!last) return { kind: "none" };

  // Condition (a) — viewer completed the last contestant.
  const conditionA = viewerCompletedContestant(
    last,
    input.scoresByContestant,
    input.missedByContestant,
    input.categoryNames,
  );

  // Conditions (b) and (c) require room-wide data. Without it, only (a)
  // can fire and the host gets the no-count variant — never the misleading
  // single-user-default "1 of 1 done so far".
  const hasRoomData = !!input.roomCompletion;
  let conditionB = false;
  let conditionC = false;
  let ready = 0;
  let total = 0;

  if (input.roomCompletion) {
    const { lastContestantCompletedOthers, eligibleVoterCount, allEligibleAllDone } =
      input.roomCompletion;
    total = eligibleVoterCount;
    ready = lastContestantCompletedOthers + (conditionA ? 1 : 0);
    conditionB = eligibleVoterCount > 0 && ready * 2 > eligibleVoterCount;
    conditionC = allEligibleAllDone;
  }

  if (!conditionA && !conditionB && !conditionC) {
    return { kind: "none" };
  }

  if (input.viewerRole === "admin") {
    if (conditionC) return { kind: "hostAllDone", ready, total };
    if (conditionB) return { kind: "hostMostDone", ready, total };
    if (conditionA) {
      // No-count variant when room-wide data isn't plumbed through —
      // protects against the "1 of 1 done so far" footgun on multi-member
      // rooms before voting_progress broadcasts arrive.
      if (!hasRoomData) return { kind: "hostSelfDoneOnlyNoCount" };
      return { kind: "hostSelfDoneOnly", ready, total };
    }
    return { kind: "none" };
  }

  // Guest — derive viewer's per-vote summary to pick the right copy.
  const summary = endOfVotingState({
    contestants: input.contestants,
    categoryNames: input.categoryNames,
    scoresByContestant: input.scoresByContestant,
    missedByContestant: input.missedByContestant,
  });

  if (conditionA) {
    if (summary.kind === "allScored") {
      return { kind: "guestAllScored", total: summary.total };
    }
    if (summary.kind === "missedSome") {
      return { kind: "guestMissedSome", missed: summary.missed };
    }
    return { kind: "guestUnscored", unscored: summary.unscored };
  }

  // Viewer didn't finish the last card but the room momentum is firing.
  if (conditionB) {
    if (summary.kind === "unscored") {
      return { kind: "guestRoomMomentum", unscored: summary.unscored };
    }
    return { kind: "none" };
  }

  return { kind: "none" };
}
