"use client";

import { Fragment } from "react";
import Avatar from "@/components/ui/Avatar";
import type { Contestant, RoomAward } from "@/types";
import { explainerForAward } from "@/lib/awards/awardExplainers";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";
import YourNeighbourCard from "./YourNeighbourCard";

interface MemberView {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

interface AwardsSectionProps {
  awards: RoomAward[];
  contestants: Contestant[];
  members: MemberView[];
  /** SPEC §11.2 V1.1 your_neighbour — per-viewer pairings. Omit on pre-V1.1 fixtures. */
  personalNeighbours?: PersonalNeighbour[];
  labels: {
    sectionHeading: string;
    categoryHeading: string;
    personalityHeading: string;
    jointCaption: string;
    neighbourhoodCaption: string;
  };
  /**
   * SPEC §12.6.3 — invoked when the user taps the "Full ranking" link on a
   * category-award card. The link only appears on cards whose awardKey
   * starts with `best_` (the category-award discriminator).
   */
  onOpenCategoryRanking?: (categoryKey: string) => void;
  /** Label for the "Full ranking" button. Required iff onOpenCategoryRanking is supplied. */
  openCategoryRankingLabel?: string;
}

/**
 * Renders the SPEC §11 awards on `/results/[id]`. Two subgroups:
 * - **Best in category** (one card per `room.categories`)
 * - **And the room said…** (8 personality awards in §11.3 reveal order)
 *
 * Pair awards (Neighbourhood voters and 2-way personality ties) render
 * with a dual-avatar layout. Contestant awards (Best <Cat>, The dark horse)
 * use the country flag as the visual anchor.
 *
 * The full cinematic reveal screen on `/room/[id]` is Phase 6.2 — this is
 * the static post-reveal layout for the share page.
 */
export default function AwardsSection({
  awards,
  contestants,
  members,
  personalNeighbours,
  labels,
  onOpenCategoryRanking,
  openCategoryRankingLabel,
}: AwardsSectionProps) {
  if (awards.length === 0) return null;

  const contestantById = new Map(contestants.map((c) => [c.id, c]));
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const category = awards.filter((a) => a.awardKey.startsWith("best_"));
  const personality = awards.filter((a) => !a.awardKey.startsWith("best_"));

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">{labels.sectionHeading}</h2>

      {category.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {labels.categoryHeading}
          </h3>
          <ul className="space-y-2">
            {category.map((a) => (
              <li key={a.awardKey}>
                <ContestantAwardCard
                  award={a}
                  contestant={
                    a.winnerContestantId
                      ? contestantById.get(a.winnerContestantId)
                      : undefined
                  }
                  fullRankingLabel={
                    onOpenCategoryRanking && openCategoryRankingLabel
                      ? openCategoryRankingLabel
                      : undefined
                  }
                  onOpenFullRanking={
                    onOpenCategoryRanking
                      ? () =>
                          onOpenCategoryRanking(
                            a.awardKey.replace(/^best_/, ""),
                          )
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {personality.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {labels.personalityHeading}
          </h3>
          <ul className="space-y-2">
            {personality.map((a) => {
              let node: React.ReactNode;
              if (a.winnerContestantId) {
                node = (
                  <ContestantAwardCard
                    award={a}
                    contestant={contestantById.get(a.winnerContestantId)}
                  />
                );
              } else {
                const winner = a.winnerUserId
                  ? memberById.get(a.winnerUserId)
                  : undefined;
                const partner = a.winnerUserIdB
                  ? memberById.get(a.winnerUserIdB)
                  : undefined;
                node = (
                  <UserAwardCard
                    award={a}
                    winner={winner}
                    partner={partner}
                    captionForKey={
                      a.awardKey === "neighbourhood_voters"
                        ? labels.neighbourhoodCaption
                        : partner
                          ? labels.jointCaption
                          : null
                    }
                  />
                );
              }
              const showYourNeighbour =
                a.awardKey === "neighbourhood_voters" &&
                personalNeighbours !== undefined;
              return (
                <Fragment key={a.awardKey}>
                  <li>{node}</li>
                  {showYourNeighbour ? (
                    <li data-testid="your-neighbour-slot">
                      <YourNeighbourCard
                        members={members}
                        personalNeighbours={personalNeighbours!}
                      />
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ContestantAwardCard({
  award,
  contestant,
  fullRankingLabel,
  onOpenFullRanking,
}: {
  award: RoomAward;
  contestant: Contestant | undefined;
  fullRankingLabel?: string;
  onOpenFullRanking?: () => void;
}) {
  return (
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden>
          {contestant?.flagEmoji ?? "🏆"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{award.awardName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {contestant?.country ?? award.winnerContestantId ?? ""}
            {award.statLabel ? ` · ${award.statLabel}` : ""}
          </p>
        </div>
      </div>
      <AwardExplainer awardKey={award.awardKey} />
      {onOpenFullRanking && fullRankingLabel ? (
        <button
          type="button"
          onClick={onOpenFullRanking}
          className="text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {fullRankingLabel}
        </button>
      ) : null}
    </div>
  );
}

function UserAwardCard({
  award,
  winner,
  partner,
  captionForKey,
}: {
  award: RoomAward;
  winner: MemberView | undefined;
  partner: MemberView | undefined;
  captionForKey: string | null;
}) {
  return (
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {winner ? (
            <Avatar seed={winner.avatarSeed} size={36} className="ring-2 ring-card" />
          ) : null}
          {partner ? (
            <Avatar seed={partner.avatarSeed} size={36} className="ring-2 ring-card" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{award.awardName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {winner?.displayName ?? "—"}
            {partner ? ` & ${partner.displayName}` : ""}
            {captionForKey ? ` · ${captionForKey}` : ""}
            {award.statLabel ? ` · ${award.statLabel}` : ""}
          </p>
        </div>
      </div>
      <AwardExplainer awardKey={award.awardKey} />
    </div>
  );
}

function AwardExplainer({ awardKey }: { awardKey: string }) {
  const explainer = explainerForAward(awardKey);
  if (!explainer) return null;
  return (
    <details className="group">
      <summary
        className="text-xs text-muted-foreground hover:text-foreground cursor-pointer list-none flex items-center gap-1 select-none"
        data-testid="award-explainer-toggle"
      >
        <span aria-hidden>ⓘ</span>
        <span>What does this mean?</span>
      </summary>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
        {explainer}
      </p>
    </details>
  );
}
