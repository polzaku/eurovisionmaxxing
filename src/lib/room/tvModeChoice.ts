export type TvModeChoice = "tv" | "skip";

const KEY_PREFIX = "emx_tv_choice_";

/**
 * Per-room sessionStorage key for the host's TV-mode decision. Stored
 * separately from `emx_session` so signing out doesn't blow it away
 * (the host might log back into the same room on the same tab and want
 * their choice remembered for the rest of the show).
 *
 * Scoped to sessionStorage rather than localStorage because the choice
 * is genuinely per-show — opening a fresh tab a week later should
 * re-prompt rather than silently use a stale decision.
 */
function storageKey(roomId: string): string {
  return `${KEY_PREFIX}${roomId}`;
}

export function readTvModeChoice(roomId: string): TvModeChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(storageKey(roomId));
    return value === "tv" || value === "skip" ? value : null;
  } catch {
    return null;
  }
}

export function writeTvModeChoice(
  roomId: string,
  choice: TvModeChoice,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(roomId), choice);
  } catch {
    /* sessionStorage unavailable — silent no-op. */
  }
}
