"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { leaderboardSequence } from "@/lib/instant/leaderboardSequence";
import {
  hasRevealed,
  markRevealed,
} from "@/lib/instant/sessionRevealedFlag";
import { useStaggeredReveal } from "@/components/instant/useStaggeredReveal";
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

const STAGGER_MS = 250;
const POST_SETTLE_PAUSE_MS = 3000;
const POST_SETTLE_PAUSE_MS_REDUCED = 1000;

interface LeaderboardCeremonyProps {
  roomId: string;
  /**
   * When provided, the parent owns post-settle UX: this component suppresses
   * the auto-redirect-to-results timer and the Stay-here / See-full-results
   * footer, and instead fires `onAfterSettle` once when the ceremony settles
   * (or immediately if the sessionStorage replay-skip flag is already set).
   * Used by `<DoneCeremony>` to chain into the awards reveal (Phase 6.2).
   */
  onAfterSettle?: () => void;
}

interface FetchedData {
  leaderboard: LeaderboardEntry[];
  contestants: Contestant[];
}

export default function LeaderboardCeremony({ roomId, onAfterSettle }: LeaderboardCeremonyProps) {
  const router = useRouter();
  const t = useTranslations();

  const [data, setData] = useState<FetchedData | null>(null);
  const [skipReplay] = useState(() => hasRevealed(roomId));
  const [stayedHere, setStayedHere] = useState(false);

  // Detect reduced motion once on mount.
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Fetch /api/results/{id}.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/results/${encodeURIComponent(roomId)}`);
        if (!res.ok) return;
        const body = await res.json();
        // Body is the discriminated ResultsData — only `done` shape has leaderboard.
        if (cancelled) return;
        if (body.status === "done") {
          setData({ leaderboard: body.leaderboard, contestants: body.contestants });
        }
      } catch {
        /* ignore — render fallback in body */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const sequence = useMemo(() => {
    if (!data) return null;
    return leaderboardSequence(data.leaderboard, data.contestants);
  }, [data]);

  // When ceremony is suppressed (replay-skip OR reduced-motion OR no data yet),
  // we still want to drive the hook to immediately fire onComplete so the
  // post-settle pause + redirect happen.
  const animationEnabled =
    sequence !== null && !skipReplay && !prefersReducedMotion;
  const totalSteps = sequence ? sequence.length - 1 : 0;

  const { currentStep, isComplete } = useStaggeredReveal({
    totalSteps,
    staggerMs: STAGGER_MS,
    enabled: animationEnabled,
  });

  // Once the ceremony is "complete" (settled or skipped), set the flag and
  // start the post-settle redirect timer.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleFiredRef = useRef(false);
  useEffect(() => {
    if (!data) return;
    if (!isComplete) return;
    markRevealed(roomId);

    // Replay-skip + onAfterSettle: parent wants control immediately.
    if (skipReplay && onAfterSettle && !settleFiredRef.current) {
      settleFiredRef.current = true;
      onAfterSettle();
      return;
    }

    if (skipReplay || stayedHere) return;

    const pause = prefersReducedMotion
      ? POST_SETTLE_PAUSE_MS_REDUCED
      : POST_SETTLE_PAUSE_MS;
    redirectTimerRef.current = setTimeout(() => {
      if (onAfterSettle) {
        if (settleFiredRef.current) return;
        settleFiredRef.current = true;
        onAfterSettle();
      } else {
        router.push(`/results/${encodeURIComponent(roomId)}`);
      }
    }, pause);
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, [data, isComplete, skipReplay, stayedHere, prefersReducedMotion, roomId, router, onAfterSettle]);

  const handleStayHere = useCallback(() => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    markRevealed(roomId);
    setStayedHere(true);
  }, [roomId]);

  // Pick the snapshot to render based on currentStep.
  const snapshot = useMemo(() => {
    if (!sequence) return [];
    if (skipReplay) return sequence[sequence.length - 1];
    return sequence[Math.min(currentStep, sequence.length - 1)];
  }, [sequence, skipReplay, currentStep]);

  // FLIP: capture previous DOM positions per contestantId, apply
  // animate-rank-shift transforms after layout.
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    if (!animationEnabled) {
      prevRectsRef.current = new Map();
      return;
    }
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
  }, [snapshot, animationEnabled]);

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p className="text-muted-foreground motion-safe:animate-shimmer">…</p>
      </main>
    );
  }

  const lookup = new Map<string, Contestant>(
    data.contestants.map((c) => [c.id, c]),
  );

  // Rank rendering rule per spec: only when settled (isComplete).
  const showRanks = isComplete || skipReplay;

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-1 text-center">
          <h2 className="text-xl font-semibold">
            {t("instantAnnounce.ceremony.subtitle")}
          </h2>
        </header>

        <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
          {snapshot.map((row) => {
            const c = lookup.get(row.contestantId);
            return (
              <li
                key={row.contestantId}
                ref={(el) => {
                  if (el) rowRefs.current.set(row.contestantId, el);
                  else rowRefs.current.delete(row.contestantId);
                }}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex items-center gap-3">
                  {showRanks && row.rank !== null ? (
                    <span className="tabular-nums text-sm text-muted-foreground w-6 text-right">
                      {row.rank}
                    </span>
                  ) : (
                    <span className="w-6" aria-hidden />
                  )}
                  <span className="text-2xl" aria-hidden>
                    {c?.flagEmoji ?? "🏳️"}
                  </span>
                  <span className="font-medium">
                    {c?.country ?? row.contestantId}
                  </span>
                </span>
                <span className="tabular-nums font-semibold">
                  {row.pointsAwarded > 0 ? row.pointsAwarded : ""}
                </span>
              </li>
            );
          })}
        </ol>

        {(isComplete || skipReplay) && !stayedHere && !onAfterSettle ? (
          <RedirectFooter
            roomId={roomId}
            pauseMs={
              skipReplay
                ? 0
                : prefersReducedMotion
                ? POST_SETTLE_PAUSE_MS_REDUCED
                : POST_SETTLE_PAUSE_MS
            }
            onStayHere={handleStayHere}
            staySkipped={skipReplay}
            labels={{
              redirectingIn: (seconds) =>
                t("instantAnnounce.ceremony.redirectingIn", { seconds }),
              stayHere: t("instantAnnounce.ceremony.stayHere"),
              seeFullResults: t("instantAnnounce.ceremony.seeFullResults"),
            }}
          />
        ) : null}

        {stayedHere && !onAfterSettle ? (
          <a
            href={`/results/${encodeURIComponent(roomId)}`}
            className="block w-full text-center rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {t("instantAnnounce.ceremony.seeFullResults")}
          </a>
        ) : null}
      </div>
    </main>
  );
}

interface RedirectFooterProps {
  roomId: string;
  pauseMs: number;
  staySkipped: boolean;
  onStayHere: () => void;
  labels: {
    redirectingIn: (seconds: number) => string;
    stayHere: string;
    seeFullResults: string;
  };
}

function RedirectFooter({
  roomId,
  pauseMs,
  staySkipped,
  onStayHere,
  labels,
}: RedirectFooterProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    Math.ceil(pauseMs / 1000),
  );

  useEffect(() => {
    if (staySkipped) return;
    if (secondsRemaining <= 0) return;
    const id = setTimeout(() => setSecondsRemaining((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsRemaining, staySkipped]);

  if (staySkipped) {
    return (
      <a
        href={`/results/${encodeURIComponent(roomId)}`}
        className="block w-full text-center rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        {labels.seeFullResults}
      </a>
    );
  }

  return (
    <div className="space-y-2 text-center">
      <p className="text-sm text-muted-foreground tabular-nums">
        {labels.redirectingIn(secondsRemaining)}
      </p>
      <button
        type="button"
        onClick={onStayHere}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        {labels.stayHere}
      </button>
    </div>
  );
}
