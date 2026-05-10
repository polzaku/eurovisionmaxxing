"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import DoneCard from "@/components/room/DoneCard";
import SkipBannerQueue, {
  type SkipEvent,
} from "@/components/room/SkipBannerQueue";
import AnnouncerRoster, {
  type RosterMember,
} from "@/components/room/AnnouncerRoster";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import { useRoomPresence } from "@/hooks/useRoomPresence";
import {
  postAnnounceNext,
  postAnnounceHandoff,
  postAnnounceSkip,
  postAnnounceRestore,
} from "@/lib/room/api";
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
  /**
   * Owner-only: roster data for the §10.2 step 7 announcer roster panel.
   * Optional so non-owner views (and existing tests that don't care about
   * the panel) can omit. When absent, the roster is suppressed entirely.
   */
  members?: RosterMember[];
  /**
   * Called when the in-component refetch detects the room has left
   * `announcing` status (e.g. show finished, broadcast lagged behind for
   * non-announcer guests). The page should re-fetch its room data so its
   * top-level switch picks the right view.
   */
  onAnnouncementEnded?: () => void;
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
  delegateUserId: string | null;
  announcerPosition: number;
  announcerCount: number;
  /** SPEC §10.2.1 — userIds the admin has skipped during this announce flow. */
  skippedUserIds: string[];
}

interface ResultsResponse {
  status?: string;
  leaderboard?: LeaderboardEntry[];
  announcement?: AnnouncementState | null;
}

interface JustRevealedFlash {
  contestantId: string;
  points: number;
  announcingUserId: string;
  timestamp: number;
}

const FLASH_TIMEOUT_MS = 4500;

/**
 * Minimal announce surface for /room/[id] when status === 'announcing'.
 *
 * Five render modes, depending on (currentUserId, announcement.announcingUserId,
 * announcement.delegateUserId, room.ownerUserId):
 *
 * 1. **Active announcer** (currentUser is announcer, no delegate): big
 *    "It's your turn!" header + "Up next" panel + Reveal CTA + explainer.
 * 2. **Active delegate** (currentUser is owner, delegate set to self):
 *    "You're announcing for X" header + "Up next" + Reveal + Give-back CTA.
 * 3. **Passive announcer** (currentUser is announcer, delegate set to admin):
 *    "Admin is announcing for you" passive copy + plain leaderboard.
 * 4. **Owner watching** (currentUser is owner, no delegate, not announcer):
 *    "X is announcing" + leaderboard + "Take control" CTA. No spoilers.
 * 5. **Guest watching** (everyone else): "X is announcing" + leaderboard.
 *
 * Plus a sixth state: **show finished** — last reveal returned
 * `finished: true`. Big "Show's over" card + link to /results/{id}.
 */
export default function AnnouncingView({
  room,
  contestants,
  currentUserId,
  members,
  onAnnouncementEnded,
}: AnnouncingViewProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [announcement, setAnnouncement] = useState<AnnouncementState | null>(
    null,
  );
  const [advanceState, setAdvanceState] = useState<{
    kind: "idle" | "submitting";
    error?: string;
  }>({ kind: "idle" });
  const [handoffState, setHandoffState] = useState<{
    kind: "idle" | "submitting";
    error?: string;
  }>({ kind: "idle" });
  const [skipState, setSkipState] = useState<{
    kind: "idle" | "submitting";
    error?: string;
  }>({ kind: "idle" });
  /** SPEC §10.2.1 — userId currently being restored (single in-flight). */
  const [restoringUserId, setRestoringUserId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [justRevealed, setJustRevealed] = useState<JustRevealedFlash | null>(
    null,
  );
  const [finishedLocal, setFinishedLocal] = useState(false);
  const [skipEvents, setSkipEvents] = useState<SkipEvent[]>([]);

  const roomId = room.id;
  const isOwner = currentUserId === room.ownerUserId;
  // Track presence on the room channel — used by the owner-only roster
  // panel to show who's online. Non-owners still subscribe (each client
  // tracks itself) but ignore the returned set.
  const presenceUserIds = useRoomPresence(roomId, currentUserId);
  const isAnnouncer = currentUserId === announcement?.announcingUserId;
  const delegateUserId = announcement?.delegateUserId ?? null;
  const isDelegate = !!delegateUserId && currentUserId === delegateUserId;
  const adminHasTakenControl = !!delegateUserId;
  const isActiveDriver =
    !!announcement && (isDelegate || (isAnnouncer && !adminHasTakenControl));

  const contestantById = useRef(new Map(contestants.map((c) => [c.id, c])));
  contestantById.current = new Map(contestants.map((c) => [c.id, c]));

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/results/${encodeURIComponent(roomId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as ResultsResponse;
      // Detect end-of-show before propagating other state. Non-announcer
      // guests rely on this fallback when the `status_changed:done`
      // broadcast doesn't reliably reach the page-level loadRoom handler.
      if (body.status && body.status !== "announcing") {
        onAnnouncementEnded?.();
        return;
      }
      if (body.leaderboard) setLeaderboard(body.leaderboard);
      if (body.announcement !== undefined) setAnnouncement(body.announcement);
    } catch {
      // ignore — next event will retry.
    }
  }, [roomId, onAnnouncementEnded]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRoomRealtime(roomId, (event) => {
    if (event.type === "announce_next") {
      setJustRevealed({
        contestantId: event.contestantId,
        points: event.points,
        announcingUserId: event.announcingUserId,
        timestamp: Date.now(),
      });
      void refetch();
      return;
    }
    if (event.type === "score_update") {
      void refetch();
      return;
    }
    if (event.type === "announce_skip") {
      setSkipEvents((prev) => [
        ...prev,
        {
          id: `${event.userId}-${Date.now()}`,
          userId: event.userId,
          displayName: event.displayName,
          at: Date.now(),
        },
      ]);
      // Refetch so the roster's skipped markers + restore CTA stay in
      // sync with whichever admin made the change.
      void refetch();
      return;
    }
    if (event.type === "announce_skip_restored") {
      // Refetch so the roster's skipped markers + restore CTA stay in
      // sync with whichever admin made the change.
      void refetch();
    }
  });

  useEffect(() => {
    if (!justRevealed) return;
    const ts = justRevealed.timestamp;
    const timer = setTimeout(() => {
      setJustRevealed((prev) => (prev?.timestamp === ts ? null : prev));
    }, FLASH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [justRevealed]);

  const handleReveal = useCallback(async () => {
    if (!isActiveDriver) return;
    setAdvanceState({ kind: "submitting" });
    const result = await postAnnounceNext(roomId, currentUserId, {
      fetch: window.fetch.bind(window),
    });
    if (result.ok) {
      setAdvanceState({ kind: "idle" });
      if (result.data?.finished) setFinishedLocal(true);
      void refetch();
      return;
    }
    setAdvanceState({
      kind: "idle",
      error: mapRoomError(result.code),
    });
  }, [currentUserId, isActiveDriver, refetch, roomId]);

  const handleSkipAnnouncer = useCallback(async () => {
    if (!isOwner) return;
    setSkipState({ kind: "submitting" });
    const result = await postAnnounceSkip(roomId, currentUserId, {
      fetch: window.fetch.bind(window),
    });
    if (result.ok) {
      setSkipState({ kind: "idle" });
      if (result.data?.finished) setFinishedLocal(true);
      void refetch();
      return;
    }
    setSkipState({ kind: "idle", error: mapRoomError(result.code) });
  }, [currentUserId, isOwner, refetch, roomId]);

  const handleRestoreSkipped = useCallback(
    async (restoreUserId: string) => {
      if (!isOwner || restoringUserId) return;
      setRestoringUserId(restoreUserId);
      setRestoreError(null);
      const result = await postAnnounceRestore(
        roomId,
        currentUserId,
        restoreUserId,
        { fetch: window.fetch.bind(window) },
      );
      setRestoringUserId(null);
      if (result.ok) {
        void refetch();
        return;
      }
      setRestoreError(mapRoomError(result.code));
    },
    [currentUserId, isOwner, refetch, restoringUserId, roomId],
  );

  const handleTakeControl = useCallback(
    async (takeControl: boolean) => {
      if (!isOwner) return;
      setHandoffState({ kind: "submitting" });
      const result = await postAnnounceHandoff(
        roomId,
        currentUserId,
        takeControl,
        { fetch: window.fetch.bind(window) },
      );
      if (result.ok) {
        setHandoffState({ kind: "idle" });
        void refetch();
        return;
      }
      setHandoffState({
        kind: "idle",
        error: mapRoomError(result.code),
      });
    },
    [currentUserId, isOwner, refetch, roomId],
  );

  const flashContestant = justRevealed
    ? contestantById.current.get(justRevealed.contestantId)
    : null;
  const pendingContestant = announcement?.pendingReveal
    ? contestantById.current.get(announcement.pendingReveal.contestantId)
    : null;

  // ─── Show-finished state — announcer-side optimistic flip ─────────────
  if (finishedLocal) {
    return <DoneCard roomId={roomId} />;
  }

  const announcerName = announcement?.announcingDisplayName ?? "";
  const headerCard = announcement
    ? renderHeader({
        mode: pickMode({
          isActiveDriver,
          isAnnouncer,
          adminHasTakenControl,
          isOwner,
        }),
        announcer: announcement,
      })
    : (
      <p className="text-muted-foreground text-sm text-center">
        Waiting for an announcer&hellip;
      </p>
    );

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <SkipBannerQueue events={skipEvents} />
      <div className="max-w-xl w-full space-y-6 motion-safe:animate-fade-in">
        <header className="space-y-3 text-center">
          <h1 className="text-xl font-bold tracking-tight emx-wordmark">
            Live announcement
          </h1>
          {headerCard}
          {announcement ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground tabular-nums">
                Announcer{" "}
                <span className="font-bold text-foreground">
                  {announcement.announcerPosition}
                </span>{" "}
                of {announcement.announcerCount} &middot; Reveal{" "}
                <span className="font-bold text-foreground">
                  {announcement.currentAnnounceIdx + 1}
                </span>{" "}
                / {announcement.queueLength}
              </p>
              <AnnouncerProgressBar
                position={announcement.announcerPosition}
                count={announcement.announcerCount}
                queueIdx={announcement.currentAnnounceIdx}
                queueLength={announcement.queueLength}
              />
            </div>
          ) : null}
        </header>

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

        {/* Up Next + Reveal — only the active driver sees the queue spoiler.
         *
         * The whole card is a tap-anywhere zone per SPEC §10.2 step 4 — taps
         * anywhere on the card advance, the explicit "Reveal next point"
         * button below stays as the canonical control (keyboard / screen-reader
         * focus target). The redundant zone is for live-event fumble
         * protection: a phone held loose under camera lights overshoots small
         * tap targets.
         *
         * Auto-advance + Hold (the rest of §10.2 step 4) deferred to V1.1 —
         * default-on auto-advance can cut narrators off mid-sentence on TV
         * and the manual reveal flow already works fine.
         */}
        {isActiveDriver && announcement?.pendingReveal ? (
          <div
            data-testid="active-driver-tap-zone"
            onClick={() => {
              if (advanceState.kind === "submitting") return;
              void handleReveal();
            }}
            className="cursor-pointer select-none rounded-2xl border-2 border-accent/60 bg-accent/5 px-5 py-4 space-y-3 transition-all hover:border-accent hover:bg-accent/10 active:scale-[0.995]"
          >
            <p className="text-xs uppercase tracking-widest text-accent">
              Up next
            </p>
            <p className="text-xl font-bold">
              <span className="text-2xl mr-2" aria-hidden>
                {pendingContestant?.flagEmoji ?? "🏳️"}
              </span>
              {pendingContestant?.country ??
                announcement.pendingReveal.contestantId}
            </p>
            <p className="text-sm">
              <span className="font-mono text-lg font-bold tabular-nums">
                {announcement.pendingReveal.points}
              </span>{" "}
              <span className="text-muted-foreground">
                {announcement.pendingReveal.points === 1
                  ? "point — tap anywhere to reveal"
                  : "points — tap anywhere to reveal"}
              </span>
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleReveal();
              }}
              disabled={advanceState.kind === "submitting"}
              className="w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all hover:scale-[1.01] hover:emx-glow-gold active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {advanceState.kind === "submitting"
                ? "Revealing…"
                : "Reveal next point"}
            </button>
            <p className="text-xs text-muted-foreground">
              Eurovision style — points reveal lowest to highest. Tap the
              button or anywhere on this card to call the next country. After
              your last reveal it&rsquo;ll automatically pass to the next
              announcer.
            </p>
            {advanceState.error ? (
              <p
                role="alert"
                className="text-sm text-destructive text-center"
              >
                {advanceState.error}
              </p>
            ) : null}
            {isDelegate ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleTakeControl(false);
                }}
                disabled={handoffState.kind === "submitting"}
                className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-medium transition-all hover:border-accent active:scale-[0.98] disabled:opacity-60"
              >
                {handoffState.kind === "submitting"
                  ? "Releasing…"
                  : `Give back control to ${announcerName}`}
              </button>
            ) : null}
            {handoffState.error ? (
              <p role="alert" className="text-xs text-destructive text-center">
                {handoffState.error}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Owner watching — Take control + Skip turn. No spoilers. */}
        {isOwner && !isActiveDriver && !adminHasTakenControl && announcement ? (
          <div className="rounded-2xl border-2 border-border bg-card px-5 py-4 space-y-2">
            <p className="text-sm font-semibold">
              {announcerName} is announcing
            </p>
            <p className="text-xs text-muted-foreground">
              If they&rsquo;re away or stuck, you can take over their reveals
              (you can hand back any time) or skip past them entirely. Skipped
              points still appear on the leaderboard.
            </p>
            <button
              type="button"
              onClick={() => handleTakeControl(true)}
              disabled={
                handoffState.kind === "submitting" ||
                skipState.kind === "submitting"
              }
              className="w-full rounded-lg border-2 border-accent bg-accent/5 px-3 py-2 text-sm font-medium transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              {handoffState.kind === "submitting"
                ? "Taking over…"
                : `Announce for ${announcerName}`}
            </button>
            <button
              type="button"
              onClick={handleSkipAnnouncer}
              disabled={
                skipState.kind === "submitting" ||
                handoffState.kind === "submitting"
              }
              aria-label={`Skip ${announcerName}'s turn — they're not here`}
              className="w-full rounded-lg border-2 border-muted-foreground/30 bg-muted/30 px-3 py-2 text-sm font-medium transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              {skipState.kind === "submitting"
                ? "Skipping…"
                : `Skip ${announcerName} — they're not here`}
            </button>
            {handoffState.error ? (
              <p role="alert" className="text-xs text-destructive">
                {handoffState.error}
              </p>
            ) : null}
            {skipState.error ? (
              <p role="alert" className="text-xs text-destructive">
                {skipState.error}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Passive announcer (admin took over). */}
        {isAnnouncer && adminHasTakenControl && !isActiveDriver ? (
          <div className="rounded-2xl border-2 border-muted-foreground/20 bg-muted/30 px-5 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              The room admin is announcing on your behalf. Sit back and watch.
            </p>
          </div>
        ) : null}

        {/* Active driver, queue exhausted but rotation broadcast hasn't landed. */}
        {isActiveDriver && announcement && !announcement.pendingReveal ? (
          <div className="rounded-2xl border-2 border-border bg-card px-5 py-4 text-center text-muted-foreground text-sm">
            All your points revealed. Passing to the next announcer&hellip;
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

        {/* Owner-only roster panel — visibility for who's online + current
         * announcer / delegate markers, plus the §10.2.1 restore-skipped
         * action. Renders below the leaderboard so it doesn't push the
         * live data offscreen on small phones.
         */}
        {isOwner && members && members.length > 0 ? (
          <>
            <AnnouncerRoster
              members={members}
              presenceUserIds={presenceUserIds}
              currentAnnouncerId={announcement?.announcingUserId ?? null}
              delegateUserId={announcement?.delegateUserId ?? null}
              skippedUserIds={
                announcement?.skippedUserIds
                  ? new Set(announcement.skippedUserIds)
                  : undefined
              }
              onRestore={handleRestoreSkipped}
              restoringUserId={restoringUserId}
            />
            {restoreError ? (
              <p
                role="alert"
                data-testid="restore-error"
                className="text-xs text-destructive text-center"
              >
                {restoreError}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

type Mode =
  | "active-announcer"
  | "active-delegate"
  | "passive-announcer"
  | "owner-watching"
  | "guest-watching";

/**
 * Two-tier progress bar:
 *   - Coarse: one segment per announcer in `announcement_order`. Past
 *     announcers fill solid; the current is shown half-filled (proportional
 *     to their per-queue progress); future announcers are empty.
 *   - The whole bar is `announcer count` segments wide so the user gets a
 *     glanceable "{position} of {count}" feel even without reading the
 *     adjacent text.
 */
function AnnouncerProgressBar({
  position,
  count,
  queueIdx,
  queueLength,
}: {
  position: number;
  count: number;
  queueIdx: number;
  queueLength: number;
}) {
  const innerProgress = queueLength > 0 ? queueIdx / queueLength : 0;
  return (
    <div className="flex gap-1 w-full" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const slot = i + 1;
        let fillPct = 0;
        if (slot < position) fillPct = 100;
        else if (slot === position) fillPct = Math.round(innerProgress * 100);
        return (
          <div
            key={slot}
            className="relative flex-1 h-1.5 rounded-full bg-border overflow-hidden"
          >
            <div
              className="absolute inset-y-0 left-0 bg-primary motion-safe:transition-[width] motion-safe:duration-300"
              style={{ width: `${fillPct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function pickMode({
  isActiveDriver,
  isAnnouncer,
  adminHasTakenControl,
  isOwner,
}: {
  isActiveDriver: boolean;
  isAnnouncer: boolean;
  adminHasTakenControl: boolean;
  isOwner: boolean;
}): Mode {
  if (isActiveDriver && isAnnouncer && !adminHasTakenControl)
    return "active-announcer";
  if (isActiveDriver && !isAnnouncer) return "active-delegate";
  if (isAnnouncer && adminHasTakenControl) return "passive-announcer";
  if (isOwner) return "owner-watching";
  return "guest-watching";
}

function renderHeader({
  mode,
  announcer,
}: {
  mode: Mode;
  announcer: AnnouncementState;
}) {
  const announcerName = announcer.announcingDisplayName;
  const announcerSeed = announcer.announcingAvatarSeed;

  if (mode === "active-announcer") {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border-2 border-primary px-5 py-4 space-y-2">
        <p className="text-2xl font-extrabold text-primary">
          🎤 It&rsquo;s your turn to announce!
        </p>
        <p className="text-sm text-muted-foreground">
          The room is watching. Reveal your points one at a time.
        </p>
      </div>
    );
  }

  if (mode === "active-delegate") {
    return (
      <div className="rounded-2xl bg-accent/10 border-2 border-accent px-5 py-4 space-y-2">
        <p className="text-lg font-bold">
          You&rsquo;re announcing for {announcerName}
        </p>
        <p className="text-xs text-muted-foreground">
          Their points are still attributed to them — you&rsquo;re just
          driving.
        </p>
      </div>
    );
  }

  if (mode === "passive-announcer") {
    return (
      <div className="flex items-center justify-center gap-3">
        <Avatar seed={announcerSeed} size={36} />
        <p className="text-base">
          <span className="font-semibold">The admin</span>{" "}
          <span className="text-muted-foreground">
            is announcing on your behalf
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-3">
      <Avatar seed={announcerSeed} size={40} />
      <p className="text-base">
        <span className="font-semibold">{announcerName}</span>{" "}
        <span className="text-muted-foreground">is announcing</span>
      </p>
    </div>
  );
}
