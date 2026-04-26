"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import { postAnnounceNext } from "@/lib/room/api";
import { mapRoomError } from "@/lib/room/errors";
import type { Contestant } from "@/types";

interface RoomShape {
  id: string;
  status: string;
  ownerUserId: string;
}

interface AnnouncingViewProps {
  room: RoomShape;
  contestants: Contestant[];
  currentUserId: string;
}

interface LeaderboardEntry {
  contestantId: string;
  totalPoints: number;
  rank: number;
}

interface AnnouncementState {
  announcingUserId: string;
  announcingDisplayName: string;
  announcingAvatarSeed: string;
  currentAnnounceIdx: number;
  pendingReveal: { contestantId: string; points: number } | null;
  queueLength: number;
}

interface ResultsResponse {
  status?: string;
  leaderboard?: LeaderboardEntry[];
  announcement?: AnnouncementState | null;
}

interface JustRevealedFlash {
  contestantId: string;
  points: number;
  timestamp: number;
}

const FLASH_TIMEOUT_MS = 4000;

/**
 * Minimal announce surface for /room/[id] when status === 'announcing'.
 * Refetches `/api/results/{id}` on every `announce_next` and `score_update`
 * broadcast — that's how rotation between announcers becomes visible (the
 * room's `announcing_user_id` is server-authoritative and lives only in the
 * announcing payload). The full `/present` TV view (animations, fullscreen,
 * wake-lock, landscape override) lands in Phase 5c.
 */
export default function AnnouncingView({
  room,
  contestants,
  currentUserId,
}: AnnouncingViewProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [announcement, setAnnouncement] = useState<AnnouncementState | null>(
    null,
  );
  const [advanceState, setAdvanceState] = useState<{
    kind: "idle" | "submitting";
    error?: string;
  }>({ kind: "idle" });
  const [justRevealed, setJustRevealed] = useState<JustRevealedFlash | null>(
    null,
  );

  const roomId = room.id;
  const isOwner = currentUserId === room.ownerUserId;
  const isAnnouncer = currentUserId === announcement?.announcingUserId;
  const canAdvance = (isOwner || isAnnouncer) && !!announcement;

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
      if (body.announcement !== undefined) setAnnouncement(body.announcement);
    } catch {
      // ignore — next event will retry.
    }
  }, [roomId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRoomRealtime(roomId, (event) => {
    if (event.type === "announce_next") {
      // Show the prominent flash for the just-revealed pick (driven by the
      // broadcast payload itself so every client sees it, not just the
      // refetch winner).
      setJustRevealed({
        contestantId: event.contestantId,
        points: event.points,
        timestamp: Date.now(),
      });
      void refetch();
      return;
    }
    if (event.type === "score_update") {
      void refetch();
    }
  });

  // Auto-clear the just-revealed flash after FLASH_TIMEOUT_MS.
  useEffect(() => {
    if (!justRevealed) return;
    const ts = justRevealed.timestamp;
    const timer = setTimeout(() => {
      setJustRevealed((prev) => (prev?.timestamp === ts ? null : prev));
    }, FLASH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [justRevealed]);

  const handleReveal = useCallback(async () => {
    if (!canAdvance) return;
    setAdvanceState({ kind: "submitting" });
    const result = await postAnnounceNext(roomId, currentUserId, {
      fetch: window.fetch.bind(window),
    });
    if (result.ok) {
      setAdvanceState({ kind: "idle" });
      // Optimistic: trust the broadcast we just emitted, but also refetch as
      // a safety net in case the announcer reconnected mid-request.
      void refetch();
      return;
    }
    setAdvanceState({
      kind: "idle",
      error: mapRoomError(result.code),
    });
  }, [canAdvance, currentUserId, refetch, roomId]);

  const flashContestant = justRevealed
    ? contestantById.current.get(justRevealed.contestantId)
    : null;
  const pendingContestant = announcement?.pendingReveal
    ? contestantById.current.get(announcement.pendingReveal.contestantId)
    : null;

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <div className="max-w-xl w-full space-y-6 motion-safe:animate-fade-in">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight emx-wordmark">
            Live announcement
          </h1>
          {announcement ? (
            <div className="flex items-center justify-center gap-3">
              <Avatar
                seed={announcement.announcingAvatarSeed}
                size={40}
              />
              <p className="text-base">
                <span className="font-semibold">
                  {announcement.announcingDisplayName}
                </span>{" "}
                <span className="text-muted-foreground">is announcing</span>
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Waiting for an announcer…
            </p>
          )}
          {announcement ? (
            <p className="text-xs font-mono text-muted-foreground">
              Reveal {announcement.currentAnnounceIdx + 1} /{" "}
              {announcement.queueLength}
            </p>
          ) : null}
        </header>

        {/* Just-revealed flash — visible to everyone for ~4s after each tap */}
        {justRevealed ? (
          <div className="rounded-2xl border-2 border-primary bg-primary/10 px-6 py-5 text-center motion-safe:animate-fade-in">
            <p className="text-xs uppercase tracking-widest text-primary/80">
              Just revealed
            </p>
            <p className="mt-2 text-3xl font-extrabold tabular-nums">
              {justRevealed.points}{" "}
              <span className="text-base font-medium text-muted-foreground">
                {justRevealed.points === 1 ? "point goes to" : "points go to"}
              </span>
            </p>
            <p className="mt-1 text-2xl">
              <span className="mr-2" aria-hidden>
                {flashContestant?.flagEmoji ?? "🏳️"}
              </span>
              <span className="font-bold">
                {flashContestant?.country ?? justRevealed.contestantId}
              </span>
            </p>
          </div>
        ) : null}

        {/* Pending reveal panel — only the announcer / owner sees the queue
            preview. Other guests only learn what's revealed when it happens. */}
        {canAdvance && announcement?.pendingReveal ? (
          <div className="rounded-2xl border-2 border-accent/60 bg-accent/5 px-5 py-4 space-y-3">
            <p className="text-xs uppercase tracking-widest text-accent">
              Up next
            </p>
            <p className="text-xl font-bold">
              <span className="text-2xl mr-2" aria-hidden>
                {pendingContestant?.flagEmoji ?? "🏳️"}
              </span>
              {pendingContestant?.country ?? announcement.pendingReveal.contestantId}
            </p>
            <p className="text-sm">
              <span className="font-mono text-lg font-bold tabular-nums">
                {announcement.pendingReveal.points}
              </span>{" "}
              <span className="text-muted-foreground">
                {announcement.pendingReveal.points === 1
                  ? "point — tap to reveal"
                  : "points — tap to reveal"}
              </span>
            </p>
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

        {/* If queue is exhausted but UI still says we're announcing, give the
            announcer a "Done" hint while the rotation broadcast catches up. */}
        {canAdvance && announcement && !announcement.pendingReveal ? (
          <div className="rounded-2xl border-2 border-border bg-card px-5 py-4 text-center text-muted-foreground text-sm">
            All your points revealed. Passing to the next announcer…
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
          Full results:{" "}
          <a className="underline" href={`/results/${roomId}`}>
            /results/{roomId.slice(0, 8)}…
          </a>
        </p>
      </div>
    </main>
  );
}
