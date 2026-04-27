"use client";

import type { EndOfVotingState } from "@/lib/voting/endOfVotingState";
import Button from "@/components/ui/Button";

export interface EndOfVotingCardProps {
  state: EndOfVotingState;
  adminDisplayName?: string;
  onJumpTo: (contestantId: string) => void;
}

export default function EndOfVotingCard({
  state,
  adminDisplayName,
  onJumpTo,
}: EndOfVotingCardProps) {
  if (state.kind === "allScored") {
    const message = adminDisplayName
      ? `✅ All ${state.total} scored — waiting for ${adminDisplayName} to end voting.`
      : `✅ All ${state.total} scored — waiting for the host to end voting.`;
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="all-scored"
        className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
      >
        {message}
      </div>
    );
  }

  if (state.kind === "missedSome") {
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="missed-some"
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
      >
        <p>
          ⚠️ You marked {state.missed.length} as missed — they&rsquo;ll be filled
          with your average. Tap to rescore any.
        </p>
        <ul className="space-y-2">
          {state.missed.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span aria-hidden="true">{c.flagEmoji}</span>
                <span className="truncate">{c.country}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onJumpTo(c.id)}
                aria-label={`Rescore ${c.country}`}
              >
                Rescore
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="end-of-voting-card"
      data-variant="unscored"
      className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
    >
      <p>⚠️ {state.unscored.length} still unscored</p>
      <ul className="space-y-2">
        {state.unscored.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span aria-hidden="true">{c.flagEmoji}</span>
              <span className="truncate">{c.country}</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onJumpTo(c.id)}
              aria-label={`Score ${c.country} now`}
            >
              Score now
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
