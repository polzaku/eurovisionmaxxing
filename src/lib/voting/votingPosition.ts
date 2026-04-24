/**
 * Persist + restore the voting screen's current contestant across reloads.
 *
 * Storage value = contestantId string (e.g. "2026-ua"), NOT a numeric index —
 * robust to the contestant list order changing out from under us.
 *
 * Key scheme: `emx_voting_position_{roomId}_{userId}` — scoped per room per user.
 */

const KEY_PREFIX = "emx_voting_position_";

export interface PersistentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function keyFor(roomId: string, userId: string): string {
  return `${KEY_PREFIX}${roomId}_${userId}`;
}

/**
 * Read the last-saved contestantId for this room + user. Returns null if
 * nothing saved, storage unavailable, or storage throws.
 */
export function loadVotingPosition(
  storage: PersistentStorage | null | undefined,
  roomId: string,
  userId: string
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(keyFor(roomId, userId));
  } catch {
    return null;
  }
}

/**
 * Persist the current contestantId. Silent no-op if storage is unavailable
 * or throws (QuotaExceededError, private-mode restrictions, etc.).
 */
export function saveVotingPosition(
  storage: PersistentStorage | null | undefined,
  roomId: string,
  userId: string,
  contestantId: string
): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(roomId, userId), contestantId);
  } catch {
    // Silent — position persistence is a progressive enhancement.
  }
}

/**
 * Index of `contestantId` in the provided list, or -1 if not found (or the
 * id is null/empty).
 */
export function indexOfContestant(
  contestants: readonly { id: string }[],
  contestantId: string | null | undefined
): number {
  if (!contestantId) return -1;
  for (let i = 0; i < contestants.length; i++) {
    if (contestants[i].id === contestantId) return i;
  }
  return -1;
}
