"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatCountdown } from "@/lib/lobby/formatCountdown";

interface LobbyCountdownProps {
  /** ISO 8601 UTC timestamp of broadcast start. Null suppresses the
   * countdown and renders the fallback copy ("Ready whenever you are."). */
  broadcastStartUtc: string | null;
}

const TICK_MS = 1000;

/**
 * SPEC §6.6.1 — live ticking countdown shown in the lobby. DD:HH:MM:SS
 * when delta > 24h, HH:MM:SS in the final 24h, fallback copy when the
 * target is null or in the past.
 */
export default function LobbyCountdown({
  broadcastStartUtc,
}: LobbyCountdownProps) {
  const t = useTranslations();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!broadcastStartUtc) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [broadcastStartUtc]);

  const targetMs = broadcastStartUtc
    ? new Date(broadcastStartUtc).getTime()
    : null;
  const formatted =
    targetMs !== null && !Number.isNaN(targetMs)
      ? formatCountdown(targetMs, now)
      : null;

  if (formatted === null) {
    return (
      <section
        data-testid="lobby-countdown"
        data-state="fallback"
        className="text-center"
      >
        <p className="text-sm text-muted-foreground">
          {t("lobby.countdown.fallback")}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="lobby-countdown"
      data-state="ticking"
      className="text-center space-y-1"
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("lobby.countdown.label")}
      </p>
      <p
        className="font-mono text-3xl font-bold tabular-nums tracking-wider"
        aria-live="polite"
      >
        {formatted}
      </p>
    </section>
  );
}
