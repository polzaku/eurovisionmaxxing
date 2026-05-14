"use client";

import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";
import type { CeremonyCard } from "@/lib/awards/awardCeremonySequence";
import {
  localizedAwardName,
  localizedAwardStat,
  localizedAwardExplainer,
} from "@/lib/awards/localizedAwardCopy";

interface AwardCeremonyCardProps {
  card: CeremonyCard;
}

/**
 * Single-card cinematic presentation for the SPEC §11.3 reveal sequence.
 * Larger and louder than the static card on `/results/[id]` — bigger flag /
 * avatar, explainer always inline (no `<details>` collapse), centered layout.
 *
 * Names, stats and explainers route through `t()` so non-English locales
 * render translated copy rather than the English `room_awards.awardName`
 * stored by the server.
 */
export default function AwardCeremonyCard({ card }: AwardCeremonyCardProps) {
  const t = useTranslations();
  const awardName = localizedAwardName(
    t,
    card.award.awardKey,
    card.award.awardName,
  );
  const stat = localizedAwardStat(
    t,
    card.award.awardKey,
    card.award.statValue,
    card.award.statLabel,
  );
  const explainer = localizedAwardExplainer(t, card.award.awardKey);

  if (card.kind === "overall-winner") {
    return (
      <div className="flex flex-col items-center text-center gap-4 motion-safe:animate-fade-in">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          {t("awards.overall_winner.name")}
        </p>
        <span className="text-8xl" aria-hidden>
          {card.contestant.flagEmoji}
        </span>
        <p className="text-4xl font-extrabold">{card.contestant.country}</p>
        <p className="text-sm text-muted-foreground italic">
          {t("awards.overall_winner.caption")}
        </p>
        <p className="text-sm font-semibold text-primary tabular-nums">
          {t("awards.overall_winner.stat", { points: card.totalPoints })}
        </p>
      </div>
    );
  }

  if (card.kind === "contestant") {
    return (
      <div className="flex flex-col items-center text-center gap-4 motion-safe:animate-fade-in">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {awardName}
        </p>
        <span className="text-7xl" aria-hidden>
          {card.contestant?.flagEmoji ?? "🏆"}
        </span>
        <p className="text-3xl font-bold">
          {card.contestant?.country ?? card.award.winnerContestantId ?? ""}
        </p>
        {stat ? (
          <p className="text-sm text-muted-foreground">{stat}</p>
        ) : null}
      </div>
    );
  }

  if (card.kind === "personal-neighbour") {
    return (
      <div className="flex flex-col items-center text-center gap-4 motion-safe:animate-fade-in">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {awardName}
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
          {t("awards.youAnd", { name: card.neighbourUser.displayName })}
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
        {stat ? (
          <p className="text-xs text-muted-foreground tabular-nums">{stat}</p>
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
        {awardName}
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
        {card.partner
          ? `${t("awards.jointSeparator")}${card.partner.displayName}`
          : ""}
      </p>
      {captionKey ? (
        <p className="text-sm text-muted-foreground italic">{t(captionKey)}</p>
      ) : null}
      {explainer ? (
        <p className="max-w-prose text-sm text-muted-foreground leading-relaxed">
          {explainer}
        </p>
      ) : null}
      {stat ? (
        <p className="text-xs text-muted-foreground tabular-nums">{stat}</p>
      ) : null}
    </div>
  );
}
