export interface StaggerTickInput {
  elapsedMs: number;
  staggerMs: number;
  totalSteps: number;
}

/**
 * Maps elapsed time since ceremony start to the current snapshot step.
 *
 * - Step 0 = initial snapshot (no reveals applied).
 * - Step N = leaderboard fully revealed.
 *
 * elapsedMs in [0, staggerMs) → step 0
 * elapsedMs in [k×staggerMs, (k+1)×staggerMs) → step k
 * elapsedMs >= totalSteps × staggerMs → totalSteps (clamped, complete)
 *
 * Negative elapsed, totalSteps=0, staggerMs=0 all degrade to step 0.
 */
export function staggerTick(input: StaggerTickInput): number {
  const { elapsedMs, staggerMs, totalSteps } = input;
  if (totalSteps <= 0) return 0;
  if (staggerMs <= 0) return 0;
  if (elapsedMs <= 0) return 0;
  const raw = Math.floor(elapsedMs / staggerMs);
  return Math.min(raw, totalSteps);
}
