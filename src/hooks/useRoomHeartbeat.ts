"use client";

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * SPEC §10.2.1 — fire `PATCH /api/rooms/{id}/heartbeat` on mount, then
 * every 15 s while `active`. Hook stops on unmount or when `active`
 * flips to false. The endpoint UPDATEs room_memberships.last_seen_at;
 * the advance-time cascade reads that column.
 *
 * Active across all room statuses (lobby / voting / voting_ending /
 * scoring / announcing) so last_seen_at is fresh at every transition,
 * including the scoring → announcing flip when the pre-cascade fires.
 *
 * Failures are silent — the heartbeat is best-effort and a transient
 * network blip should not surface to the user. (A real outage will
 * show up as the user being marked absent at the next rotation; that's
 * a self-correcting signal.)
 */
export function useRoomHeartbeat(
  roomId: string | null,
  userId: string | null,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || !roomId || !userId) return;

    let cancelled = false;
    const fire = async () => {
      try {
        await fetch(`/api/rooms/${roomId}/heartbeat`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        });
      } catch {
        // Best-effort. The next tick will retry.
      }
    };

    void fire(); // immediate on mount
    const interval = window.setInterval(() => {
      if (!cancelled) void fire();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [roomId, userId, active]);
}
