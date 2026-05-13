"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import LeaderboardCeremony from "@/components/instant/LeaderboardCeremony";
import AwardsCeremony from "@/components/awards/AwardsCeremony";
import EndOfShowCtas from "@/components/awards/EndOfShowCtas";
import { awardCeremonySequence } from "@/lib/awards/awardCeremonySequence";
import { formatRoomSummary } from "@/lib/results/formatRoomSummary";
import { getSession } from "@/lib/session";
import type { Contestant, EventType, RoomAward } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

interface DoneCeremonyProps {
  roomId: string;
  isAdmin: boolean;
  categories: Array<{ name: string; weight: number; key?: string }>;
}

interface DoneFixture {
  status: "done";
  year: number;
  event: EventType;
  pin: string;
  contestants: Contestant[];
  leaderboard: LeaderboardEntry[];
  awards: RoomAward[];
  members: Array<{ userId: string; displayName: string; avatarSeed: string }>;
  /** SPEC §11.2 your_neighbour — per-viewer entries, possibly []. */
  personalNeighbours?: PersonalNeighbour[];
}

type Phase = "leaderboard" | "awards" | "ctas";

/**
 * SPEC §11.3 orchestrator for the `done` status on `/room/[id]`. Sequences
 * the existing `<LeaderboardCeremony>` (Phase 5c.2) into the new awards
 * reveal (`<AwardsCeremony>`) and finally the 3-CTA footer
 * (`<EndOfShowCtas>`). Owns the single `/api/results/{id}` fetch so the
 * leaderboard and awards children don't double-fetch.
 */
export default function DoneCeremony({
  roomId,
  isAdmin,
  categories,
}: DoneCeremonyProps) {
  const t = useTranslations();
  const [data, setData] = useState<DoneFixture | null>(null);
  const [phase, setPhase] = useState<Phase>("leaderboard");
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  /**
   * Two-signal coordination: <LeaderboardCeremony>'s onAfterSettle fires
   * synchronously when its replay-skip flag is set, but our `data` fetch
   * may not have resolved yet. Flipping `settled` here keeps the
   * transition deferred until both signals are present (see the effect
   * below).
   */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setViewerUserId(getSession()?.userId ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/results/${encodeURIComponent(roomId)}`);
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (body.status === "done") setData(body as DoneFixture);
      } catch {
        /* render falls through to leaderboard's own loading shimmer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const sequence = useMemo(() => {
    if (!data) return [];
    return awardCeremonySequence(
      data.awards,
      data.contestants,
      data.members,
      categories,
      {
        personalNeighbours: data.personalNeighbours ?? [],
        viewerUserId,
      },
    );
  }, [data, categories, viewerUserId]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const base = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    return `${base}/results/${encodeURIComponent(roomId)}`;
  }, [roomId]);

  const textSummary = useMemo(() => {
    if (!data) return "";
    return formatRoomSummary({
      year: data.year,
      event: data.event,
      leaderboard: data.leaderboard,
      contestants: data.contestants,
      shareUrl,
      labels: {
        eventTitle: (year, event) => t(`eventTitle.${event}`, { year }),
        topLine: t("results.summary.topLine"),
        fullResults: t("results.summary.fullResults"),
      },
    });
  }, [data, shareUrl, t]);

  // Phase transition gate. Both halves of the race must complete before
  // we leave the leaderboard phase:
  //   1. <LeaderboardCeremony> has finished its cinematic and flipped `settled`.
  //   2. The /api/results fetch has populated `data` (and therefore `sequence`).
  // Without this gate, an instant LeaderboardCeremony settle (e.g. the
  // replay-skip flag is set) races the fetch and fast-forwards to "ctas"
  // with sequence === [], silently skipping every awards card.
  useEffect(() => {
    if (!settled) return;
    if (phase !== "leaderboard") return;
    if (!data) return;
    setPhase(sequence.length === 0 ? "ctas" : "awards");
  }, [settled, data, sequence, phase]);

  if (phase === "leaderboard") {
    return (
      <LeaderboardCeremony
        roomId={roomId}
        onAfterSettle={() => setSettled(true)}
      />
    );
  }

  if (phase === "awards") {
    return (
      <AwardsCeremony
        sequence={sequence}
        onAllRevealed={() => setPhase("ctas")}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <p className="text-2xl" aria-hidden>🎉</p>
      <EndOfShowCtas
        isAdmin={isAdmin}
        roomId={roomId}
        shareUrl={shareUrl}
        textSummary={textSummary}
        year={data?.year ?? new Date().getFullYear()}
        event={data?.event ?? "final"}
      />
    </main>
  );
}
