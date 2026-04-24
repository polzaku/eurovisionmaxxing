/**
 * Count how many of `categoryNames` have a numeric score in `scores`.
 * - `undefined` scores → 0 (never-touched)
 * - `null` values → not counted (explicitly cleared)
 * - Keys outside `categoryNames` are ignored.
 *
 * See docs/superpowers/specs/2026-04-21-voting-screen-skeleton-design.md §7.
 */
export function scoredCount(
  scores: Record<string, number | null> | undefined,
  categoryNames: readonly string[]
): number {
  if (!scores) return 0;
  let count = 0;
  for (const name of categoryNames) {
    if (typeof scores[name] === "number") count += 1;
  }
  return count;
}
