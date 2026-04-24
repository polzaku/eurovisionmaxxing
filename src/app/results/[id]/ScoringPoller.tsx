"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export interface ScoringPollerProps {
  roomId: string;
  /** Default 2000ms per SPEC §12.5. */
  intervalMs?: number;
}

/**
 * Polls /api/results/{roomId} while the server's status is `scoring`. When
 * the server reports a different status, refreshes the route so the server
 * component re-renders with the new data.
 *
 * Unmounts on navigation away; the setInterval is torn down cleanly.
 */
export default function ScoringPoller({
  roomId,
  intervalMs = 2000,
}: ScoringPollerProps) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/results/${roomId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { status?: string };
        if (cancelled) return;
        if (body.status && body.status !== "scoring") {
          router.refresh();
        }
      } catch {
        // network blips are fine — we'll just poll again next interval
      }
    };

    const id = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [roomId, intervalMs, router]);

  return null;
}
