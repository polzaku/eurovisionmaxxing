"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { votingEndingTimer } from "@/lib/rooms/votingEndingTimer";

export interface EndingPillProps {
  votingEndsAt: string | null;
}

export default function EndingPill({ votingEndsAt }: EndingPillProps) {
  const t = useTranslations("voting.ending");
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!votingEndsAt) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [votingEndsAt]);

  if (!votingEndsAt) return null;
  const { remainingSeconds, expired } = votingEndingTimer({
    votingEndsAt,
    now: new Date(),
  });

  return (
    <div
      role="status"
      data-testid="ending-pill"
      className="fixed top-3 left-1/2 z-30 -translate-x-1/2 rounded-full bg-accent/15 px-4 py-1.5 text-xs font-medium text-foreground shadow-sm"
    >
      {expired
        ? t("expired")
        : t("countdown", { remainingSeconds })}
    </div>
  );
}
