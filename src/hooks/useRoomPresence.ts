"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * SPEC §10.2 step 7 — admin announcer roster with presence dots.
 *
 * Tracks which userIds in a room are currently subscribed to the realtime
 * channel via Supabase Presence. Subscribers auto-track themselves on
 * connect; the hook listens to the channel's `presence` events (sync /
 * join / leave) and re-derives a `Set<string>` of online userIds.
 *
 * Disconnects auto-clean up after the channel's heartbeat timeout (~30s),
 * which matches the spec's "seen in last 30s" definition without any
 * heartbeat broadcast traffic on our side.
 *
 * Uses a separate channel (`presence:{roomId}`) from `useRoomRealtime`'s
 * broadcast channel (`room:{roomId}`) — the two have different lifecycle
 * shapes (presence requires the per-user `key`; broadcasts don't) and
 * decoupling them keeps each hook a single concern.
 */
export function useRoomPresence(
  roomId: string | null,
  userId: string | null,
): Set<string> {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const supabase = useRef(createClient());

  useEffect(() => {
    if (!roomId || !userId) return;

    const client = supabase.current;

    const channel = client.channel(`presence:${roomId}`, {
      config: { presence: { key: userId } },
    });

    const syncPresence = () => {
      const state = channel.presenceState();
      // presenceState() returns { [key: userId]: Array<{...meta}> }.
      // Object.keys gives us the live set; an empty array shouldn't appear
      // (Supabase removes the key when the last subscriber for a userId
      // leaves) but we tolerate it just in case.
      const next = new Set<string>();
      for (const [key, presences] of Object.entries(state)) {
        if (Array.isArray(presences) && presences.length > 0) next.add(key);
      }
      setOnlineUserIds(next);
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [roomId, userId]);

  return onlineUserIds;
}
