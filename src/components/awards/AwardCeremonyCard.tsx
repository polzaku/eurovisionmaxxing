"use client";

import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";
import type { CeremonyCard } from "@/lib/awards/awardCeremonySequence";
import { explainerForAward } from "@/lib/awards/awardExplainers";

interface AwardCeremonyCardProps {
  card: CeremonyCard;
}

/**
 * Single-card cinematic presentation for the SPEC §11.3 reveal sequence.
 * Larger and louder than the static card on `/results/[id]` — bigger flag /
 * avatar, explainer always inline (no `<details>` collapse), centered layout.
 */
export default function AwardCeremonyCard({ card }: AwardCeremonyCardProps) {
  const t = useTranslations();
  const explainer = explainerForAward(card.award.awardKey);

  if (card.kind === "contestant") {
    return (
      <div className="flex flex-col items-center text-center gap-4 motion-safe:animate-fade-in">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {card.award.awardName}
        </p>
        <span className="text-7xl" aria-hidden>
          {card.contestant?.flagEmoji ?? "🏆"}
        </span>
        <p className="text-3xl font-bold">
          {card.contestant?.country ?? card.award.winnerContestantId ?? ""}
        </p>
        {card.award.statLabel ? (
          <p className="text-sm text-muted-foreground">{card.award.statLabel}</p>
        ) : null}
      </div>
    );
  }

  if (card.kind === "personal-neighbour") {
    return (
      <div className="flex flex-col items-center text-center gap-4 motion-safe:animate-fade-in">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {card.award.awardName}
        </p>
        <div className="flex -space-x-3">
          <Avatar
            seed={card.viewerUser.avatarSeed}
            size={88}
            className="ring-4 ring-background"
          />
          <Avatar
            seed={card.neighbourUser.avatarSeed}
            size={88}
            className="ring-4 ring-background"
          />
        </div>
        <p className="text-2xl font-bold">
          You &amp; {card.neighbourUser.displayName}
        </p>
        <p className="text-sm text-muted-foreground italic">
          {t("awards.your_neighbour.caption")}
        </p>
        {card.isReciprocal ? (
          <p className="inline-flex items-center rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
            {t("awards.your_neighbour.reciprocalBadge")}
          </p>
        ) : null}
        {explainer ? (
          <p className="max-w-prose text-sm text-muted-foreground leading-relaxed">
            {explainer}
          </p>
        ) : null}
        {card.award.statLabel ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {card.award.statLabel}
          </p>
        ) : null}
      </div>
    );
  }

  const captionKey =
    card.award.awardKey === "neighbourhood_voters"
      ? "awards.neighbourhoodCaption"
      : card.partner
        ? "awards.jointCaption"
        : null;

  return (
    <div className="flex flex-col items-center text-center gap-4 motion-safe:animate-fade-in">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {card.award.awardName}
      </p>
      <div className="flex -space-x-3">
        {card.winner ? (
          <Avatar
            seed={card.winner.avatarSeed}
            size={88}
            className="ring-4 ring-background"
          />
        ) : null}
        {card.partner ? (
          <Avatar
            seed={card.partner.avatarSeed}
            size={88}
            className="ring-4 ring-background"
          />
        ) : null}
      </div>
      <p className="text-2xl font-bold">
        {card.winner?.displayName ?? "—"}
        {card.partner ? ` & ${card.partner.displayName}` : ""}
      </p>
      {captionKey ? (
        <p className="text-sm text-muted-foreground italic">{t(captionKey)}</p>
      ) : null}
      {explainer ? (
        <p className="max-w-prose text-sm text-muted-foreground leading-relaxed">
          {explainer}
        </p>
      ) : null}
      {card.award.statLabel ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {card.award.statLabel}
        </p>
      ) : null}
    </div>
  );
}
