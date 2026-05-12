"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";
import { getSession } from "@/lib/session";
import { explainerForAward } from "@/lib/awards/awardExplainers";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

interface MemberView {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

interface YourNeighbourCardProps {
  members: MemberView[];
  personalNeighbours: PersonalNeighbour[];
}

/**
 * SPEC §11.2 V1.1 your_neighbour — per-viewer card on the static
 * `/results/[id]` page. Rendered as an `<li>` inside `<AwardsSection>`
 * directly after the room-wide `neighbourhood_voters` card.
 *
 * Visibility gate (client-side, since `getSession` is localStorage-only):
 * the card renders only when the viewer's session userId matches an
 * entry in `personalNeighbours` AND both that entry's viewer + neighbour
 * resolve against the `members` roster. Strangers and zero-signal
 * members see nothing.
 */
export default function YourNeighbourCard({
  members,
  personalNeighbours,
}: YourNeighbourCardProps) {
  const t = useTranslations();
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);

  useEffect(() => {
    setViewerUserId(getSession()?.userId ?? null);
  }, []);

  if (!viewerUserId) return null;

  const entry = personalNeighbours.find((p) => p.userId === viewerUserId);
  if (!entry) return null;

  const memberById = new Map(members.map((m) => [m.userId, m]));
  const viewer = memberById.get(entry.userId);
  const neighbour = memberById.get(entry.neighbourUserId);
  if (!viewer || !neighbour) return null;

  const explainer = explainerForAward("your_neighbour");
  const statLabel = `Pearson ${entry.pearson.toFixed(2)}`;

  return (
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <Avatar
            seed={viewer.avatarSeed}
            size={36}
            className="ring-2 ring-card"
          />
          <Avatar
            seed={neighbour.avatarSeed}
            size={36}
            className="ring-2 ring-card"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {t("awards.your_neighbour.name")}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {neighbour.displayName} ·{" "}
            <span>{t("awards.your_neighbour.caption")}</span> · {statLabel}
          </p>
        </div>
      </div>
      {entry.isReciprocal ? (
        <p className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
          {t("awards.your_neighbour.reciprocalBadge")}
        </p>
      ) : null}
      {explainer ? (
        <details className="group">
          <summary
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer list-none flex items-center gap-1 select-none"
            data-testid="award-explainer-toggle"
          >
            <span aria-hidden>ⓘ</span>
            <span>{t("awards.explainerToggle")}</span>
          </summary>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            {explainer}
          </p>
        </details>
      ) : null}
    </div>
  );
}
