"use client";

import type { EndOfVotingCardVariant } from "@/lib/voting/endOfVotingCardVariant";
import Button from "@/components/ui/Button";

export interface EndOfVotingCardProps {
  variant: EndOfVotingCardVariant;
  adminDisplayName?: string;
  onJumpTo: (contestantId: string) => void;
  /**
   * Fired by the host-variant primary CTA — wired to the existing §6.3.1
   * end-voting modal flow. When omitted (e.g. on a guest viewer), no host
   * variant should be requested in the first place; the card defends with
   * a render-nothing fallback.
   */
  onEndVoting?: () => void;
}

export default function EndOfVotingCard({
  variant,
  adminDisplayName,
  onJumpTo,
  onEndVoting,
}: EndOfVotingCardProps) {
  if (variant.kind === "none") return null;

  if (variant.kind === "guestAllScored") {
    const message = adminDisplayName
      ? `✅ All ${variant.total} scored — waiting for ${adminDisplayName} to end voting.`
      : `✅ All ${variant.total} scored — waiting for the host to end voting.`;
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="guest-all-scored"
        className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
      >
        {message}
      </div>
    );
  }

  if (variant.kind === "guestMissedSome") {
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="guest-missed-some"
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
      >
        <p>
          ⚠️ You marked {variant.missed.length} as missed — they&rsquo;ll be
          filled with your average. Tap to rescore any.
        </p>
        <ul className="space-y-2">
          {variant.missed.map((c) => (
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

  if (variant.kind === "guestUnscored") {
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="guest-unscored"
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
      >
        <p>⚠️ {variant.unscored.length} still unscored</p>
        <UnscoredJumpList
          contestants={variant.unscored}
          onJumpTo={onJumpTo}
          ctaLabel="Score now"
        />
      </div>
    );
  }

  if (variant.kind === "guestRoomMomentum") {
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="guest-room-momentum"
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
      >
        <p>
          ⏳ Most of the room has finished — you have {variant.unscored.length}{" "}
          still to score.
        </p>
        <UnscoredJumpList
          contestants={variant.unscored}
          onJumpTo={onJumpTo}
          ctaLabel="Score now"
        />
      </div>
    );
  }

  if (variant.kind === "hostAllDone") {
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="host-all-done"
        className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-foreground space-y-3"
      >
        <p>🎉 Everyone&rsquo;s done — ready to end voting?</p>
        {onEndVoting && (
          <Button onClick={onEndVoting} className="w-full">
            End voting
          </Button>
        )}
      </div>
    );
  }

  if (variant.kind === "hostMostDone") {
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="host-most-done"
        className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
      >
        <p>
          ⏳ {variant.ready} of {variant.total} have finished — give the rest a
          moment, then end voting.
        </p>
        {onEndVoting && (
          <Button
            variant="secondary"
            onClick={onEndVoting}
            className="w-full"
          >
            End voting
          </Button>
        )}
      </div>
    );
  }

  // hostSelfDoneOnly — informational only, no End-voting CTA at this stage
  // (would cut the room off too early per SPEC §8.11.2).
  return (
    <div
      role="status"
      data-testid="end-of-voting-card"
      data-variant="host-self-done-only"
      className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
    >
      ✅ Your vote is in — {variant.ready} of {variant.total} done so far.
    </div>
  );
}

interface UnscoredJumpListProps {
  contestants: Array<{
    id: string;
    country: string;
    flagEmoji: string;
  }>;
  onJumpTo: (contestantId: string) => void;
  ctaLabel: string;
}

function UnscoredJumpList({
  contestants,
  onJumpTo,
  ctaLabel,
}: UnscoredJumpListProps) {
  return (
    <ul className="space-y-2">
      {contestants.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true">{c.flagEmoji}</span>
            <span className="truncate">{c.country}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onJumpTo(c.id)}
            aria-label={`${ctaLabel} ${c.country}`}
          >
            {ctaLabel}
          </Button>
        </li>
      ))}
    </ul>
  );
}
