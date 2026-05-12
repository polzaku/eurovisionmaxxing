/**
 * Canonical Eurovision points sequence for the full reveal style.
 * Each announcer awards exactly these 10 values to 10 different contestants,
 * revealed one at a time in this order. Short style auto-batches 1–8 + 10
 * and only the 12-point reveal is live.
 *
 * SPEC §10.2.2.
 */
export const FULL_REVEAL_POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12] as const;

export interface StillToGiveSplit {
  given: readonly number[];
  remaining: readonly number[];
}

/**
 * Split the canonical full-style points sequence into already-given vs
 * still-to-give based on `currentAnnounceIdx`. Out-of-range inputs clamp
 * to [0, FULL_REVEAL_POINTS.length] — defensive, since the announcement
 * pointer is server-authoritative but the helper consumes it as a plain
 * number prop.
 */
export function stillToGive(currentAnnounceIdx: number): StillToGiveSplit {
  const clamped = Math.max(
    0,
    Math.min(currentAnnounceIdx, FULL_REVEAL_POINTS.length),
  );
  return {
    given: FULL_REVEAL_POINTS.slice(0, clamped),
    remaining: FULL_REVEAL_POINTS.slice(clamped),
  };
}
