"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface DoneCardProps {
  roomId: string;
  /**
   * Seconds before the auto-redirect fires. Default 30.
   * Pass `null` to disable auto-redirect entirely (e.g. for tests / Storybook).
   */
  autoRedirectSeconds?: number | null;
}

const DEFAULT_REDIRECT_SECONDS = 10;
const TICK_MS = 1000;

/**
 * Reusable "Show's over → See full results" card. Shared between the
 * room page (rendered when `room.status === 'done'`) and the announcer
 * who just tapped the final reveal (rendered immediately by AnnouncingView
 * via `finishedLocal` state, ahead of the broadcast roundtrip).
 *
 * Auto-redirects to /results/{roomId} after `autoRedirectSeconds` seconds
 * (default 30). The user can tap the primary CTA to go now, or cancel the
 * countdown to stay on the room page.
 */
export default function DoneCard({
  roomId,
  autoRedirectSeconds = DEFAULT_REDIRECT_SECONDS,
}: DoneCardProps) {
  const router = useRouter();
  const initialSeconds = autoRedirectSeconds ?? 0;
  const [secondsRemaining, setSecondsRemaining] = useState(initialSeconds);
  const [cancelled, setCancelled] = useState(autoRedirectSeconds === null);

  useEffect(() => {
    if (cancelled || autoRedirectSeconds === null) return;
    if (secondsRemaining <= 0) {
      router.push(`/results/${roomId}`);
      return;
    }
    const id = setTimeout(
      () => setSecondsRemaining((s) => s - 1),
      TICK_MS,
    );
    return () => clearTimeout(id);
  }, [secondsRemaining, cancelled, autoRedirectSeconds, router, roomId]);

  const showCountdown =
    !cancelled && autoRedirectSeconds !== null && secondsRemaining > 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="max-w-md w-full space-y-6 motion-safe:animate-fade-in text-center">
        <h1 className="text-3xl font-extrabold tracking-tight emx-wordmark">
          Show&rsquo;s over
        </h1>
        <p className="text-base text-muted-foreground">
          Every score has been revealed. Time for the final picture.
        </p>
        <Link
          href={`/results/${roomId}`}
          className="block rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all hover:scale-[1.02] hover:emx-glow-gold active:scale-[0.98]"
        >
          See full results
        </Link>
        {showCountdown ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Showing the leaderboard in {secondsRemaining}s.
            </p>
            <button
              type="button"
              onClick={() => setCancelled(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Stay here
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
