"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";
import DoneCard from "@/components/room/DoneCard";
import SkipBannerQueue, {
  type SkipEvent,
} from "@/components/room/SkipBannerQueue";
import AnnouncerRoster, {
  type RosterMember,
} from "@/components/room/AnnouncerRoster";
import TwelvePointSplash from "@/components/room/TwelvePointSplash";
import RevealToast, {
  type ToastEvent,
} from "@/components/room/RevealToast";
import StillToGiveLine from "@/components/room/StillToGiveLine";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import { useRoomPresence } from "@/hooks/useRoomPresence";
import {
  postAnnounceNext,
  postAnnounceHandoff,
  postAnnounceSkip,
  postAnnounceRestore,
  postFinishShow,
  patchAnnouncementOrder,
} from "@/lib/room/api";
import { mapRoomError } from "@/lib/room/errors";
import type { Contestant } from "@/types";

interface RoomShape {
  id: string;
  status: string;
  ownerUserId: string;
  batchRevealMode?: boolean;
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
   * Seed the announcement state directly (used in tests and SSR-primed
   * renders). When provided, the component uses it as initial state instead
   * of waiting for the on-mount fetch to populate it. The on-mount refetch
   * still runs and may overwrite this value.
   */
  announcement?: AnnouncementState | null;
  /**
   * SPEC §10.2.2 — when 'short', the active driver sees a compressed
   * 'Reveal 12 points' CTA. Non-drivers see a RevealToast on each
   * announce_next broadcast regardless of style (full or short).
   */
  announcementStyle?: 'full' | 'short';
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
  announcement: announcementSeed = null,
  announcementStyle = 'full',
  onAnnouncementEnded,
}: AnnouncingViewProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [announcement, setAnnouncement] = useState<AnnouncementState | null>(
    announcementSeed,
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
  const [reshuffling, setReshuffling] = useState(false);
  const [reshuffleError, setReshuffleError] = useState<string | null>(null);
  const [justRevealed, setJustRevealed] = useState<JustRevealedFlash | null>(
    null,
  );
  const [finishedLocal, setFinishedLocal] = useState(false);
  const [skipEvents, setSkipEvents] = useState<SkipEvent[]>([]);
  const [toastEvents, setToastEvents] = useState<ToastEvent[]>([]);

  const [finishingShow, setFinishingShow] = useState(false);

  const t = useTranslations("announcing");

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

  /** SPEC §10.2 — driver sees the big flash card + full-density rows;
   *  watcher sees a top-of-screen toast + compact rows. Derived from
   *  isActiveDriver so the 5-mode pickMode() result stays the header-copy
   *  source of truth while this flag toggles the three presentational
   *  deltas (flash, toast, density). */
  const surface: "driver" | "watcher" = isActiveDriver ? "driver" : "watcher";

  const isBatchReveal = room.batchRevealMode === true;
  // Cascade-exhaust: only when batchRevealMode is explicitly false (the field
  // is present on the room shape) and the current announcement slot is empty.
  const isCascadeExhausted =
    room.status === "announcing" &&
    room.batchRevealMode === false &&
    !announcement?.announcingUserId;

  // Re-shuffle is allowed only before any reveal has happened, before any
  // announcer rotation, and with no skipped users. batchRevealMode rooms
  // don't use the announcer order at all so the button is suppressed.
  const canReshuffle =
    announcement?.currentAnnounceIdx === 0 &&
    announcement?.announcerPosition === 1 &&
    (announcement?.skippedUserIds ?? []).length === 0 &&
    !room.batchRevealMode;

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
      // SPEC §10.2 — watchers (not the announcer) get a top-of-screen toast
      // on every announce_next in BOTH styles. The active driver doesn't
      // toast themselves; they see the big JustRevealedFlash card instead.
      if (currentUserId !== event.announcingUserId) {
        const contestant = contestantById.current.get(event.contestantId);
        const announcerName =
          announcement?.announcingDisplayName ??
          t("announcing.fallbackAnnouncerName");
        if (contestant) {
          setToastEvents((prev) => [
            ...prev,
            {
              id: `toast-${event.announcingUserId}-${Date.now()}`,
              announcingUserDisplayName: announcerName,
              country: contestant.country,
              flagEmoji: contestant.flagEmoji,
              points: event.points,
              at: Date.now(),
            },
          ]);
        }
      }
      void refetch();
      return;
    }
    if (event.type === "score_update") {
      void refetch();
      return;
    }
    if (event.type === "score_batch_revealed") {
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
      return;
    }
    if (event.type === "announcement_order_reshuffled") {
      // Server reshuffled the announcement order. Refetch room state so
      // the new active announcer + roster + position labels render
      // correctly for everyone in the room.
      onAnnouncementEnded?.();
      return;
    }
    if (event.type === "batch_reveal_started") {
      // Host has taken over as batch announcer — swing out of cascade-exhaust
      // into the batch-reveal active view by re-fetching room state.
      onAnnouncementEnded?.();
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

  const handleReshuffle = useCallback(async () => {
    if (!isOwner || reshuffling) return;
    setReshuffling(true);
    setReshuffleError(null);
    try {
      const result = await patchAnnouncementOrder(roomId, currentUserId, {
        fetch: window.fetch.bind(window),
      });
      if (!result.ok) {
        setReshuffleError(
          result.code === "ANNOUNCE_IN_PROGRESS"
            ? t("announcing.roster.reshuffleErrorInProgress")
            : t("announcing.roster.reshuffleErrorGeneric"),
        );
      }
      // On success: the broadcast subscriber handles the refetch.
    } finally {
      setReshuffling(false);
    }
  }, [currentUserId, isOwner, reshuffling, roomId, t]);

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

  const onFinishShow = useCallback(async () => {
    if (finishingShow) return;
    setFinishingShow(true);
    try {
      await postFinishShow(roomId, currentUserId, {
        fetch: window.fetch.bind(window),
      });
    } catch (err) {
      console.warn("Finish the show failed:", err);
    } finally {
      setFinishingShow(false);
    }
  }, [roomId, currentUserId, finishingShow]);

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

  // ─── Cascade-exhaust state — all remaining announcers are absent ────────
  if (isCascadeExhausted) {
    if (isOwner) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
          <div className="emx-cascade-exhaust max-w-sm w-full space-y-4 text-center">
            <h2 className="text-base text-muted-foreground">
              {t("cascadeExhaust.message")}
            </h2>
            <button
              type="button"
              onClick={() => void onFinishShow()}
              disabled={finishingShow}
              className="emx-cta-primary w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all hover:scale-[1.01] hover:emx-glow-gold active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {finishingShow ? t("finishShow.busy") : t("finishShow.button")}
            </button>
          </div>
        </main>
      );
    }
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
        <div className="emx-cascade-exhaust max-w-sm w-full text-center">
          <p className="text-base text-muted-foreground">
            {t("cascadeExhaust.waitingMessage")}
          </p>
        </div>
      </main>
    );
  }

  const announcerName = announcement?.announcingDisplayName ?? "";
  const headerCard = announcement
    ? (
      <HeaderCard
        mode={pickMode({
          isActiveDriver,
          isAnnouncer,
          adminHasTakenControl,
          isOwner,
        })}
        announcer={announcement}
      />
    )
    : (
      <p className="text-muted-foreground text-sm text-center">
        {t("noAnnouncer")}
      </p>
    );

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8">
      <SkipBannerQueue events={skipEvents} />
      <RevealToast events={toastEvents} />
      <div className="max-w-xl w-full space-y-6 motion-safe:animate-fade-in">
        <header className="space-y-3 text-center">
          <h1 className="text-xl font-bold tracking-tight emx-wordmark">
            {t("title")}
          </h1>
          {headerCard}
          {isBatchReveal && (
            <span
              className="emx-batch-reveal-chip inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
              aria-live="polite"
            >
              {t("batchReveal.chip")}
            </span>
          )}
          {announcement ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground tabular-nums">
                {t("position.label", {
                  announcerPosition: announcement.announcerPosition,
                  announcerCount: announcement.announcerCount,
                  currentReveal: announcement.currentAnnounceIdx + 1,
                  queueLength: announcement.queueLength,
                })}
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

        {isActiveDriver &&
        announcementStyle === "full" &&
        announcement?.queueLength === 10 ? (
          <StillToGiveLine
            currentAnnounceIdx={announcement.currentAnnounceIdx}
          />
        ) : null}

        {isActiveDriver && justRevealed ? (
          <div className="rounded-2xl border-2 border-primary bg-primary/10 px-6 py-5 text-center motion-safe:animate-fade-in">
            <p className="text-xs uppercase tracking-widest text-primary/80">
              {t("justRevealed.label")}
            </p>
            <p className="mt-2 text-3xl font-extrabold tabular-nums">
              {t("justRevealed.pointsLabel", { points: justRevealed.points })}
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
        {isActiveDriver && announcement?.pendingReveal && announcementStyle === "short" ? (
          <ShortStyleRevealCard
            onReveal={handleReveal}
            submitting={advanceState.kind === "submitting"}
            error={advanceState.error}
            contestant={pendingContestant ?? null}
            justRevealedContestant={
              justRevealed
                ? contestantById.current.get(justRevealed.contestantId) ?? null
                : null
            }
            isDelegate={isDelegate}
            announcerName={announcerName}
            handoffState={handoffState}
            onHandoffBack={() => handleTakeControl(false)}
          />
        ) : isActiveDriver && announcement?.pendingReveal ? (
          <div
            data-testid="active-driver-tap-zone"
            onClick={() => {
              if (advanceState.kind === "submitting") return;
              void handleReveal();
            }}
            className="cursor-pointer select-none rounded-2xl border-2 border-accent/60 bg-accent/5 px-5 py-4 space-y-3 transition-all hover:border-accent hover:bg-accent/10 active:scale-[0.995]"
          >
            <p className="text-xs uppercase tracking-widest text-accent">
              {t("upNext.label")}
            </p>
            <p className="text-xl font-bold">
              <span className="text-2xl mr-2" aria-hidden>
                {pendingContestant?.flagEmoji ?? "🏳️"}
              </span>
              {pendingContestant?.country ??
                announcement.pendingReveal.contestantId}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("upNext.pointsHint", { points: announcement.pendingReveal.points })}
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
                ? t("reveal.busy")
                : t("reveal.button")}
            </button>
            <p className="text-xs text-muted-foreground">
              {t("reveal.explanation")}
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
                  ? t("giveBackBusy")
                  : t("giveBack.label", { announcerName })}
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
              {t("ownerWatching.title", { announcerName })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("ownerWatching.message")}
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
                ? t("takeControl.busy")
                : t("takeControl.button", { announcerName })}
            </button>
            <button
              type="button"
              onClick={handleSkipAnnouncer}
              disabled={
                skipState.kind === "submitting" ||
                handoffState.kind === "submitting"
              }
              aria-label={t("skip.aria", { announcerName })}
              className="w-full rounded-lg border-2 border-muted-foreground/30 bg-muted/30 px-3 py-2 text-sm font-medium transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              {skipState.kind === "submitting"
                ? t("skip.busy")
                : t("skip.button", { announcerName })}
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
              {t("passive.message")}
            </p>
          </div>
        ) : null}

        {/* Active driver, queue exhausted but rotation broadcast hasn't landed. */}
        {isActiveDriver && announcement && !announcement.pendingReveal ? (
          <div className="rounded-2xl border-2 border-border bg-card px-5 py-4 text-center text-muted-foreground text-sm">
            {t("allPointsRevealed")}
          </div>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("leaderboard.title")}
          </h2>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("leaderboard.empty")}
            </p>
          ) : (
            <ol className="space-y-1.5">
              {leaderboard.map((entry) => (
                <LeaderboardRow
                  key={entry.contestantId}
                  entry={entry}
                  contestant={contestantById.current.get(entry.contestantId)}
                  density={surface}
                />
              ))}
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
              onReshuffle={isOwner ? handleReshuffle : undefined}
              reshuffling={reshuffling}
              canReshuffle={isOwner && canReshuffle}
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
            {reshuffleError ? (
              <p
                role="alert"
                data-testid="reshuffle-error"
                className="text-xs text-destructive text-center"
              >
                {reshuffleError}
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

function ShortStyleRevealCard({
  onReveal,
  submitting,
  error,
  contestant,
  justRevealedContestant,
  isDelegate,
  announcerName,
  handoffState,
  onHandoffBack,
}: {
  onReveal: () => void;
  submitting: boolean;
  error?: string;
  contestant: Contestant | null;
  justRevealedContestant: Contestant | null;
  isDelegate: boolean;
  announcerName: string;
  handoffState: { kind: "idle" | "submitting"; error?: string };
  onHandoffBack: () => void;
}) {
  const t = useTranslations();

  if (justRevealedContestant) {
    return (
      <div className="space-y-4">
        <p className="text-center text-sm font-semibold text-primary">
          {t("announce.shortReveal.revealed")}
        </p>
        <TwelvePointSplash contestant={justRevealedContestant} size="card" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-accent/60 bg-accent/5 px-5 py-6 space-y-4 text-center">
      <button
        type="button"
        onClick={onReveal}
        disabled={submitting || !contestant}
        className="w-full rounded-xl bg-primary px-6 py-5 text-2xl font-bold text-primary-foreground transition-all hover:scale-[1.01] hover:emx-glow-gold active:scale-[0.99] disabled:opacity-60"
      >
        {submitting ? "…" : t("announce.shortReveal.cta")}
      </button>
      <p className="text-xs text-muted-foreground">
        {t("announce.shortReveal.ctaMicrocopy")}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {isDelegate ? (
        <button
          type="button"
          onClick={onHandoffBack}
          disabled={handoffState.kind === "submitting"}
          className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-medium transition-all hover:border-accent disabled:opacity-60"
        >
          {handoffState.kind === "submitting"
            ? t("announcing.giveBackBusy")
            : t("announcing.giveBack.label", { announcerName })}
        </button>
      ) : null}
    </div>
  );
}

function LeaderboardRow({
  entry,
  contestant,
  density,
}: {
  entry: LeaderboardEntry;
  contestant: Contestant | undefined;
  density: "driver" | "watcher";
}) {
  const country = contestant?.country ?? entry.contestantId;
  const flag = contestant?.flagEmoji ?? "🏳️";
  const rowCls =
    density === "watcher"
      ? "flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1"
      : "flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2";
  const rankCls =
    density === "watcher"
      ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-background text-[10px] font-semibold text-muted-foreground"
      : "inline-flex items-center justify-center w-6 h-6 rounded-full bg-background text-xs font-semibold text-muted-foreground";
  const countryCls =
    density === "watcher" ? "text-xs font-medium" : "text-sm font-medium";
  const pointsCls =
    density === "watcher"
      ? "font-mono text-xs font-bold tabular-nums"
      : "font-mono text-sm font-bold tabular-nums";
  const flagCls = density === "watcher" ? "text-base" : "text-xl";

  return (
    <li
      className={rowCls}
      data-testid="leaderboard-row"
      data-density={density}
    >
      <div className="flex items-center gap-2">
        <span className={rankCls}>{entry.rank}</span>
        <span className={flagCls} aria-hidden>
          {flag}
        </span>
        <span className={countryCls}>{country}</span>
      </div>
      <span className={pointsCls}>{entry.totalPoints}</span>
    </li>
  );
}

function HeaderCard({
  mode,
  announcer,
}: {
  mode: Mode;
  announcer: AnnouncementState;
}) {
  const t = useTranslations("announcing");
  const announcerName = announcer.announcingDisplayName;
  const announcerSeed = announcer.announcingAvatarSeed;

  if (mode === "active-announcer") {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border-2 border-primary px-5 py-4 space-y-2">
        <p className="text-2xl font-extrabold text-primary">
          {t("activeAnnouncer.title")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("activeAnnouncer.subtitle")}
        </p>
      </div>
    );
  }

  if (mode === "active-delegate") {
    return (
      <div className="rounded-2xl bg-accent/10 border-2 border-accent px-5 py-4 space-y-2">
        <p className="text-lg font-bold">
          {t("activeDelegate.title", { announcerName })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("activeDelegate.subtitle")}
        </p>
      </div>
    );
  }

  if (mode === "passive-announcer") {
    return (
      <div className="flex items-center justify-center gap-3">
        <Avatar seed={announcerSeed} size={36} />
        <p className="text-base">
          <span className="font-semibold">{t("adminAnnouncingOnBehalf.prefix")}</span>{" "}
          <span className="text-muted-foreground">
            {t("adminAnnouncingOnBehalf.suffix")}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-3">
      <Avatar seed={announcerSeed} size={40} />
      <p className="text-base font-semibold">
        {t("ownerWatching.title", { announcerName })}
      </p>
    </div>
  );
}
