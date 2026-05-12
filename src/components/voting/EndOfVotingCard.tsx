"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("voting.endOfVoting");
  if (variant.kind === "none") return null;

  if (variant.kind === "guestAllScored") {
    const message = adminDisplayName
      ? t("allScored", { count: variant.total, admin: adminDisplayName })
      : t("allScoredFallback", { count: variant.total });
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
        <p>{t("missedSome", { count: variant.missed.length })}</p>
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
                aria-label={`${t("rescoreCta")} ${c.country}`}
              >
                {t("rescoreCta")}
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
        <p>{t("unscoredCount", { count: variant.unscored.length })}</p>
        <UnscoredJumpList
          contestants={variant.unscored}
          onJumpTo={onJumpTo}
          ctaLabel={t("jumpToCta")}
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
        <p>{t("roomMomentum", { count: variant.unscored.length })}</p>
        <UnscoredJumpList
          contestants={variant.unscored}
          onJumpTo={onJumpTo}
          ctaLabel={t("jumpToCta")}
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
        <p>{t("host.allDone")}</p>
        {onEndVoting && (
          <Button onClick={onEndVoting} className="w-full">
            {t("host.endVotingCta")}
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
        <p>{t("host.mostDone", { ready: variant.ready, total: variant.total })}</p>
        {onEndVoting && (
          <Button
            variant="secondary"
            onClick={onEndVoting}
            className="w-full"
          >
            {t("host.endVotingCta")}
          </Button>
        )}
      </div>
    );
  }

  if (variant.kind === "hostSelfDoneOnlyNoCount") {
    // Degenerate-safe variant per SPEC §8.11.2 "Count semantics" —
    // room-wide completion data unavailable, so we drop the count entirely
    // rather than print misleading "1 of 1 done so far" on a multi-member
    // room.
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="host-self-done-only-no-count"
        className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
      >
        {t("host.selfDoneOnlyNoCount")}
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
      {t("host.selfDoneOnly", { ready: variant.ready, total: variant.total })}
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
