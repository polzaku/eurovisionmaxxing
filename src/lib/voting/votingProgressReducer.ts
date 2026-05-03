import type { RoomEvent } from "@/types";

/**
 * SPEC §8.8 voting-progress chip state. Maps each contestant id to the
 * set of user ids whose vote on that contestant is fully scored
 * (every category filled, `missed` is false). Counts derived via
 * `countsFromState(state, contestantId)`.
 */
export type VotingProgressState = Map<string, Set<string>>;

export function initialVotingProgressState(): VotingProgressState {
  return new Map();
}

export function countsFromState(
  state: VotingProgressState,
  contestantId: string,
): number {
  return state.get(contestantId)?.size ?? 0;
}

/**
 * Reducer: applies one room event. For `voting_progress`, the user is
 * marked fully-scored on the contestant iff `scoredCount === categoriesCount`
 * and `categoriesCount > 0`. The server already collapses `missed: true`
 * into `scoredCount: 0` (see `votes/upsert.ts` §5), so we don't need
 * a separate `missed` field.
 *
 * Returns the same reference when the event isn't a `voting_progress`.
 */
export function nextVotingProgress(
  prev: VotingProgressState,
  event: RoomEvent,
  categoriesCount: number,
): VotingProgressState {
  if (event.type !== "voting_progress") return prev;

  const next = new Map(prev);
  const existing = next.get(event.contestantId);
  const set = new Set(existing ?? []);

  if (categoriesCount > 0 && event.scoredCount === categoriesCount) {
    set.add(event.userId);
  } else {
    set.delete(event.userId);
  }

  next.set(event.contestantId, set);
  return next;
}
