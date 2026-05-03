"use client";

import { useCallback, useEffect, useState } from "react";
import {
  lateJoinerVisibility,
  type LateJoinerVisibility,
} from "@/lib/voting/lateJoinerVisibility";

const LOBBY_SEEN_PREFIX = "emx_lobby_seen_";
const DISMISSED_PREFIX = "emx_late_joiner_dismissed_";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function key(prefix: string, roomId: string, userId: string): string {
  return `${prefix}${roomId}_${userId}`;
}

/**
 * Records that the user has seen this room in `lobby` state. Once set,
 * the late-joiner card is suppressed for this user/room pair forever.
 */
export function markLobbySeen(roomId: string, userId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key(LOBBY_SEEN_PREFIX, roomId, userId), "1");
  } catch {
    // Storage is full or unavailable — failing loudly here would be worse
    // than missing the suppression: the user just sees the card once.
  }
}

export interface UseLateJoinerVisibilityResult {
  visibility: LateJoinerVisibility;
  dismiss: () => void;
}

/**
 * React wiring for the late-joiner card. Reads the lobby-seen + dismissed
 * flags from localStorage on mount and combines with the live `status`
 * via the pure helper.
 */
export function useLateJoinerVisibility(
  roomId: string | undefined,
  userId: string | undefined,
  status: string,
): UseLateJoinerVisibilityResult {
  const [lobbySeen, setLobbySeen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!roomId || !userId) return;
    const s = storage();
    if (!s) return;
    try {
      setLobbySeen(s.getItem(key(LOBBY_SEEN_PREFIX, roomId, userId)) === "1");
      setDismissed(s.getItem(key(DISMISSED_PREFIX, roomId, userId)) === "1");
    } catch {
      // ignore — defaults are safe (card may render once)
    }
    // `status` is in the deps so the hook re-reads after a `lobby`→`voting`
    // transition and picks up the `emx_lobby_seen_*` flag the lobby render
    // wrote — otherwise users present in the lobby would still see the
    // late-joiner card the moment voting begins.
  }, [roomId, userId, status]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (!roomId || !userId) return;
    const s = storage();
    if (!s) return;
    try {
      s.setItem(key(DISMISSED_PREFIX, roomId, userId), "1");
    } catch {
      // ignore
    }
  }, [roomId, userId]);

  const visibility = lateJoinerVisibility({ status, lobbySeen, dismissed });
  return { visibility, dismiss };
}
