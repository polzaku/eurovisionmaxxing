"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/session";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import {
  fetchRoomData,
  joinRoomApi,
  patchRoomStatus,
  postRoomScore,
  postRoomReady,
  postRoomOwnPoints,
  refreshContestantsApi,
  patchAnnouncementMode,
  patchRoomCategories,
  type VotingCategoryShape,
  type FetchRoomData,
} from "@/lib/room/api";
import { contestantDiff } from "@/lib/rooms/contestantDiff";
import {
  initialVotingProgressState,
  nextVotingProgress,
  countsFromState,
  type VotingProgressState,
} from "@/lib/voting/votingProgressReducer";
import InstantAnnouncingView from "@/components/room/InstantAnnouncingView";
import type { OwnBreakdownEntry } from "@/components/instant/OwnPointsCeremony";
import { mapRoomError } from "@/lib/room/errors";
import LobbyView, {
  type LobbyMember,
  type StartVotingState,
} from "@/components/room/LobbyView";
import StatusStub from "@/components/room/StatusStub";
import ScoringScreen from "@/components/room/ScoringScreen";
import CatchingUpPill from "@/components/room/CatchingUpPill";
import AnnouncingView from "@/components/room/AnnouncingView";
import DoneCeremony from "@/components/room/DoneCeremony";
import VotingView from "@/components/voting/VotingView";
import EndVotingModal from "@/components/voting/EndVotingModal";
import EndVotingCountdownToast from "@/components/voting/EndVotingCountdownToast";
import EndingPill from "@/components/voting/EndingPill";
import type { Contestant } from "@/types";
import { useVoteAutosave } from "@/components/voting/useVoteAutosave";
import { postVote } from "@/lib/voting/postVote";
import type { VoteView } from "@/lib/rooms/get";
import { seedScoresFromVotes } from "@/lib/voting/seedScoresFromVotes";
import { seedMissedFromVotes } from "@/lib/voting/seedMissedFromVotes";
import { seedHotTakesFromVotes } from "@/lib/voting/seedHotTakesFromVotes";
import LateJoinerCard from "@/components/voting/LateJoinerCard";
import {
  markLobbySeen,
  useLateJoinerVisibility,
} from "@/hooks/useLateJoinerVisibility";
import { useRoomHeartbeat } from "@/hooks/useRoomHeartbeat";

interface MembershipShape {
  userId: string;
  displayName: string;
  avatarSeed: string;
  joinedAt?: string;
  isReady?: boolean;
  readyAt?: string | null;
}

interface RoomShape {
  id: string;
  pin: string;
  status: string;
  ownerUserId: string;
  categories: Array<{ name: string; weight: number; hint?: string }>;
  announcementMode?: string;
  announcementStyle: 'full' | 'short';
  announcementOrder?: string[] | null;
  announcingUserId?: string | null;
  currentAnnounceIdx?: number | null;
  votingEndsAt?: string | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      room: RoomShape;
      memberships: MembershipShape[];
      contestants: Contestant[];
      votes: VoteView[];
      broadcastStartUtc: string | null;
    };

/**
 * Defensive: if the caller's membership isn't in the roster the server returned
 * (can happen on fresh joins due to read-after-write latency), splice them in
 * from session data so the user always sees themselves in the lobby.
 */
function ensureSelfInMemberships(
  memberships: MembershipShape[],
  session: { userId: string; displayName: string; avatarSeed: string }
): MembershipShape[] {
  if (memberships.some((m) => m.userId === session.userId)) return memberships;
  return [
    ...memberships,
    {
      userId: session.userId,
      displayName: session.displayName,
      avatarSeed: session.avatarSeed,
    },
  ];
}

export default function RoomPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [startVotingState, setStartVotingState] = useState<StartVotingState>({
    kind: "idle",
  });
  const [endVotingModalOpen, setEndVotingModalOpen] = useState(false);
  const [endVotingBusy, setEndVotingBusy] = useState(false);
  const [endVotingError, setEndVotingError] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const finalizeFiredRef = useRef(false);
  const [ownBreakdown, setOwnBreakdown] = useState<OwnBreakdownEntry[] | null>(
    null,
  );
  // SPEC §8.8 voting-progress chip state — accumulates from realtime
  // broadcasts. Empty on load (no aggregate endpoint per spec); populates
  // as guests vote.
  const [votingProgress, setVotingProgress] = useState<VotingProgressState>(
    () => initialVotingProgressState(),
  );
  // SPEC §10.2 / TODO L10 — when the user lands on a room that's already
  // in `announcing`, show a brief "Catching up…" pill so they understand
  // they're joining mid-reveal. Tracked via a ref to fire only on first
  // ready transition, not on every refetch.
  const initialStatusSeenRef = useRef<string | null>(null);
  const [showCatchingUp, setShowCatchingUp] = useState(false);

  const roomId = params.id;

  // Session guard — existing behaviour.
  useEffect(() => {
    if (getSession()) return;
    router.replace(`/onboard?next=/room/${encodeURIComponent(roomId)}`);
  }, [roomId, router]);

  // SPEC §6.3.2 late-joiner detection (must be hoisted above conditional
  // returns so hook order stays stable across renders).
  const sessionUserId =
    typeof window !== "undefined" ? getSession()?.userId : undefined;
  const phaseStatus = phase.kind === "ready" ? phase.room.status : "";
  const lateJoiner = useLateJoinerVisibility(roomId, sessionUserId, phaseStatus);

  // While the room is in lobby for this user, mark a localStorage flag
  // so a later transition into voting doesn't surface the "you joined
  // mid-show" card to someone who was actually there from the start.
  useEffect(() => {
    if (phaseStatus !== "lobby") return;
    if (!sessionUserId) return;
    markLobbySeen(roomId, sessionUserId);
  }, [phaseStatus, roomId, sessionUserId]);

  // SPEC §10.2.1 — keep last_seen_at fresh so the advance-time cascade
  // can determine whether the current announcer is absent.
  useRoomHeartbeat(roomId, sessionUserId ?? null, true);

  const loadRoom = useCallback(async () => {
    const session = getSession();
    if (!session) return;

    setPhase({ kind: "loading" });

    const fetchResult = await fetchRoomData(roomId, session.userId, {
      fetch: window.fetch.bind(window),
    });
    if (!fetchResult.ok) {
      setPhase({ kind: "error", message: mapRoomError(fetchResult.code) });
      return;
    }

    const data = fetchResult.data as FetchRoomData;
    const room = data.room as RoomShape;
    let memberships = data.memberships as MembershipShape[];

    const isMember = memberships.some((m) => m.userId === session.userId);
    if (!isMember) {
      const joinResult = await joinRoomApi(roomId, session.userId, {
        fetch: window.fetch.bind(window),
      });
      if (!joinResult.ok) {
        setPhase({ kind: "error", message: mapRoomError(joinResult.code) });
        return;
      }
      // Refetch so we render with the new membership list.
      const refetch = await fetchRoomData(roomId, session.userId, {
        fetch: window.fetch.bind(window),
      });
      if (!refetch.ok) {
        setPhase({ kind: "error", message: mapRoomError(refetch.code) });
        return;
      }
      const refetched = refetch.data as FetchRoomData;
      memberships = refetched.memberships as MembershipShape[];
      setPhase({
        kind: "ready",
        room: refetched.room as RoomShape,
        memberships: ensureSelfInMemberships(memberships, session),
        contestants: (refetched.contestants ?? []) as Contestant[],
        votes: (refetched.votes ?? []) as VoteView[],
        broadcastStartUtc: refetched.broadcastStartUtc as string | null ?? null,
      });
      return;
    }

    setPhase({
      kind: "ready",
      room,
      memberships: ensureSelfInMemberships(memberships, session),
      contestants: (data.contestants ?? []) as Contestant[],
      votes: (data.votes ?? []) as VoteView[],
      broadcastStartUtc: data.broadcastStartUtc as string | null ?? null,
    });
  }, [roomId]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  useRoomRealtime(roomId, (event) => {
    if (event.type === "status_changed") {
      void loadRoom();
      return;
    }
    if (event.type === "voting_ending") {
      void loadRoom();
      return;
    }
    if (event.type === "contestants_refreshed") {
      void loadRoom();
      return;
    }
    if (event.type === "voting_progress") {
      const categoriesCount =
        phase.kind === "ready" ? (phase.room.categories ?? []).length : 0;
      setVotingProgress((s) => nextVotingProgress(s, event, categoriesCount));
      return;
    }
    if (event.type === "user_joined") {
      setPhase((prev) => {
        if (prev.kind !== "ready") return prev;
        if (prev.memberships.some((m) => m.userId === event.user.id)) return prev;
        return {
          ...prev,
          memberships: [
            ...prev.memberships,
            {
              userId: event.user.id,
              displayName: event.user.displayName,
              avatarSeed: event.user.avatarSeed,
            },
          ],
        };
      });
    }
    if (event.type === "member_ready") {
      // Optimistically update the membership's isReady + readyAt so the UI
      // reflects the change before the next full refetch lands.
      setPhase((prev) => {
        if (prev.kind !== "ready") return prev;
        return {
          ...prev,
          memberships: prev.memberships.map((m) =>
            m.userId === event.userId
              ? { ...m, isReady: true, readyAt: event.readyAt ?? null }
              : m,
          ),
        };
      });
    }
  });

  const handleStartVoting = useCallback(async () => {
    const session = getSession();
    if (!session || phase.kind !== "ready") return;
    setStartVotingState({ kind: "submitting" });
    const result = await patchRoomStatus(roomId, "voting", session.userId, {
      fetch: window.fetch.bind(window),
    });
    if (result.ok) {
      // status_changed broadcast will drive a refetch; meanwhile stay as idle.
      setStartVotingState({ kind: "idle" });
      return;
    }
    setStartVotingState({
      kind: "error",
      message: mapRoomError(result.code),
    });
  }, [phase, roomId]);

  const startEndVoting = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    setEndVotingBusy(true);
    setEndVotingError(null);
    const result = await patchRoomStatus(roomId, "voting_ending", session.userId, {
      fetch: window.fetch.bind(window),
    });
    setEndVotingBusy(false);
    if (result.ok) {
      setEndVotingModalOpen(false);
      // voting_ending broadcast triggers a refetch; toast renders from new room state.
      return;
    }
    setEndVotingError(mapRoomError(result.code));
  }, [roomId]);

  const undoEndVoting = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    setUndoBusy(true);
    await patchRoomStatus(roomId, "voting", session.userId, {
      fetch: window.fetch.bind(window),
    });
    setUndoBusy(false);
  }, [roomId]);

  const finalizeVoting = useCallback(async () => {
    if (finalizeFiredRef.current) return;
    finalizeFiredRef.current = true;
    const session = getSession();
    if (!session) return;
    await postRoomScore(roomId, session.userId, {
      fetch: window.fetch.bind(window),
    });
  }, [roomId]);

  // SPEC §10.2 / L10 — first-ready detection: if the user lands on the
  // room while it's already announcing, flash the Catching-up pill once.
  // Subsequent status_changed broadcasts don't trigger it.
  useEffect(() => {
    if (phase.kind !== "ready") return;
    if (initialStatusSeenRef.current !== null) return;
    initialStatusSeenRef.current = phase.room.status;
    if (phase.room.status === "announcing") {
      setShowCatchingUp(true);
    }
  }, [phase]);

  // Stale-reload recovery (admin reloaded after the 5-s deadline elapsed).
  useEffect(() => {
    if (phase.kind !== "ready") return;
    if (phase.room.status !== "voting_ending") return;
    const session = getSession();
    if (!session || session.userId !== phase.room.ownerUserId) return;
    const deadline = phase.room.votingEndsAt;
    if (!deadline) return;
    if (new Date(deadline).getTime() > Date.now()) return;
    void finalizeVoting();
  }, [phase, finalizeVoting]);

  const handleCopyPin = useCallback(() => {
    if (phase.kind !== "ready") return;
    void navigator.clipboard?.writeText(phase.room.pin);
  }, [phase]);

  const handleCopyLink = useCallback(() => {
    if (phase.kind !== "ready") return;
    const base =
      process.env.NEXT_PUBLIC_APP_URL ??
      (typeof window !== "undefined" ? window.location.origin : "");
    void navigator.clipboard?.writeText(`${base}/room/${phase.room.id}`);
  }, [phase]);

  const handleRefreshContestants = useCallback(async () => {
    if (phase.kind !== "ready") return null;
    const session = getSession();
    if (!session) return null;
    const prev = phase.contestants;
    const result = await refreshContestantsApi(
      phase.room.id,
      session.userId,
      { fetch: window.fetch.bind(window) },
    );
    if (!result.ok || !result.data) return null;
    const next = result.data.contestants as Contestant[];
    setPhase((p) =>
      p.kind === "ready" ? { ...p, contestants: next } : p,
    );
    return contestantDiff(prev, next);
  }, [phase]);

  const handleChangeAnnouncementMode = useCallback(
    async (mode: "live" | "instant") => {
      if (phase.kind !== "ready") return;
      const session = getSession();
      if (!session) return;
      const result = await patchAnnouncementMode(
        phase.room.id,
        mode,
        session.userId,
        { fetch: window.fetch.bind(window) },
      );
      if (!result.ok) return;
      // status_changed broadcast triggers a refetch — meanwhile update
      // local phase optimistically so the UI doesn't lag.
      setPhase((p) =>
        p.kind === "ready"
          ? { ...p, room: { ...p.room, announcementMode: mode } }
          : p,
      );
    },
    [phase],
  );

  const handleChangeAnnouncementStyle = useCallback(
    async (next: "full" | "short") => {
      if (phase.kind !== "ready") return;
      const session = getSession();
      if (!session) return;
      const result = await patchAnnouncementMode(
        phase.room.id,
        phase.room.announcementMode as "live" | "instant",
        session.userId,
        { fetch: window.fetch.bind(window) },
        { style: next },
      );
      if (!result.ok) return;
      // Optimistic update — broadcast triggers a refetch shortly after.
      setPhase((p) =>
        p.kind === "ready"
          ? { ...p, room: { ...p.room, announcementStyle: next } }
          : p,
      );
    },
    [phase],
  );

  const handleChangeCategories = useCallback(
    async (categories: VotingCategoryShape[]) => {
      if (phase.kind !== "ready") return;
      const session = getSession();
      if (!session) return;
      const result = await patchRoomCategories(
        phase.room.id,
        categories,
        session.userId,
        { fetch: window.fetch.bind(window) },
      );
      if (!result.ok) return;
      // Optimistic update — broadcast triggers a refetch shortly after.
      setPhase((p) =>
        p.kind === "ready"
          ? {
              ...p,
              room: {
                ...p.room,
                categories: categories.map((c) => ({
                  name: c.name,
                  weight: c.weight ?? 1,
                  hint: c.hint,
                })),
              },
            }
          : p,
      );
    },
    [phase],
  );

  const handleMarkReady = useCallback(async () => {
    if (!phase || phase.kind !== "ready") return;
    const session = getSession();
    if (!session) return;
    const result = await postRoomReady(phase.room.id, session.userId, {
      fetch: window.fetch.bind(window),
    });
    if (!result.ok) {
      // Best-effort — failures are visible by the chip not updating.
      return;
    }
    // The member_ready broadcast will refresh memberships via realtime;
    // also refetch as a safety net in case the broadcast lands later.
    void loadRoom();
  }, [phase, loadRoom]);

  const handleReveal = useCallback(async () => {
    if (!phase || phase.kind !== "ready") return;
    const session = getSession();
    if (!session) return;
    const result = await patchRoomStatus(
      phase.room.id,
      "done",
      session.userId,
      { fetch: window.fetch.bind(window) },
    );
    if (!result.ok) return;
    // status_changed broadcast will drive refetch + DoneCard render.
  }, [phase]);

  // Fetch own Eurovision points when entering instant-mode announcing.
  useEffect(() => {
    if (
      phase.kind !== "ready" ||
      phase.room.status !== "announcing" ||
      phase.room.announcementMode !== "instant"
    ) {
      setOwnBreakdown(null);
      return;
    }
    if (ownBreakdown !== null) return;

    let cancelled = false;
    void (async () => {
      const session = getSession();
      if (!session) return;
      const result = await postRoomOwnPoints(
        phase.room.id,
        session.userId,
        { fetch: window.fetch.bind(window) },
      );
      if (cancelled || !result.ok) return;
      setOwnBreakdown(
        result.data!.entries.map((e) => ({
          contestantId: e.contestantId,
          pointsAwarded: e.pointsAwarded,
          hotTake: e.hotTake,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, ownBreakdown]);

  const memoizedPostVote = useCallback(
    (payload: Parameters<typeof postVote>[0]) =>
      postVote(payload, { fetch: window.fetch.bind(window) }),
    []
  );
  const memoizedFetchServerVotes = useCallback(
    async (
      voteRoomId: string,
      voteUserId: string
    ): Promise<{ contestantId: string; updatedAt: string }[]> => {
      const result = await fetchRoomData(voteRoomId, voteUserId, {
        fetch: window.fetch.bind(window),
      });
      if (!result.ok || !result.data) return [];
      const votes = (result.data.votes ?? []) as Array<{
        contestantId: string;
        updatedAt: string;
      }>;
      return votes.map((v) => ({
        contestantId: v.contestantId,
        updatedAt: v.updatedAt,
      }));
    },
    []
  );
  const autosave = useVoteAutosave({
    roomId,
    userId: getSession()?.userId ?? null,
    post: memoizedPostVote,
    fetchServerVotes: memoizedFetchServerVotes,
  });

  if (phase.kind === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p className="text-muted-foreground animate-shimmer">Loading room…</p>
      </main>
    );
  }

  if (phase.kind === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <div className="max-w-md w-full text-center space-y-3 animate-fade-in">
          <h1 className="text-2xl font-bold tracking-tight">Can&rsquo;t open room</h1>
          <p role="alert" className="text-sm text-destructive">
            {phase.message}
          </p>
        </div>
      </main>
    );
  }

  const session = getSession();
  const isAdmin = !!session && session.userId === phase.room.ownerUserId;

  if (phase.room.status === "lobby") {
    const members: LobbyMember[] = phase.memberships.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      avatarSeed: m.avatarSeed,
    }));
    const shareBase =
      process.env.NEXT_PUBLIC_APP_URL ??
      (typeof window !== "undefined" ? window.location.origin : "");
    const shareUrl = `${shareBase}/room/${phase.room.id}`;
    return (
      <LobbyView
        pin={phase.room.pin}
        ownerUserId={phase.room.ownerUserId}
        memberships={members}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        startVotingState={startVotingState}
        shareUrl={shareUrl}
        onStartVoting={handleStartVoting}
        onCopyPin={handleCopyPin}
        onCopyLink={handleCopyLink}
        onRefreshContestants={isAdmin ? handleRefreshContestants : undefined}
        announcementMode={
          phase.room.announcementMode === "live" ||
          phase.room.announcementMode === "instant"
            ? phase.room.announcementMode
            : undefined
        }
        onChangeAnnouncementMode={
          isAdmin ? handleChangeAnnouncementMode : undefined
        }
        announcementStyle={phase.room.announcementStyle}
        onChangeAnnouncementStyle={
          isAdmin ? handleChangeAnnouncementStyle : undefined
        }
        onChangeCategories={
          isAdmin ? handleChangeCategories : undefined
        }
        roomId={roomId}
        currentUserId={session?.userId ?? ""}
        broadcastStartUtc={phase.broadcastStartUtc}
        contestants={phase.contestants}
      />
    );
  }

  if (
    phase.room.status === "voting" ||
    phase.room.status === "voting_ending"
  ) {
    const initialScores = seedScoresFromVotes(
      phase.votes,
      (phase.room.categories ?? []).map((c) => c.name),
      phase.contestants.map((c) => c.id)
    );
    const initialMissed = seedMissedFromVotes(
      phase.votes,
      phase.contestants.map((c) => c.id)
    );
    const initialHotTakes = seedHotTakesFromVotes(
      phase.votes,
      phase.contestants.map((c) => c.id)
    );
    const adminDisplayName = phase.memberships.find(
      (m) => m.userId === phase.room.ownerUserId
    )?.displayName;
    const isEnding = phase.room.status === "voting_ending";
    const votingEndsAt = phase.room.votingEndsAt ?? null;
    const scoredByCounts: Record<string, number> = {};
    for (const c of phase.contestants) {
      scoredByCounts[c.id] = countsFromState(votingProgress, c.id);
    }
    const roomMemberTotal = phase.memberships.length;
    // SPEC §8.11.2 "Count semantics" — feed real room-wide completion data
    // to <EndOfVotingCard> via VotingView so the host doesn't see the
    // misleading "1 of 1 done so far" default. Compute from the existing
    // voting_progress reducer state (Map<contestantId, Set<userId>>).
    // Skip when memberships are empty (degenerate; component handles
    // undefined as the no-count fallback).
    let roomCompletion:
      | {
          lastContestantCompletedOthers: number;
          eligibleVoterCount: number;
          allEligibleAllDone: boolean;
        }
      | undefined;
    const sessionUserId = getSession()?.userId ?? null;
    if (
      roomMemberTotal > 0 &&
      phase.contestants.length > 0 &&
      sessionUserId
    ) {
      const sortedByOrder = [...phase.contestants].sort(
        (a, b) => a.runningOrder - b.runningOrder,
      );
      const lastId = sortedByOrder[sortedByOrder.length - 1]?.id;
      const lastSet = lastId ? votingProgress.get(lastId) : undefined;
      const lastTotal = lastSet?.size ?? 0;
      const lastIncludesSelf = lastSet?.has(sessionUserId) ?? false;
      const lastContestantCompletedOthers = Math.max(
        0,
        lastTotal - (lastIncludesSelf ? 1 : 0),
      );
      const allEligibleAllDone = sortedByOrder.every((c) => {
        const set = votingProgress.get(c.id);
        return !!set && set.size === roomMemberTotal;
      });
      roomCompletion = {
        lastContestantCompletedOthers,
        eligibleVoterCount: roomMemberTotal,
        allEligibleAllDone,
      };
    }
    return (
      <>
        {isEnding ? (
          isAdmin ? (
            <EndVotingCountdownToast
              votingEndsAt={votingEndsAt}
              onUndo={undoEndVoting}
              onElapsed={() => void finalizeVoting()}
              undoBusy={undoBusy}
            />
          ) : (
            <EndingPill votingEndsAt={votingEndsAt} />
          )
        ) : null}
        <EndVotingModal
          isOpen={endVotingModalOpen}
          busy={endVotingBusy}
          errorMessage={endVotingError}
          onConfirm={startEndVoting}
          onCancel={() => {
            setEndVotingModalOpen(false);
            setEndVotingError(null);
          }}
        />
        {lateJoiner.visibility === "show" && (
          <div className="px-6 pt-4">
            <div className="max-w-md mx-auto">
              <LateJoinerCard onDismiss={lateJoiner.dismiss} />
            </div>
          </div>
        )}
        <VotingView
          contestants={phase.contestants}
          categories={phase.room.categories ?? []}
          isAdmin={isAdmin}
          adminDisplayName={adminDisplayName}
          onEndVoting={
            isAdmin && !isEnding ? () => setEndVotingModalOpen(true) : undefined
          }
          onScoreChange={autosave.onScoreChange}
          onMissedChange={autosave.onMissedChange}
          onHotTakeChange={autosave.onHotTakeChange}
          saveStatus={autosave.status}
          initialScores={initialScores}
          initialMissed={initialMissed}
          initialHotTakes={initialHotTakes}
          roomId={phase.room.id}
          userId={getSession()?.userId ?? undefined}
          offlineBannerVisible={autosave.offlineBannerVisible}
          drainNotice={autosave.drainNotice}
          onDismissDrainNotice={autosave.dismissDrainNotice}
          queueOverflow={autosave.queueOverflow}
          scoredByCounts={scoredByCounts}
          roomMemberTotal={roomMemberTotal}
          roomCompletion={roomCompletion}
        />
      </>
    );
  }

  if (phase.room.status === "announcing") {
    const session = getSession();
    if (!session) return <StatusStub status={phase.room.status} />;

    if (phase.room.announcementMode === "instant") {
      const members = phase.memberships.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        isReady: m.isReady ?? false,
        readyAt: m.readyAt ?? null,
      }));

      return (
        <>
          <CatchingUpPill active={showCatchingUp} />
          <InstantAnnouncingView
            room={{
              id: phase.room.id,
              ownerUserId: phase.room.ownerUserId,
            }}
            contestants={phase.contestants}
            memberships={members}
            currentUserId={session.userId}
            ownBreakdown={ownBreakdown ?? []}
            onMarkReady={handleMarkReady}
            onReveal={handleReveal}
          />
        </>
      );
    }

    const rosterMembers = phase.memberships.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      avatarSeed: m.avatarSeed,
    }));

    return (
      <>
        <CatchingUpPill active={showCatchingUp} />
        <AnnouncingView
          room={{
            id: phase.room.id,
            status: phase.room.status,
            ownerUserId: phase.room.ownerUserId,
          }}
          announcementStyle={phase.room.announcementStyle}
          contestants={phase.contestants}
          currentUserId={session.userId}
          members={rosterMembers}
          onAnnouncementEnded={() => void loadRoom()}
        />
      </>
    );
  }

  if (phase.room.status === "done") {
    return (
      <DoneCeremony
        roomId={phase.room.id}
        isAdmin={isAdmin}
        categories={phase.room.categories ?? []}
      />
    );
  }

  if (phase.room.status === "scoring") {
    return <ScoringScreen />;
  }

  return <StatusStub status={phase.room.status} />;
}
