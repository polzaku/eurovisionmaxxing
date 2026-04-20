"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RoomEvent } from "@/types";

/**
 * Hook for subscribing to realtime room events via Supabase.
 * Subscribe on room entry, unsubscribe on unmount.
 */
export function useRoomRealtime(
  roomId: string | null,
  onEvent: (event: RoomEvent) => void
) {
  const supabase = useRef(createClient());
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!roomId) return;

    const channel = supabase.current
      .channel(`room:${roomId}`)
      .on("broadcast", { event: "room_event" }, (payload) => {
        // eslint-disable-next-line no-console
        console.log(`[realtime] room:${roomId} received`, payload);
        callbackRef.current(payload.payload as RoomEvent);
      })
      .subscribe((status) => {
        // eslint-disable-next-line no-console
        console.log(`[realtime] room:${roomId} subscription status: ${status}`);
      });

    return () => {
      supabase.current.removeChannel(channel);
    };
  }, [roomId]);
}
