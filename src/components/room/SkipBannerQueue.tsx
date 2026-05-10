"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

export interface SkipEvent {
  /** Stable id for the event. */
  id: string;
  userId: string;
  displayName: string;
  /** Arrival timestamp in ms (Date.now()). */
  at: number;
}

const PER_BANNER_MS = 3_000;
const COALESCE_WINDOW_MS = 2_000;
const COALESCE_THRESHOLD = 3; // > this many within window → coalesce

interface SkipBannerQueueProps {
  events: SkipEvent[];
}

/**
 * SPEC §10.2.1 — renders incoming announce_skip events as a sequential
 * banner train (3 s per event). When >3 events arrive within a 2 s
 * window, the queue coalesces into a single banner ("4 skipped: Alice,
 * Bob, Carol +1") to avoid a 9+ second train.
 *
 * Parent owns the events array — typically appending one entry per
 * announce_skip broadcast. The component reads from the array and
 * advances internally; the parent does not mutate on dismissal.
 */
export default function SkipBannerQueue({ events }: SkipBannerQueueProps) {
  const t = useTranslations();
  const [head, setHead] = useState(0);

  const burst = useMemo(() => {
    if (head >= events.length) return null;
    const start = events[head];
    const window: SkipEvent[] = [];
    for (let i = head; i < events.length; i += 1) {
      if (events[i].at - start.at <= COALESCE_WINDOW_MS) window.push(events[i]);
      else break;
    }
    return window.length > COALESCE_THRESHOLD ? window : null;
  }, [events, head]);

  useEffect(() => {
    if (head >= events.length) return undefined;
    const advance = burst ? burst.length : 1;
    const timer = globalThis.setTimeout(() => {
      setHead((h) => h + advance);
    }, PER_BANNER_MS);
    return () => globalThis.clearTimeout(timer);
  }, [head, events, burst]);

  if (head >= events.length) return null;

  if (burst) {
    const visibleNames = burst.slice(0, COALESCE_THRESHOLD).map((e) => e.displayName);
    const remaining = burst.length - COALESCE_THRESHOLD;
    const trailing =
      remaining > 0
        ? ` ${t("announce.skipBanner.coalescedTrailing", { remaining })}`
        : "";
    return (
      <div role="status" className="emx-skip-banner emx-skip-banner--coalesced">
        {t("announce.skipBanner.coalesced", {
          count: burst.length,
          names: visibleNames.join(", "),
        })}
        {trailing}
      </div>
    );
  }

  const current = events[head];
  return (
    <div role="status" className="emx-skip-banner">
      {t("announce.skipBanner.single", { name: current.displayName })}
    </div>
  );
}
