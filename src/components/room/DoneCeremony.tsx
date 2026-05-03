"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import LeaderboardCeremony from "@/components/instant/LeaderboardCeremony";
import AwardsCeremony from "@/components/awards/AwardsCeremony";
import EndOfShowCtas from "@/components/awards/EndOfShowCtas";
import { awardCeremonySequence } from "@/lib/awards/awardCeremonySequence";
import { formatRoomSummary } from "@/lib/results/formatRoomSummary";
import type { Contestant, EventType, RoomAward } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

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
    );
  }, [data, categories]);

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

  if (phase === "leaderboard") {
    return (
      <LeaderboardCeremony
        roomId={roomId}
        onAfterSettle={() =>
          setPhase(sequence.length === 0 ? "ctas" : "awards")
        }
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
        shareUrl={shareUrl}
        textSummary={textSummary}
        year={data?.year ?? new Date().getFullYear()}
        event={data?.event ?? "final"}
      />
    </main>
  );
}
