export interface VotingEndingTimerInput {
  votingEndsAt: string | null;
  now: Date;
}

export interface VotingEndingTimerResult {
  remainingMs: number;
  remainingSeconds: number;
  expired: boolean;
}

const ZERO: VotingEndingTimerResult = {
  remainingMs: 0,
  remainingSeconds: 0,
  expired: false,
};

/**
 * Pure helper for the SPEC §6.3.1 5-second undo countdown.
 * Returns remaining time and an `expired` flag derived from a server-issued
 * deadline ISO string and a caller-supplied "now" reference.
 *
 * Behaviour:
 *   - votingEndsAt is null → caller should not render a countdown (zero/false).
 *   - votingEndsAt parses to NaN → graceful zero/false fallback.
 *   - votingEndsAt is in the past or equals now → expired=true, remainingMs clamped to 0.
 *   - Otherwise → remainingMs is the positive delta and remainingSeconds is its ceil.
 */
export function votingEndingTimer(
  input: VotingEndingTimerInput
): VotingEndingTimerResult {
  if (input.votingEndsAt === null) return ZERO;
  const t = Date.parse(input.votingEndsAt);
  if (Number.isNaN(t)) return ZERO;
  const deltaMs = t - input.now.getTime();
  if (deltaMs <= 0) {
    return { remainingMs: 0, remainingSeconds: 0, expired: true };
  }
  return {
    remainingMs: deltaMs,
    remainingSeconds: Math.ceil(deltaMs / 1000),
    expired: false,
  };
}
