export function revealedFlagKey(roomId: string): string {
  return `emx_revealed_${roomId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined") return window.sessionStorage;
    const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return ss ?? null;
  } catch {
    return null;
  }
}

export function hasRevealed(roomId: string): boolean {
  try {
    const ss = getStorage();
    if (!ss) return false;
    return ss.getItem(revealedFlagKey(roomId)) === "true";
  } catch {
    return false;
  }
}

export function markRevealed(roomId: string): void {
  try {
    const ss = getStorage();
    if (!ss) return;
    ss.setItem(revealedFlagKey(roomId), "true");
  } catch {
    /* swallow — Safari private mode or quota */
  }
}

export function clearRevealed(roomId: string): void {
  try {
    const ss = getStorage();
    if (!ss) return;
    ss.removeItem(revealedFlagKey(roomId));
  } catch {
    /* swallow */
  }
}
