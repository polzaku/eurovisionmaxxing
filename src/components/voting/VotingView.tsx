"use client";

import { useMemo, useState, useCallback } from "react";
import type { Contestant, VotingCategory } from "@/types";
import { SCORE_ANCHORS } from "@/types";
import { useEffect } from "react";
import Button from "@/components/ui/Button";
import ScoreRow from "@/components/voting/ScoreRow";
import MissedCard from "@/components/voting/MissedCard";
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
  const categoryNames = categories.map((c) => c.name);
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
  const projected: ProjectedAverage = useMemo(
    () =>
      computeProjectedAverage(
        scoresByContestant,
        missedByContestant,
        categories
      ),
    [scoresByContestant, missedByContestant, categories]
  );

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      <OfflineBanner visible={offlineBannerVisible ?? false} />
      <QueueOverflowBanner visible={queueOverflow ?? false} />
      <DrainNotice
        notice={drainNotice ?? null}
        onDismiss={onDismissDrainNotice ?? (() => {})}
      />
      <div className="w-full max-w-xl space-y-6 animate-fade-in">
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

        <p className="text-xs text-muted-foreground text-center">
          Scale: <span className="font-medium">1</span> {SCORE_ANCHORS[1].split(".")[0]} ·{" "}
          <span className="font-medium">5</span> {SCORE_ANCHORS[5].split(".")[0]} ·{" "}
          <span className="font-medium">10</span> {SCORE_ANCHORS[10].split(".")[0]}
        </p>

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
                value={scoresByContestant[contestant.id]?.[cat.name] ?? null}
                weightMultiplier={nonUniformWeights ? cat.weight : undefined}
                onChange={(next) => updateScore(contestant.id, cat.name, next)}
              />
            ))}
          </div>
        )}

        <nav className="grid grid-cols-3 gap-3 pt-4">
          <Button
            variant="secondary"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={!canPrev}
            aria-label="Previous contestant"
          >
            ← Prev
          </Button>
          <Button
            variant="ghost"
            onClick={() => setMissed(contestant.id, true)}
            disabled={isMissed}
            aria-label="Mark this contestant as missed"
          >
            I missed this
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIdx((i) => Math.min(totalContestants - 1, i + 1))}
            disabled={!canNext}
            aria-label="Next contestant"
          >
            Next →
          </Button>
        </nav>
      </div>
    </main>
  );
}
