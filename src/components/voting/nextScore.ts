/**
 * Reducer for ScoreRow button taps.
 * Tap a button that isn't selected → that value becomes the new score.
 * Tap the currently-selected button → cleared (null).
 * See docs/superpowers/specs/2026-04-21-score-row-design.md §6.
 */
export function nextScore(
  current: number | null,
  clicked: number
): number | null {
  return current === clicked ? null : clicked;
}
