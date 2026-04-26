import Avatar from "@/components/ui/Avatar";
import type { Contestant, RoomAward } from "@/types";

interface MemberView {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

interface AwardsSectionProps {
  awards: RoomAward[];
  contestants: Contestant[];
  members: MemberView[];
  labels: {
    sectionHeading: string;
    categoryHeading: string;
    personalityHeading: string;
    jointCaption: string;
    neighbourhoodCaption: string;
  };
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
  labels,
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
              if (a.winnerContestantId) {
                return (
                  <li key={a.awardKey}>
                    <ContestantAwardCard
                      award={a}
                      contestant={contestantById.get(a.winnerContestantId)}
                    />
                  </li>
                );
              }
              const winner = a.winnerUserId
                ? memberById.get(a.winnerUserId)
                : undefined;
              const partner = a.winnerUserIdB
                ? memberById.get(a.winnerUserIdB)
                : undefined;
              return (
                <li key={a.awardKey}>
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
                </li>
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
}: {
  award: RoomAward;
  contestant: Contestant | undefined;
}) {
  return (
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3 flex items-center gap-3">
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
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3 flex items-center gap-3">
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
  );
}
