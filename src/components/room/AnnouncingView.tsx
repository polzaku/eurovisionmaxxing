"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import { postAnnounceNext } from "@/lib/room/api";
import { mapRoomError } from "@/lib/room/errors";
import type { Contestant } from "@/types";

interface MembershipShape {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

interface RoomShape {
  id: string;
  status: string;
  ownerUserId: string;
  announcementMode?: string;
  announcementOrder: string[] | null;
  announcingUserId: string | null;
  currentAnnounceIdx: number | null;
}

interface AnnouncingViewProps {
  room: RoomShape;
  memberships: MembershipShape[];
  contestants: Contestant[];
  currentUserId: string;
}

interface LeaderboardEntry {
  contestantId: string;
  totalPoints: number;
  rank: number;
}

interface ResultsResponse {
  status?: string;
  leaderboard?: LeaderboardEntry[];
  contestants?: Contestant[];
}

/**
 * Minimal announce surface for /room/[id] when status === 'announcing'.
 * The full `/present` TV view (animations, fullscreen, wake-lock, landscape
 * override) lands in Phase 5c.
 */
export default function AnnouncingView({
  room,
  memberships,
  contestants,
  currentUserId,
}: AnnouncingViewProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [advanceState, setAdvanceState] = useState<{
    kind: "idle" | "submitting";
    error?: string;
  }>({ kind: "idle" });

  const roomId = room.id;
  const isOwner = currentUserId === room.ownerUserId;
  const isAnnouncer = currentUserId === room.announcingUserId;
  const canAdvance = isOwner || isAnnouncer;

  const announcer = memberships.find((m) => m.userId === room.announcingUserId);
  const contestantById = useRef(new Map(contestants.map((c) => [c.id, c])));
  contestantById.current = new Map(contestants.map((c) => [c.id, c]));

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/results/${encodeURIComponent(roomId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as ResultsResponse;
      if (body.leaderboard) setLeaderboard(body.leaderboard);
    } catch {
      // ignore — next event will retry.
    }
  }, [roomId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRoomRealtime(roomId, (event) => {
    if (event.type === "announce_next" || event.type === "score_update") {
      void refetch();
    }
  });

  const handleReveal = useCallback(async () => {
    if (!canAdvance) return;
    setAdvanceState({ kind: "submitting" });
    const result = await postAnnounceNext(roomId, currentUserId, {
      fetch: window.fetch.bind(window),
    });
    if (result.ok) {
      setAdvanceState({ kind: "idle" });
      void refetch();
      return;
    }
    setAdvanceState({
      kind: "idle",
      error: mapRoomError(result.code),
    });
  }, [canAdvance, currentUserId, refetch, roomId]);

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="max-w-xl w-full space-y-6 motion-safe:animate-fade-in">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight emx-wordmark">
            Live announcement
          </h1>
          {announcer ? (
            <div className="flex items-center justify-center gap-3">
              <Avatar seed={announcer.avatarSeed} size={40} />
              <p className="text-base">
                <span className="font-semibold">{announcer.displayName}</span>{" "}
                <span className="text-muted-foreground">is announcing</span>
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Waiting for an announcer…
            </p>
          )}
          <p className="text-xs font-mono text-muted-foreground">
            Reveal {(room.currentAnnounceIdx ?? 0) + 1}
          </p>
        </header>

        {canAdvance ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleReveal}
              disabled={advanceState.kind === "submitting"}
              className="w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all hover:scale-[1.01] hover:emx-glow-gold active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {advanceState.kind === "submitting"
                ? "Revealing…"
                : "Reveal next point"}
            </button>
            {advanceState.error ? (
              <p
                role="alert"
                className="text-sm text-destructive text-center"
              >
                {advanceState.error}
              </p>
            ) : null}
          </div>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Leaderboard
          </h2>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No points revealed yet.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {leaderboard.map((entry) => {
                const c = contestantById.current.get(entry.contestantId);
                const country = c?.country ?? entry.contestantId;
                const flag = c?.flagEmoji ?? "🏳️";
                return (
                  <li
                    key={entry.contestantId}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-background text-xs font-semibold text-muted-foreground">
                        {entry.rank}
                      </span>
                      <span className="text-xl" aria-hidden>
                        {flag}
                      </span>
                      <span className="text-sm font-medium">{country}</span>
                    </div>
                    <span className="font-mono text-sm font-bold tabular-nums">
                      {entry.totalPoints}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <p className="text-xs text-muted-foreground text-center">
          Full results: <a className="underline" href={`/results/${roomId}`}>/results/{roomId.slice(0, 8)}…</a>
        </p>
      </div>
    </main>
  );
}
