import { getTranslations } from "next-intl/server";
import type { ResultsData } from "@/lib/results/loadResults";
import type { Contestant } from "@/types";
import { formatRoomSummary } from "@/lib/results/formatRoomSummary";
import CopySummaryButton from "./CopySummaryButton";
import AwardsSection from "@/components/results/AwardsSection";
import HotTakesSection from "@/components/results/HotTakesSection";
import LeaderboardWithDrillDown from "@/components/results/LeaderboardWithDrillDown";

export async function DoneBody({
  data,
  roomId,
}: {
  data: Extract<ResultsData, { status: "done" }>;
  roomId: string;
}) {
  const t = await getTranslations("results");
  const tAwards = await getTranslations("awards");

  const shareUrl =
    (process.env.NEXT_PUBLIC_APP_URL ?? "https://eurovisionmaxxing.com") +
    `/results/${roomId}`;

  const summary = formatRoomSummary({
    year: data.year,
    event: data.event,
    leaderboard: data.leaderboard,
    contestants: data.contestants,
    shareUrl,
    labels: {
      eventTitle: (year, event) => t(`eventTitle.${event}`, { year }),
      topLine: t("summary.topLine"),
      fullResults: t("summary.fullResults"),
    },
  });

  return (
    <>
      <div className="flex justify-end">
        <CopySummaryButton
          summary={summary}
          labels={{ idle: t("copySummary.idle"), done: t("copySummary.done") }}
        />
      </div>
      <LeaderboardWithDrillDown
        leaderboard={data.leaderboard}
        contestants={data.contestants}
        contestantBreakdowns={data.contestantBreakdowns}
        labels={{
          title: t("headings.leaderboard"),
          drillDownHeading: t("leaderboard.drillDownHeading"),
          drillDownEmpty: t("leaderboard.drillDownEmpty"),
          toggleAria: (country: string) =>
            t("leaderboard.drillDownToggleAria", { country }),
          formatGivePoints: (points: number) =>
            t("leaderboard.drillDownGive", { points }),
        }}
      />
      {data.awards.length > 0 ? (
        <AwardsSection
          awards={data.awards}
          contestants={data.contestants}
          members={data.members}
          personalNeighbours={data.personalNeighbours}
          labels={{
            sectionHeading: t("headings.awards"),
            categoryHeading: t("headings.categoryAwards"),
            personalityHeading: t("headings.personalityAwards"),
            jointCaption: tAwards("jointCaption"),
            neighbourhoodCaption: tAwards("neighbourhoodCaption"),
          }}
        />
      ) : null}
      {data.breakdowns.length > 0 ? (
        <Breakdowns
          title={t("headings.breakdowns")}
          breakdowns={data.breakdowns}
          contestants={data.contestants}
        />
      ) : null}
      {data.hotTakes.length > 0 ? (
        <HotTakesSection
          title={t("headings.hotTakes")}
          editedLabel={t("hotTake.edited")}
          hotTakes={data.hotTakes}
          contestants={data.contestants}
          roomId={roomId}
          ownerUserId={data.ownerUserId}
        />
      ) : null}
    </>
  );
}

function Breakdowns({
  title,
  breakdowns,
  contestants,
}: {
  title: string;
  breakdowns: Extract<ResultsData, { status: "done" }>["breakdowns"];
  contestants: Contestant[];
}) {
  const lookup = new Map<string, Contestant>(contestants.map((c) => [c.id, c]));
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-3">
        {breakdowns.map((b) => (
          <details
            key={b.userId}
            className="rounded-xl border-2 border-border overflow-hidden"
          >
            <summary className="px-4 py-3 cursor-pointer list-none font-medium flex items-center justify-between">
              <span>{b.displayName}</span>
              <span className="text-sm text-muted-foreground">
                {b.picks.length} picks
              </span>
            </summary>
            <ul className="border-t border-border divide-y divide-border">
              {b.picks.map((p) => {
                const c = lookup.get(p.contestantId);
                return (
                  <li
                    key={p.contestantId}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{c?.flagEmoji ?? "🏳️"}</span>
                      <span>{c?.country ?? p.contestantId}</span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {p.pointsAwarded}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
