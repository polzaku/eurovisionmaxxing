"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchRoomData } from "@/lib/room/api";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import { useWakeLock } from "@/hooks/useWakeLock";
import { applyTheme } from "@/lib/theme";
import PresentScreen, {
  type PresentStatus,
} from "@/components/present/PresentScreen";
import FullscreenPrompt from "@/components/present/FullscreenPrompt";
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";
import type { SkipEvent } from "@/components/room/SkipBannerQueue";

interface RoomShape {
  id: string;
  pin: string;
  status: string;
  ownerUserId: string;
  announcementMode?: string;
  announcementStyle?: 'full' | 'short';
  announcingUserId?: string | null;
  batchRevealMode: boolean;
}

interface MembershipShape {
  userId: string;
  displayName: string;
}

interface AnnouncementShape {
  pendingReveal: { contestantId: string; points: number } | null;
  announcerPosition: number;
  announcerCount: number;
}

interface ResultsShape {
  status: string;
  leaderboard?: LeaderboardEntry[];
  announcement?: AnnouncementShape | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      room: RoomShape;
      memberships: MembershipShape[];
      contestants: Contestant[];
    };

/**
 * SPEC §10.3 — TV-optimized presentation surface for the room. Held
 * at /room/{id}/present, intended to be opened on a TV via AirPlay
 * or screen mirroring.
 *
 * Always-dark theme regardless of the user's theme toggle (forced via
 * `applyTheme('dark')` on mount). Wake lock held for the route's full
 * lifetime (§8.9). L13 fullscreen prompt surfaces when the document
 * isn't already in fullscreen.
 *
 * Three-surface differentiation (announcer phone vs guest phone vs TV
 * showing different content during each reveal step) lands in a
 * follow-on slice — this page is the TV surface only and renders the
 * same content for any visitor.
 */
export default function PresentPage({ params }: { params: { id: string } }) {
  const roomId = params.id;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [results, setResults] = useState<ResultsShape | null>(null);
  const [skipEvents, setSkipEvents] = useState<SkipEvent[]>([]);
  const [splashEvent, setSplashEvent] = useState<{
    contestantId: string;
    triggerKey: number;
  } | null>(null);

  // Force-dark — restore prior theme on unmount so the user's theme
  // toggle pick is honoured back on /room/{id} or /results/{id}.
  useEffect(() => {
    applyTheme("dark");
    return () => {
      if (typeof document !== "undefined") {
        delete document.documentElement.dataset.theme;
      }
    };
  }, []);

  // Wake lock for the route's full lifetime (§8.9).
  useWakeLock(true);

  const load = useCallback(async () => {
    const fetchResult = await fetchRoomData(roomId, null, {
      fetch: window.fetch.bind(window),
    });
    if (!fetchResult.ok || !fetchResult.data) {
      setPhase({
        kind: "error",
        message: fetchResult.ok ? "No data" : "Could not load the room.",
      });
      return;
    }
    const data = fetchResult.data;
    setPhase({
      kind: "ready",
      room: data.room as RoomShape,
      memberships: (data.memberships ?? []) as MembershipShape[],
      contestants: (data.contestants ?? []) as Contestant[],
    });
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling: when the room is in announcing or done, refresh /api/results
  // every 2 s for fresh leaderboard data. We don't subscribe to point-by-
  // point broadcasts here because the TV view doesn't need to fire micro-
  // animations — settling within 2 s is plenty for the smooth-rank-shift
  // behaviour that follow-on slices will layer on.
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const status = phase.room.status;
    if (status !== "announcing" && status !== "done") {
      setResults(null);
      return;
    }

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/results/${encodeURIComponent(roomId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as ResultsShape;
        if (cancelled) return;
        setResults(body);
      } catch {
        /* swallow — keep stale data */
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, roomId]);

  // Status_changed broadcasts trigger an immediate refetch.
  useRoomRealtime(roomId, (event) => {
    if (event.type === "status_changed" || event.type === "voting_ending") {
      void load();
    } else if (event.type === "batch_reveal_started") {
      void load();
    } else if (event.type === "announce_next") {
      // Only consumed by PresentScreen under short style; the page passes
      // it down via splashEvent. Also accelerate the next poll cycle.
      setSplashEvent({
        contestantId: event.contestantId,
        triggerKey: Date.now(),
      });
      void load();
      return;
    } else if (event.type === "announce_skip") {
      setSkipEvents((prev) => [
        ...prev,
        {
          id: `${event.userId}-${Date.now()}`,
          userId: event.userId,
          displayName: event.displayName,
          at: Date.now(),
        },
      ]);
    }
  });

  if (phase.kind === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-12 py-12">
        <p className="text-3xl text-muted-foreground motion-safe:animate-shimmer">
          …
        </p>
      </main>
    );
  }

  if (phase.kind === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-12 py-12">
        <p className="text-2xl text-destructive">{phase.message}</p>
      </main>
    );
  }

  const announcerDisplayName = phase.memberships.find(
    (m) => m.userId === phase.room.announcingUserId,
  )?.displayName;

  return (
    <>
      <PresentScreen
        status={phase.room.status as PresentStatus}
        pin={phase.room.pin}
        contestants={phase.contestants}
        leaderboard={results?.leaderboard}
        announcerDisplayName={announcerDisplayName}
        roomMemberTotal={phase.memberships.length}
        pendingReveal={
          results?.announcement
            ? results.announcement.pendingReveal
            : undefined
        }
        announcerPosition={results?.announcement?.announcerPosition}
        announcerCount={results?.announcement?.announcerCount}
        announcementStyle={phase.room.announcementStyle ?? 'full'}
        batchRevealMode={phase.room.batchRevealMode}
        skipEvents={skipEvents}
        splashEvent={splashEvent}
        onSplashDismiss={() => setSplashEvent(null)}
        roomId={roomId}
      />
      <FullscreenPrompt />
    </>
  );
}
