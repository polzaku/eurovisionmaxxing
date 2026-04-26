export function nextExpandedId<T>(curr: T | null, clicked: T): T | null {
  return curr === clicked ? null : clicked;
}
