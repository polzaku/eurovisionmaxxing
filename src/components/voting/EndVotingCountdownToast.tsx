"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/Button";
import { votingEndingTimer } from "@/lib/rooms/votingEndingTimer";

export interface EndVotingCountdownToastProps {
  votingEndsAt: string | null;
  onUndo: () => void;
  /** Called once when the countdown reaches zero. Caller fires POST /score. */
  onElapsed: () => void;
  undoBusy?: boolean;
}

export default function EndVotingCountdownToast({
  votingEndsAt,
  onUndo,
  onElapsed,
  undoBusy = false,
}: EndVotingCountdownToastProps) {
  const t = useTranslations("voting.endVoting.countdown");
  const [, setTick] = useState(0);
  const elapsedFiredRef = useRef(false);

  useEffect(() => {
    if (!votingEndsAt) {
      elapsedFiredRef.current = false;
      return;
    }
    elapsedFiredRef.current = false;
    const id = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, [votingEndsAt]);

  if (!votingEndsAt) return null;
  const { remainingSeconds, expired } = votingEndingTimer({
    votingEndsAt,
    now: new Date(),
  });

  if (expired && !elapsedFiredRef.current) {
    elapsedFiredRef.current = true;
    onElapsed();
  }

  return (
    <div
      role="status"
      data-testid="end-voting-countdown-toast"
      className="fixed top-3 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-lg"
    >
      <span>
        {expired
          ? t("finalising")
          : t("label", { remainingSeconds })}
      </span>
      {!expired ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onUndo}
          disabled={undoBusy}
          aria-label={t("undoAria")}
        >
          {undoBusy ? t("undoBusy") : t("undo")}
        </Button>
      ) : null}
    </div>
  );
}
