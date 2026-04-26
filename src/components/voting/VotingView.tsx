"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import type { Contestant, VotingCategory } from "@/types";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import ScaleAnchorsSheet from "@/components/voting/ScaleAnchorsSheet";
import { useHintExpansion } from "@/components/voting/useHintExpansion";
import Button from "@/components/ui/Button";
import ScoreRow from "@/components/voting/ScoreRow";
import MissedCard from "@/components/voting/MissedCard";
import MissedToast from "@/components/voting/MissedToast";
import HotTakeField from "@/components/voting/HotTakeField";
import JumpToDrawer from "@/components/voting/JumpToDrawer";
import { nextIdxFromSwipe } from "@/lib/voting/nextIdxFromSwipe";
import { useMissedUndo } from "@/hooks/useMissedUndo";
import { scoredCount } from "@/components/voting/scoredCount";
import SaveChip, { type DisplaySaveStatus } from "@/components/voting/SaveChip";
import OfflineBanner from "@/components/voting/OfflineBanner";
import DrainNotice from "@/components/voting/DrainNotice";
import QueueOverflowBanner from "@/components/voting/QueueOverflowBanner";
import type { DrainNotice as DrainNoticePayload } from "@/lib/voting/OfflineAdapter";
import {
  computeProjectedAverage,
  type ProjectedAverage,
} from "@/lib/voting/computeProjectedAverage";
import {
  loadVotingPosition,
  saveVotingPosition,
  indexOfContestant,
} from "@/lib/voting/votingPosition";

export interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
  onScoreChange?: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  saveStatus?: DisplaySaveStatus;
  initialScores?: Record<string, Record<string, number | null>>;
  initialMissed?: Record<string, boolean>;
  onMissedChange?: (contestantId: string, missed: boolean) => void;
  initialHotTakes?: Record<string, string>;
  onHotTakeChange?: (contestantId: string, hotTake: string | null) => void;
  /** When both roomId and userId are provided, persists the current contestant in localStorage so reloads land on the same card. */
  roomId?: string;
  userId?: string;
  offlineBannerVisible?: boolean;
  drainNotice?: DrainNoticePayload | null;
  onDismissDrainNotice?: () => void;
  queueOverflow?: boolean;
}

function getPersistentStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function VotingView({
  contestants,
  categories,
  onScoreChange,
  saveStatus,
  initialScores,
  initialMissed,
  onMissedChange,
  initialHotTakes,
  onHotTakeChange,
  roomId,
  userId,
  offlineBannerVisible,
  drainNotice,
  onDismissDrainNotice,
  queueOverflow,
}: VotingViewProps) {
  const sortedContestants = useMemo(
    () => [...contestants].sort((a, b) => a.runningOrder - b.runningOrder),
    [contestants]
  );

  const [idx, setIdx] = useState<number>(() => {
    if (!roomId || !userId) return 0;
    const savedId = loadVotingPosition(getPersistentStorage(), roomId, userId);
    const found = indexOfContestant(sortedContestants, savedId);
    return found >= 0 ? found : 0;
  });

  useEffect(() => {
    if (!roomId || !userId) return;
    const current = sortedContestants[idx];
    if (!current) return;
    saveVotingPosition(getPersistentStorage(), roomId, userId, current.id);
  }, [idx, roomId, userId, sortedContestants]);

  const [scoresByContestant, setScoresByContestant] = useState<
    Record<string, Record<string, number | null>>
  >(() => initialScores ?? {});

  const [missedByContestant, setMissedByContestant] = useState<
    Record<string, boolean>
  >(() => initialMissed ?? {});

  const updateScore = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      setScoresByContestant((prev) => ({
        ...prev,
        [contestantId]: {
          ...(prev[contestantId] ?? {}),
          [categoryName]: next,
        },
      }));
      onScoreChange?.(contestantId, categoryName, next);
    },
    [onScoreChange]
  );

  const setMissed = useCallback(
    (contestantId: string, missed: boolean) => {
      setMissedByContestant((prev) => {
        const next = { ...prev };
        if (missed) next[contestantId] = true;
        else delete next[contestantId];
        return next;
      });
      onMissedChange?.(contestantId, missed);
    },
    [onMissedChange]
  );

  const [hotTakesByContestant, setHotTakesByContestant] = useState<
    Record<string, string>
  >(() => initialHotTakes ?? {});

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [scaleSheetOpen, setScaleSheetOpen] = useState(false);
  const t = useTranslations();
  const swipeStartXRef = useRef<number | null>(null);

  // Hoisted above early-returns to keep the hook call count stable across renders.
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);
  const fallbackContestantId =
    sortedContestants[Math.min(idx, Math.max(0, sortedContestants.length - 1))]?.id ?? "";
  const hintExpansion = useHintExpansion(roomId, fallbackContestantId, categoryNames);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeStartXRef.current = null;
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-swipe]")) {
      swipeStartXRef.current = null;
      return;
    }
    swipeStartXRef.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const startX = swipeStartXRef.current;
      swipeStartXRef.current = null;
      if (startX === null) return;
      const endX = e.changedTouches[0]?.clientX ?? startX;
      const next = nextIdxFromSwipe(idx, sortedContestants.length, endX - startX);
      if (next !== null) {
        hintExpansion.onNavigated();
        setIdx(next);
      }
    },
    [idx, sortedContestants.length, hintExpansion.onNavigated]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const total = sortedContestants.length;
      if (e.key === "ArrowLeft" && idx > 0) {
        hintExpansion.onNavigated();
        setIdx(idx - 1);
        e.preventDefault();
      } else if (e.key === "ArrowRight" && idx < total - 1) {
        hintExpansion.onNavigated();
        setIdx(idx + 1);
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, sortedContestants.length, hintExpansion.onNavigated]);

  const setHotTake = useCallback(
    (contestantId: string, next: string) => {
      setHotTakesByContestant((prev) => {
        const map = { ...prev };
        if (next === "") delete map[contestantId];
        else map[contestantId] = next;
        return map;
      });
      onHotTakeChange?.(contestantId, next === "" ? null : next);
    },
    [onHotTakeChange]
  );

  const undo = useMissedUndo({
    onUndo: useCallback(
      (contestantId: string) => setMissed(contestantId, false),
      [setMissed]
    ),
  });

  const handleMarkMissed = useCallback(
    (contestantId: string) => {
      const nextMissed = { ...missedByContestant, [contestantId]: true };
      const projection = computeProjectedAverage(
        scoresByContestant,
        nextMissed,
        categories
      );
      setMissed(contestantId, true);
      undo.trigger(contestantId, projection.overall);
    },
    [missedByContestant, scoresByContestant, categories, setMissed, undo]
  );

  const projected: ProjectedAverage = useMemo(
    () =>
      computeProjectedAverage(
        scoresByContestant,
        missedByContestant,
        categories
      ),
    [scoresByContestant, missedByContestant, categories]
  );

  if (categories.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p role="alert" className="text-sm text-destructive text-center max-w-md">
          No voting categories configured — ask the host to check the room setup.
        </p>
      </main>
    );
  }
  if (sortedContestants.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p role="alert" className="text-sm text-destructive text-center max-w-md">
          No contestants for this event.
        </p>
      </main>
    );
  }

  const contestant = sortedContestants[Math.min(idx, sortedContestants.length - 1)];
  const totalContestants = sortedContestants.length;
  const fullyScoredCount = sortedContestants.reduce(
    (acc, c) =>
      acc +
      (scoredCount(scoresByContestant[c.id], categoryNames) ===
      categoryNames.length
        ? 1
        : 0),
    0
  );
  const firstWeight = categories[0].weight;
  const nonUniformWeights = categories.some((c) => c.weight !== firstWeight);

  const canPrev = idx > 0;
  const canNext = idx < totalContestants - 1;

  const isMissed = !!missedByContestant[contestant.id];

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      <OfflineBanner visible={offlineBannerVisible ?? false} />
      <QueueOverflowBanner visible={queueOverflow ?? false} />
      <DrainNotice
        notice={drainNotice ?? null}
        onDismiss={onDismissDrainNotice ?? (() => {})}
      />
      <div
        className="w-full max-w-xl space-y-6 animate-fade-in"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-3xl leading-none" aria-hidden="true">
              {contestant.flagEmoji}
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight truncate">
              {contestant.country}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground truncate">
              &ldquo;{contestant.song}&rdquo; — {contestant.artist}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setScaleSheetOpen(true)}
              aria-label={t("voting.scale.openAria")}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground text-xs text-muted-foreground hover:text-foreground hover:border-foreground"
            >
              i
            </button>
            {saveStatus !== undefined && <SaveChip status={saveStatus} />}
            <span className="text-sm font-mono text-muted-foreground tabular-nums">
              {contestant.runningOrder}/{totalContestants}
            </span>
            <progress
              className="w-24 h-1.5 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
              max={totalContestants}
              value={fullyScoredCount}
              aria-label={`${fullyScoredCount} of ${totalContestants} contestants fully scored`}
            />
            <span className="text-xs text-muted-foreground">
              {fullyScoredCount} scored
            </span>
          </div>
        </header>

        {isMissed ? (
          <MissedCard
            projected={projected}
            categories={categories}
            onRescore={() => setMissed(contestant.id, false)}
          />
        ) : (
          <div className="space-y-6">
            {categories.map((cat) => (
              <ScoreRow
                key={cat.name}
                categoryName={cat.name}
                hint={cat.hint}
                hintExpanded={hintExpansion.expandedFor[cat.name]}
                onToggleHint={() => hintExpansion.toggleFor(cat.name)}
                value={scoresByContestant[contestant.id]?.[cat.name] ?? null}
                weightMultiplier={nonUniformWeights ? cat.weight : undefined}
                onChange={(next) => {
                  hintExpansion.onScored();
                  updateScore(contestant.id, cat.name, next);
                }}
              />
            ))}
            {hintExpansion.onboarding && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                {t("voting.hint.onboarding")}
              </p>
            )}
          </div>
        )}

        <HotTakeField
          key={contestant.id}
          value={hotTakesByContestant[contestant.id] ?? ""}
          onChange={(next) => setHotTake(contestant.id, next)}
        />

        <nav className="grid grid-cols-4 gap-2 pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { hintExpansion.onNavigated(); setIdx((i) => Math.max(0, i - 1)); }}
            disabled={!canPrev}
            aria-label="Previous contestant"
            className="flex flex-col items-center gap-0.5 py-2 leading-tight"
          >
            <span aria-hidden="true" className="text-base">←</span>
            <span className="text-[10px]">Prev</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleMarkMissed(contestant.id)}
            disabled={isMissed}
            aria-label="Mark this contestant as missed"
            className="flex flex-col items-center gap-0.5 py-2 leading-tight"
          >
            <span aria-hidden="true" className="text-base">👻</span>
            <span className="text-[10px]">Missed</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Jump to a contestant"
            className="flex flex-col items-center gap-0.5 py-2 leading-tight"
          >
            <span aria-hidden="true" className="text-base">☰</span>
            <span className="text-[10px]">Jump to</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { hintExpansion.onNavigated(); setIdx((i) => Math.min(totalContestants - 1, i + 1)); }}
            disabled={!canNext}
            aria-label="Next contestant"
            className="flex flex-col items-center gap-0.5 py-2 leading-tight"
          >
            <span aria-hidden="true" className="text-base">→</span>
            <span className="text-[10px]">Next</span>
          </Button>
        </nav>

        <JumpToDrawer
          isOpen={isDrawerOpen}
          contestants={sortedContestants}
          currentContestantId={contestant.id}
          scoresByContestant={scoresByContestant}
          missedByContestant={missedByContestant}
          categoryNames={categoryNames}
          onSelect={(id) => {
            const target = sortedContestants.findIndex((c) => c.id === id);
            if (target >= 0) {
              hintExpansion.onNavigated();
              setIdx(target);
            }
            setIsDrawerOpen(false);
          }}
          onClose={() => setIsDrawerOpen(false)}
        />
      </div>
      <MissedToast toast={undo.toast} onUndo={undo.undo} />
      <ScaleAnchorsSheet
        open={scaleSheetOpen}
        onClose={() => setScaleSheetOpen(false)}
      />
    </main>
  );
}
