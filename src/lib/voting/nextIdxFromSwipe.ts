/**
 * Map a horizontal swipe delta to the next contestant index, respecting
 * boundaries. Pure function — UI calls this with the touchstart/touchend
 * delta and applies the result.
 *
 * deltaX > threshold (finger moved right) → previous contestant.
 * deltaX < -threshold (finger moved left) → next contestant.
 * Strict greater-than so a 50px tap-with-drift doesn't navigate.
 */
export function nextIdxFromSwipe(
  currentIdx: number,
  total: number,
  deltaX: number,
  threshold: number = 50
): number | null {
  if (deltaX > threshold) {
    return currentIdx > 0 ? currentIdx - 1 : null;
  }
  if (deltaX < -threshold) {
    return currentIdx < total - 1 ? currentIdx + 1 : null;
  }
  return null;
}
