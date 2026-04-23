"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/session";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import {
  fetchRoomData,
  joinRoomApi,
  patchRoomStatus,
  type FetchRoomData,
} from "@/lib/room/api";
import { mapRoomError } from "@/lib/room/errors";
import LobbyView, {
  type LobbyMember,
  type StartVotingState,
} from "@/components/room/LobbyView";
import StatusStub from "@/components/room/StatusStub";
import VotingView from "@/components/voting/VotingView";
import type { Contestant } from "@/types";

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

    const fetchResult = await fetchRoomData(roomId, {
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
      const refetch = await fetchRoomData(roomId, {
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
      });
      return;
    }

    setPhase({
      kind: "ready",
      room,
      memberships: ensureSelfInMemberships(memberships, session),
      contestants: (data.contestants ?? []) as Contestant[],
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
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
      />
    );
  }

  return <StatusStub status={phase.room.status} />;
}
