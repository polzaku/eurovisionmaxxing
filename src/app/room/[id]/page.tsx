"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/session";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import {
  fetchRoomData,
  joinRoomApi,
  patchRoomStatus,
  postRoomScore,
  type FetchRoomData,
} from "@/lib/room/api";
import { mapRoomError } from "@/lib/room/errors";
import LobbyView, {
  type LobbyMember,
  type StartVotingState,
} from "@/components/room/LobbyView";
import StatusStub from "@/components/room/StatusStub";
import AnnouncingView from "@/components/room/AnnouncingView";
import DoneCard from "@/components/room/DoneCard";
import VotingView from "@/components/voting/VotingView";
import type { Contestant } from "@/types";
import { useVoteAutosave } from "@/components/voting/useVoteAutosave";
import { postVote } from "@/lib/voting/postVote";
import type { VoteView } from "@/lib/rooms/get";
import { seedScoresFromVotes } from "@/lib/voting/seedScoresFromVotes";
import { seedMissedFromVotes } from "@/lib/voting/seedMissedFromVotes";
import { seedHotTakesFromVotes } from "@/lib/voting/seedHotTakesFromVotes";

interface MembershipShape {
  userId: string;
  displayName: string;
  avatarSeed: string;
  joinedAt?: string;
  isReady?: boolean;
}

interface RoomShape {
  id: string;
  pin: string;
  status: string;
  ownerUserId: string;
  categories: Array<{ name: string; weight: number; hint?: string }>;
  announcementMode?: string;
  announcementOrder?: string[] | null;
  announcingUserId?: string | null;
  currentAnnounceIdx?: number | null;
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
  const [endVotingState, setEndVotingState] = useState<{
    kind: "idle" | "submitting";
    error?: string;
  }>({ kind: "idle" });

  const roomId = params.id;

  // Session guard — existing behaviour.
  useEffect(() => {
    if (getSession()) return;
    router.replace(`/onboard?next=/room/${encodeURIComponent(roomId)}`);
  }, [roomId, router]);

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
      });
      return;
    }

    setPhase({
      kind: "ready",
      room,
      memberships: ensureSelfInMemberships(memberships, session),
      contestants: (data.contestants ?? []) as Contestant[],
      votes: (data.votes ?? []) as VoteView[],
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

  const handleEndVoting = useCallback(async () => {
    const session = getSession();
    if (!session || phase.kind !== "ready") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "End voting now? This locks scores and runs the scoring engine — there's no undo."
      )
    ) {
      return;
    }
    setEndVotingState({ kind: "submitting" });
    const result = await postRoomScore(roomId, session.userId, {
      fetch: window.fetch.bind(window),
    });
    if (result.ok) {
      // The status_changed broadcast (announcing) will drive a refetch.
      setEndVotingState({ kind: "idle" });
      return;
    }
    setEndVotingState({
      kind: "idle",
      error: mapRoomError(result.code),
    });
  }, [phase, roomId]);

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
      />
    );
  }

  if (phase.room.status === "voting") {
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
    return (
      <>
        {isAdmin ? (
          <div className="fixed top-3 right-3 z-30 flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleEndVoting}
              disabled={endVotingState.kind === "submitting"}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {endVotingState.kind === "submitting"
                ? "Ending…"
                : "End voting"}
            </button>
            {endVotingState.error ? (
              <p
                role="alert"
                className="max-w-[16rem] rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
              >
                {endVotingState.error}
              </p>
            ) : null}
          </div>
        ) : null}
        <VotingView
          contestants={phase.contestants}
          categories={phase.room.categories ?? []}
          isAdmin={isAdmin}
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
        />
      </>
    );
  }

  if (phase.room.status === "announcing") {
    const session = getSession();
    if (!session) return <StatusStub status={phase.room.status} />;
    return (
      <AnnouncingView
        room={{
          id: phase.room.id,
          status: phase.room.status,
          ownerUserId: phase.room.ownerUserId,
        }}
        contestants={phase.contestants}
        currentUserId={session.userId}
        onAnnouncementEnded={() => void loadRoom()}
      />
    );
  }

  if (phase.room.status === "done") {
    return <DoneCard roomId={phase.room.id} />;
  }

  return <StatusStub status={phase.room.status} />;
}
