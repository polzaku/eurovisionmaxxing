"use client";

import { useLayoutEffect, useRef } from "react";
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
  /**
   * The reveal that's about to happen — pulled from the announcement state
   * exposed by /api/results. Null when the queue is exhausted (transitional);
   * undefined when the caller doesn't have it (e.g. instant mode or a
   * pre-announce poll). When truthy, the TV renders the "Up next" card above
   * the leaderboard so the room can read what's coming before the announcer
   * speaks it (SPEC §10.2 turn / next-point indicators).
   */
  pendingReveal?: { contestantId: string; points: number } | null;
  /** 1-indexed position of the current announcer in `announcement_order`. */
  announcerPosition?: number;
  /** Total number of eligible announcers in `announcement_order`. */
  announcerCount?: number;
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
  pendingReveal,
  announcerPosition,
  announcerCount,
}: PresentScreenProps) {
  // TODO(R4 #3): subscribe to `announce_skip` events here and render <SkipBannerQueue> for the TV surface.
  // Tracked in TODO.md as part of /present "Awaiting an admin to continue…" copy slice.
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
  const showPosition =
    status === "announcing" &&
    typeof announcerPosition === "number" &&
    typeof announcerCount === "number" &&
    announcerCount > 0;
  const pendingContestant = pendingReveal
    ? contestantById.get(pendingReveal.contestantId)
    : null;

  return (
    <PresentLeaderboard
      status={status}
      rows={rows}
      contestantById={contestantById}
      announcerDisplayName={announcerDisplayName}
      titleAnnouncing={t("present.announcing.title")}
      titleDone={t("present.done.title")}
      announcerLabel={
        announcerDisplayName
          ? t("present.announcing.announcer", { name: announcerDisplayName })
          : ""
      }
      positionLabel={
        showPosition
          ? t("present.announcing.position", {
              position: announcerPosition,
              total: announcerCount,
            })
          : ""
      }
      pendingReveal={
        status === "announcing" && pendingReveal !== undefined
          ? {
              upNext: t("present.announcing.upNext"),
              detail: pendingReveal
                ? t("present.announcing.upNextDetail", {
                    points: pendingReveal.points,
                    country: pendingContestant?.country ?? pendingReveal.contestantId,
                  })
                : t("present.announcing.queueExhausted"),
              flagEmoji: pendingContestant?.flagEmoji ?? "🏳️",
              hasReveal: pendingReveal !== null,
            }
          : null
      }
    />
  );
}

interface PresentLeaderboardProps {
  status: "announcing" | "done";
  rows: LeaderboardEntry[];
  contestantById: Map<string, Contestant>;
  announcerDisplayName?: string;
  titleAnnouncing: string;
  titleDone: string;
  announcerLabel: string;
  /** Empty string when there's no position info to show. */
  positionLabel: string;
  /**
   * Pre-resolved copy for the "Up next" card. Null suppresses the card
   * entirely (e.g. status=done, or caller didn't pass announcement data).
   * `hasReveal=false` renders the queue-exhausted variant.
   */
  pendingReveal:
    | {
        upNext: string;
        detail: string;
        flagEmoji: string;
        hasReveal: boolean;
      }
    | null;
}

/**
 * Inner component for the announcing+done leaderboard so the FLIP
 * useLayoutEffect lives at a single hook scope rather than buried
 * behind status branches in the parent. Hooks-of-the-day rule of
 * thumb: don't put hooks behind early returns.
 *
 * Rank-shift animation per SPEC §10.3 — when `rows` re-renders with
 * different ordering, each row that moved gets `animate-rank-shift`
 * with `--shift-from` set to (oldTop - newTop) so it slides from its
 * previous visual position to its new one. Reuses the FLIP pattern
 * shipped in `<LeaderboardCeremony>`. First render captures initial
 * rects without animating — only diffs on subsequent renders fire.
 */
function PresentLeaderboard({
  status,
  rows,
  contestantById,
  announcerDisplayName,
  titleAnnouncing,
  titleDone,
  announcerLabel,
  positionLabel,
  pendingReveal,
}: PresentLeaderboardProps) {
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const newRects = new Map<string, DOMRect>();
    for (const [id, el] of rowRefs.current) {
      newRects.set(id, el.getBoundingClientRect());
    }
    for (const [id, oldRect] of prevRectsRef.current) {
      const newRect = newRects.get(id);
      const el = rowRefs.current.get(id);
      if (!newRect || !el) continue;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dy) < 0.5) continue;
      el.style.setProperty("--shift-from", `${dy}px`);
      el.classList.remove("motion-safe:animate-rank-shift");
      // Force reflow so re-adding the class restarts the animation.
      void el.offsetHeight;
      el.classList.add("motion-safe:animate-rank-shift");
    }
    prevRectsRef.current = newRects;
  }, [rows]);

  return (
    <main
      data-testid="present-screen"
      data-status={status}
      className="flex min-h-screen flex-col px-8 py-8 sm:px-12"
    >
      <header className="mb-6 flex items-baseline justify-between gap-6">
        <h1 className="text-4xl font-bold tracking-tight">
          {status === "done" ? titleDone : titleAnnouncing}
        </h1>
        <div className="flex flex-col items-end gap-1">
          {announcerDisplayName && status === "announcing" ? (
            <p className="text-2xl text-muted-foreground">{announcerLabel}</p>
          ) : null}
          {positionLabel ? (
            <p
              data-testid="present-announcer-position"
              className="text-lg uppercase tracking-[0.3em] text-muted-foreground"
            >
              {positionLabel}
            </p>
          ) : null}
        </div>
      </header>
      {pendingReveal ? (
        <section
          data-testid="present-pending-reveal"
          data-has-reveal={pendingReveal.hasReveal ? "true" : "false"}
          className="mb-6 flex items-center gap-6 rounded-2xl border border-primary/40 bg-primary/10 px-8 py-5"
          aria-live="polite"
        >
          <span className="text-xs uppercase tracking-[0.4em] text-primary">
            {pendingReveal.upNext}
          </span>
          {pendingReveal.hasReveal ? (
            <span className="flex items-center gap-4 text-3xl font-semibold">
              <span className="text-5xl" aria-hidden>
                {pendingReveal.flagEmoji}
              </span>
              <span>{pendingReveal.detail}</span>
            </span>
          ) : (
            <span className="text-2xl text-muted-foreground">
              {pendingReveal.detail}
            </span>
          )}
        </section>
      ) : null}
      <ol className="flex-1 space-y-2 overflow-hidden">
        {rows.map((row) => {
          const c = contestantById.get(row.contestantId);
          const medal = RANK_MEDAL[row.rank];
          return (
            <li
              key={row.contestantId}
              ref={(el) => {
                if (el) rowRefs.current.set(row.contestantId, el);
                else rowRefs.current.delete(row.contestantId);
              }}
              data-testid={`present-row-${row.contestantId}`}
              className="flex items-center justify-between gap-6 rounded-xl border border-border bg-card px-6 py-4"
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
