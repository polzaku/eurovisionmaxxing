"use client";

import { useEffect } from "react";
import type { Contestant } from "@/types";

interface TwelvePointSplashProps {
  contestant: Contestant;
  /** 'fullscreen' for /present TV; 'card' for announcer phone post-tap. */
  size: "fullscreen" | "card";
  /** Optional callback fired after dismissAfterMs (default 3000). */
  onDismiss?: () => void;
  dismissAfterMs?: number;
}

/**
 * SPEC §10.2.2 — large country flag emoji + country name + artist + song
 * splash shown when the announcer reveals their 12-point pick. Same
 * content on /present (fullscreen variant) and the announcer's phone
 * (card variant, scaled down).
 */
export default function TwelvePointSplash({
  contestant,
  size,
  onDismiss,
  dismissAfterMs = 3000,
}: TwelvePointSplashProps) {
  useEffect(() => {
    if (!onDismiss) return;
    const timer = setTimeout(onDismiss, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [onDismiss, dismissAfterMs]);

  const isFullscreen = size === "fullscreen";

  return (
    <div
      data-testid="twelve-point-splash"
      data-size={size}
      className={`flex flex-col items-center justify-center motion-safe:animate-fade-in ${
        isFullscreen
          ? "w-full px-12 py-12 text-center"
          : "w-full rounded-2xl border-2 border-primary bg-primary/10 px-6 py-8 text-center"
      }`}
    >
      <span
        aria-hidden
        className={isFullscreen ? "text-[20vw] leading-none" : "text-7xl"}
      >
        {contestant.flagEmoji}
      </span>
      <p
        className={`mt-4 font-extrabold ${
          isFullscreen ? "text-[8vw] leading-tight" : "text-4xl"
        }`}
      >
        {contestant.country}
      </p>
      {contestant.artist ? (
        <p
          className={`mt-3 font-semibold ${
            isFullscreen ? "text-[3vw]" : "text-xl"
          }`}
        >
          {contestant.artist}
        </p>
      ) : null}
      {contestant.song ? (
        <p
          className={`mt-1 italic text-muted-foreground ${
            isFullscreen ? "text-[2.5vw]" : "text-lg"
          }`}
        >
          {contestant.song}
        </p>
      ) : null}
    </div>
  );
}
