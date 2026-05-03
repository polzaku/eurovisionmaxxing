"use client";

import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

export type PresentStatus =
  | "lobby"
  | "voting"
  | "voting_ending"
  | "scoring"
  | "announcing"
  | "done";

interface PresentScreenProps {
  status: PresentStatus;
  pin: string;
  contestants: Contestant[];
  /** Leaderboard rows. Required when status ∈ {announcing, done}. */
  leaderboard?: LeaderboardEntry[];
  /** Display name of the current announcer (live mode). */
  announcerDisplayName?: string;
  /** Total room members for §8.x progress copy. */
  roomMemberTotal?: number;
}

const RANK_MEDAL: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

/**
 * SPEC §10.3 — TV-optimized presentation surface. Always-dark theme
 * (forced at the route level), 16:9-friendly layout, large type for
 * cross-room readability. Status-aware:
 *
 * - lobby            → "Room PIN" + "Waiting for the show…"
 * - voting / ending  → "Voting in progress…"
 * - scoring          → shimmer "Tallying results…"
 * - announcing/done  → live leaderboard with rank, flag, country, total
 *
 * Three-surface differentiation (announcer phone vs guest phone vs TV
 * showing different content during each reveal step) is the full §10.2
 * L1 matrix and lands in a follow-on slice. This component is the TV
 * surface only; the leaderboard render assumes the caller has already
 * fetched and sorted by `rank` ascending.
 */
export default function PresentScreen({
  status,
  pin,
  contestants,
  leaderboard,
  announcerDisplayName,
  roomMemberTotal,
}: PresentScreenProps) {
  const t = useTranslations();
  const contestantById = new Map(contestants.map((c) => [c.id, c]));

  if (status === "lobby") {
    return (
      <main
        data-testid="present-screen"
        data-status="lobby"
        className="flex min-h-screen flex-col items-center justify-center px-12 py-12 text-center"
      >
        <p className="text-xs uppercase tracking-[0.5em] text-muted-foreground">
          {t("present.lobby.eyebrow")}
        </p>
        <p className="mt-6 text-[10vw] font-mono font-bold tracking-[0.5em] text-foreground leading-none">
          {pin}
        </p>
        <p className="mt-12 text-3xl font-semibold text-muted-foreground">
          {t("present.lobby.callToJoin")}
        </p>
        {roomMemberTotal !== undefined ? (
          <p className="mt-3 text-lg text-muted-foreground">
            {t("present.lobby.memberCount", { count: roomMemberTotal })}
          </p>
        ) : null}
      </main>
    );
  }

  if (status === "voting" || status === "voting_ending") {
    return (
      <main
        data-testid="present-screen"
        data-status={status}
        className="flex min-h-screen flex-col items-center justify-center px-12 py-12 text-center"
      >
        <p className="text-2xl text-muted-foreground">
          {t("present.voting.eyebrow")}
        </p>
        <p className="mt-6 text-7xl font-bold motion-safe:animate-shimmer">
          {status === "voting_ending"
            ? t("present.votingEnding.title")
            : t("present.voting.title")}
        </p>
      </main>
    );
  }

  if (status === "scoring") {
    return (
      <main
        data-testid="present-screen"
        data-status="scoring"
        className="flex min-h-screen flex-col items-center justify-center px-12 py-12 text-center"
      >
        <p className="text-9xl mb-6" aria-hidden>
          🎼
        </p>
        <h1
          className="text-7xl font-bold motion-safe:animate-shimmer"
          role="status"
          aria-live="polite"
        >
          {t("scoring.title")}
        </h1>
      </main>
    );
  }

  // announcing | done — render the leaderboard
  const rows = leaderboard ?? [];

  return (
    <main
      data-testid="present-screen"
      data-status={status}
      className="flex min-h-screen flex-col px-8 py-8 sm:px-12"
    >
      <header className="mb-6 flex items-baseline justify-between gap-6">
        <h1 className="text-4xl font-bold tracking-tight">
          {status === "done"
            ? t("present.done.title")
            : t("present.announcing.title")}
        </h1>
        {announcerDisplayName && status === "announcing" ? (
          <p className="text-2xl text-muted-foreground">
            {t("present.announcing.announcer", {
              name: announcerDisplayName,
            })}
          </p>
        ) : null}
      </header>
      <ol className="flex-1 space-y-2 overflow-hidden">
        {rows.map((row) => {
          const c = contestantById.get(row.contestantId);
          const medal = RANK_MEDAL[row.rank];
          return (
            <li
              key={row.contestantId}
              data-testid={`present-row-${row.contestantId}`}
              className="flex items-center justify-between gap-6 rounded-xl border border-border bg-card px-6 py-4 motion-safe:animate-fade-in"
            >
              <span className="flex items-center gap-6 min-w-0">
                <span className="w-12 text-center text-2xl tabular-nums font-bold text-muted-foreground">
                  {medal ?? row.rank}
                </span>
                <span className="text-5xl" aria-hidden>
                  {c?.flagEmoji ?? "🏳️"}
                </span>
                <span className="text-3xl font-semibold truncate">
                  {c?.country ?? row.contestantId}
                </span>
              </span>
              <span className="text-4xl font-bold tabular-nums text-primary">
                {row.totalPoints}
              </span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
