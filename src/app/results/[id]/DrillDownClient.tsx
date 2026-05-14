"use client";

import { useReducer } from "react";
import { useTranslations } from "next-intl";
import type { ResultsData } from "@/lib/results/loadResults";
import LeaderboardWithDrillDown from "@/components/results/LeaderboardWithDrillDown";
import AwardsSection from "@/components/results/AwardsSection";
import HotTakesSection from "@/components/results/HotTakesSection";
import Breakdowns from "@/components/results/Breakdowns";
import {
  drillDownReducer,
  type DrillDownState,
} from "@/components/results/drill-down/drillDownState";
import DrillDownSheet from "@/components/results/drill-down/DrillDownSheet";
import ContestantDrillDownBody from "@/components/results/drill-down/ContestantDrillDownBody";
import ParticipantDrillDownBody from "@/components/results/drill-down/ParticipantDrillDownBody";
import CategoryDrillDownBody from "@/components/results/drill-down/CategoryDrillDownBody";

type DonePayload = Extract<ResultsData, { status: "done" }>;

interface DrillDownClientProps {
  data: DonePayload;
  roomId: string;
}

/**
 * SPEC §12.6 — page-level client wrapper that owns the drill-down state
 * machine and mounts the appropriate sheet variant when a trigger fires.
 * The existing /results/[id] page hands its `done` payload to this
 * component, which renders the leaderboard / awards / breakdowns /
 * hot-takes sections plus the conditional sheet on top.
 */
export default function DrillDownClient({
  data,
  roomId,
}: DrillDownClientProps) {
  const tResults = useTranslations("results");
  const tAwards = useTranslations("awards");
  const tDrill = useTranslations("results.drillDown");

  const [state, dispatch] = useReducer(
    drillDownReducer,
    null as DrillDownState,
  );
  const close = () => dispatch({ type: "close" });

  return (
    <>
      <LeaderboardWithDrillDown
        leaderboard={data.leaderboard}
        contestants={data.contestants}
        contestantBreakdowns={data.contestantBreakdowns}
        labels={{
          title: tResults("headings.leaderboard"),
          drillDownHeading: tResults("leaderboard.drillDownHeading"),
          drillDownEmpty: tResults("leaderboard.drillDownEmpty"),
          toggleAria: (country) =>
            tResults("leaderboard.drillDownToggleAria", { country }),
          formatGivePoints: (points) =>
            tResults("leaderboard.drillDownGive", { points }),
        }}
        onOpenFullBreakdown={(contestantId) =>
          dispatch({
            type: "open",
            payload: { kind: "contestant", contestantId },
          })
        }
        openFullBreakdownLabel={tDrill("contestant.openLink")}
      />

      {data.awards.length > 0 ? (
        <AwardsSection
          awards={data.awards}
          contestants={data.contestants}
          members={data.members}
          personalNeighbours={data.personalNeighbours}
          labels={{
            sectionHeading: tResults("headings.awards"),
            categoryHeading: tResults("headings.categoryAwards"),
            personalityHeading: tResults("headings.personalityAwards"),
            jointCaption: tAwards("jointCaption"),
            neighbourhoodCaption: tAwards("neighbourhoodCaption"),
          }}
          onOpenCategoryRanking={(categoryKey) =>
            dispatch({
              type: "open",
              payload: { kind: "category", categoryKey },
            })
          }
          openCategoryRankingLabel={tDrill("category.openLink")}
        />
      ) : null}

      {data.breakdowns.length > 0 ? (
        <Breakdowns
          breakdowns={data.breakdowns}
          contestants={data.contestants}
          labels={{
            title: tResults("headings.breakdowns"),
            picksLabel: (n) => tResults("breakdown.picks", { count: n }),
            openParticipantAria: (name) =>
              tDrill("participant.openAria", { name }),
          }}
          onOpenParticipant={(userId) =>
            dispatch({ type: "open", payload: { kind: "participant", userId } })
          }
        />
      ) : null}

      {data.hotTakes.length > 0 ? (
        <HotTakesSection
          title={tResults("headings.hotTakes")}
          editedLabel={tResults("hotTake.edited")}
          hotTakes={data.hotTakes}
          contestants={data.contestants}
          roomId={roomId}
          ownerUserId={data.ownerUserId}
        />
      ) : null}

      {state?.kind === "contestant" ? (
        <DrillDownSheet
          open
          onClose={close}
          titleId="drill-contestant-title"
          closeAriaLabel={tDrill("common.closeAria")}
        >
          <ContestantDrillDownBody
            contestantId={state.contestantId}
            data={data}
            labels={{
              titleId: "drill-contestant-title",
              title: (country, points) =>
                tDrill("contestant.title", { country, points }),
              meanLabel: tDrill("common.mean"),
              medianLabel: tDrill("common.median"),
              highestLabel: tDrill("common.highest"),
              lowestLabel: tDrill("common.lowest"),
              weightedScoreLabel: (value) =>
                tDrill("common.weightedScore", { value }),
              missedLabel: tDrill("common.missed"),
              editedLabel: tDrill("common.edited"),
              emptyCopy: tDrill("contestant.empty"),
            }}
          />
        </DrillDownSheet>
      ) : null}

      {state?.kind === "participant" ? (
        <DrillDownSheet
          open
          onClose={close}
          titleId="drill-participant-title"
          closeAriaLabel={tDrill("common.closeAria")}
        >
          <ParticipantDrillDownBody
            userId={state.userId}
            data={data}
            labels={{
              titleId: "drill-participant-title",
              title: (name) => tDrill("participant.title", { name }),
              totalAwardedLabel: (points) =>
                tDrill("participant.totalAwarded", { points }),
              hotTakeCountLabel: (count) =>
                tDrill("participant.hotTakeCount", { count }),
              meanLabel: tDrill("common.mean"),
              harshnessLabel: (value) =>
                tDrill("participant.harshness", { value }),
              alignmentLabel: (value) =>
                tDrill("participant.alignment", { value }),
              weightedScoreLabel: (value) =>
                tDrill("common.weightedScore", { value }),
              missedLabel: tDrill("common.missed"),
              editedLabel: tDrill("common.edited"),
              emptyCopy: tDrill("participant.empty"),
            }}
          />
        </DrillDownSheet>
      ) : null}

      {state?.kind === "category" ? (
        <DrillDownSheet
          open
          onClose={close}
          titleId="drill-category-title"
          closeAriaLabel={tDrill("common.closeAria")}
        >
          <CategoryDrillDownBody
            categoryKey={state.categoryKey}
            data={data}
            labels={{
              titleId: "drill-category-title",
              title: (categoryName) =>
                tDrill("category.title", { category: categoryName }),
              meanLabel: (value) => tDrill("category.meanLabel", { value }),
              voterCountLabel: (voted, total) =>
                tDrill("category.voterCount", { voted, total }),
              sparklineAria: (min, median, max) =>
                tDrill("category.sparklineAria", { min, median, max }),
              highestSingleLabel: (value, name) =>
                tDrill("category.highestSingle", { value, name }),
              lowestSingleLabel: (value, name) =>
                tDrill("category.lowestSingle", { value, name }),
              meanOfMeansLabel: (value) =>
                tDrill("category.meanOfMeans", { value }),
              emptyCopy: tDrill("category.empty"),
            }}
          />
        </DrillDownSheet>
      ) : null}
    </>
  );
}
