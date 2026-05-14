"use client";

import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 3000;

// Statuses where the room is in a transient state and a missed
// `status_changed` broadcast leaves the client stranded. Belt-and-braces
// poll fallback for the SPEC §15 Postgres-Changes safety net we haven't
// wired up explicitly.
const POLL_STATUSES = new Set(["voting_ending", "scoring"]);

// Statuses where a returning user (tab brought to foreground) should
// refetch once in case anything moved while they were away. `done` and
// `lobby` are stable so we skip them — they have their own UX.
const VISIBILITY_REFETCH_STATUSES = new Set([
  "voting",
  "voting_ending",
  "scoring",
  "announcing",
]);

/**
 * Realtime fallback poll: refetches the room state on a short interval
 * during transient lifecycle states, plus once whenever the tab becomes
 * visible during any non-terminal state. Belt-and-braces against missed
 * Supabase broadcasts — symptom was guests stuck on the voting screen
 * after the host ended voting (2026-05-14 smoke).
 */
export function useRoomStatusPolling(
  roomId: string | null,
  status: string | null,
  loadRoom: () => void | Promise<void>,
) {
  const loadRoomRef = useRef(loadRoom);
  loadRoomRef.current = loadRoom;

  useEffect(() => {
    if (!roomId || !status) return;
    if (!POLL_STATUSES.has(status)) return;

    const interval = setInterval(() => {
      void loadRoomRef.current();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [roomId, status]);

  useEffect(() => {
    if (!roomId || !status) return;
    if (!VISIBILITY_REFETCH_STATUSES.has(status)) return;

    const handler = () => {
      if (document.visibilityState === "visible") {
        void loadRoomRef.current();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [roomId, status]);
}
