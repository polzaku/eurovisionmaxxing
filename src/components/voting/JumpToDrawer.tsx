"use client";

import { useEffect, useRef } from "react";
import type { Contestant } from "@/types";
import {
  summarizeContestantStatus,
  type ContestantStatus,
} from "@/lib/voting/contestantStatus";
import ScoredByChip from "@/components/voting/ScoredByChip";

export interface JumpToDrawerProps {
  isOpen: boolean;
  contestants: Contestant[];
  currentContestantId: string;
  scoresByContestant: Record<string, Record<string, number | null>>;
  missedByContestant: Record<string, boolean>;
  categoryNames: readonly string[];
  onSelect: (contestantId: string) => void;
  onClose: () => void;
  /** SPEC §8.8 — fully-scored counts per contestantId. */
  scoredByCounts?: Record<string, number>;
  /** Total room members. When undefined or 0, the chip is suppressed. */
  roomMemberTotal?: number;
}

const STATUS_LABEL: Record<ContestantStatus, string> = {
  unscored: "Not scored yet",
  scored: "✓ Scored",
  missed: "👻 Missed",
};

const STATUS_CLASS: Record<ContestantStatus, string> = {
  unscored: "text-muted-foreground",
  scored: "text-primary font-medium",
  missed: "text-muted-foreground italic",
};

export default function JumpToDrawer({
  isOpen,
  contestants,
  currentContestantId,
  scoresByContestant,
  missedByContestant,
  categoryNames,
  onSelect,
  onClose,
  scoredByCounts,
  roomMemberTotal,
}: JumpToDrawerProps) {
  const currentRowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    currentRowRef.current?.scrollIntoView({ block: "center" });
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="jump-to-title">
      <div
        className="fixed inset-0 bg-foreground/40 z-30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-x-0 bottom-0 max-h-[85dvh] z-40 rounded-t-xl border-t border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border sticky top-0 bg-background">
          <h3 id="jump-to-title" className="text-lg font-semibold">
            Jump to contestant
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            ×
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {contestants.map((c) => {
            const status = summarizeContestantStatus(
              c.id,
              scoresByContestant,
              missedByContestant,
              categoryNames
            );
            const isCurrent = c.id === currentContestantId;
            return (
              <li
                key={c.id}
                ref={isCurrent ? currentRowRef : undefined}
                className={isCurrent ? "bg-muted" : ""}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums w-8 flex-shrink-0">
                    {c.runningOrder}.
                  </span>
                  <span className="text-xl flex-shrink-0" aria-hidden="true">
                    {c.flagEmoji}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">
                      {c.country}
                    </span>
                    <span className="block text-xs text-muted-foreground truncate">
                      &ldquo;{c.song}&rdquo;
                    </span>
                  </span>
                  <span
                    className={`text-xs whitespace-nowrap flex-shrink-0 ${STATUS_CLASS[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                  {roomMemberTotal && roomMemberTotal > 0 ? (
                    <ScoredByChip
                      count={scoredByCounts?.[c.id] ?? 0}
                      total={roomMemberTotal}
                      size="sm"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
