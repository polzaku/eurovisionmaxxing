export function seenHintsKey(roomId: string): string {
  return `emx_hints_seen_${roomId}`;
}

export function isSeen(roomId: string): boolean {
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : (globalThis as any).localStorage;
    if (!ls) return false;
    return ls.getItem(seenHintsKey(roomId)) === "true";
  } catch {
    return false;
  }
}

export function markSeen(roomId: string): void {
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : (globalThis as any).localStorage;
    if (!ls) return;
    ls.setItem(seenHintsKey(roomId), "true");
  } catch {
    /* swallow — Safari private mode or quota */
  }
}
