/**
 * SPEC §6.3.2 — late-joiner orientation card.
 *
 * Pure decision: should the late-joiner card be rendered for this user
 * on this room right now? The component itself is stateless; it relies
 * on this helper to gate.
 *
 * Detection heuristic (no schema column required):
 *   - The card surfaces only while status is `voting` / `voting_ending`.
 *   - If the user was on this room while it was in `lobby`, a per-room
 *     localStorage flag is set; that flag means "not a late joiner" and
 *     suppresses the card.
 *   - Once the user dismisses the card, a second per-room flag suppresses
 *     it permanently for that user/room pair.
 *
 * Both flags are localStorage so reload-safe and don't require a server
 * write. See `useLateJoinerVisibility` for the React wiring.
 */
export type LateJoinerVisibility = "show" | "hidden";

export interface LateJoinerVisibilityInput {
  status: string;
  /** True when the user was previously rendered with this room in `lobby` state. */
  lobbySeen: boolean;
  /** True when the user has dismissed the card on this room before. */
  dismissed: boolean;
}

export function lateJoinerVisibility(
  input: LateJoinerVisibilityInput,
): LateJoinerVisibility {
  if (input.dismissed) return "hidden";
  if (input.lobbySeen) return "hidden";
  if (input.status !== "voting" && input.status !== "voting_ending") {
    return "hidden";
  }
  return "show";
}
