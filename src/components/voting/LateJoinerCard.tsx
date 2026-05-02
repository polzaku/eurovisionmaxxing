"use client";

export interface LateJoinerCardProps {
  onDismiss: () => void;
}

/**
 * SPEC §6.3.2 — one-time orientation card for users who joined a room
 * mid-show. Visibility is governed by `useLateJoinerVisibility`; this
 * component is purely presentational.
 */
export default function LateJoinerCard({ onDismiss }: LateJoinerCardProps) {
  return (
    <div
      role="status"
      data-testid="late-joiner-card"
      className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground flex items-start gap-3"
    >
      <p className="flex-1">
        You joined mid-show. Catch up by scoring the songs you&rsquo;ve seen —
        skip the rest, or mark them &ldquo;I missed this&rdquo;.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-muted-foreground hover:text-foreground -m-1 p-1 leading-none"
      >
        ×
      </button>
    </div>
  );
}
