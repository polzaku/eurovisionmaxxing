"use client";

import { useMemo, useState, useCallback } from "react";
import type { Contestant, VotingCategory } from "@/types";
import { SCORE_ANCHORS } from "@/types";
import Button from "@/components/ui/Button";
import ScoreRow from "@/components/voting/ScoreRow";
import { scoredCount } from "@/components/voting/scoredCount";

export interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
}

export default function VotingView({
  contestants,
  categories,
}: VotingViewProps) {
  const sortedContestants = useMemo(
    () => [...contestants].sort((a, b) => a.runningOrder - b.runningOrder),
    [contestants]
  );

  const [idx, setIdx] = useState(0);
  const [scoresByContestant, setScoresByContestant] = useState<
    Record<string, Record<string, number | null>>
  >({});

  const updateScore = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      setScoresByContestant((prev) => ({
        ...prev,
        [contestantId]: {
          ...(prev[contestantId] ?? {}),
          [categoryName]: next,
        },
      }));
    },
    []
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

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
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

        <nav className="grid grid-cols-2 gap-4 pt-4">
          <Button
            variant="secondary"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={!canPrev}
            aria-label="Previous contestant"
          >
            ← Prev
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
