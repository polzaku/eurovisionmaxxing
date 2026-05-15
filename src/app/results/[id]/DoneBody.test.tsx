// @vitest-environment jsdom
//
// Regression test for the i18n scope leak that rendered
// `RESULTS.RESULTS.HOTTAKE.EDITED` next to edited hot-takes on the
// public results page. The `t` translator on `DoneBody` is scoped to
// the `results` namespace via `getTranslations("results")`, so the
// hot-take edited label must be looked up as `t("hotTake.edited")`,
// not `t("results.hotTake.edited")` (which would resolve to
// `results.results.hotTake.edited` and return the missing-key
// uppercase fallback).
//
// We render `DoneBody` against the *real* next-intl translator + real
// `en.json` so the missing-key fallback is genuinely produced before
// the fix.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { createTranslator } from "use-intl/core";

import en from "@/locales/en.json";
import type { ResultsData } from "@/lib/results/loadResults";
import type { Contestant } from "@/types";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace,
    } as Parameters<typeof createTranslator>[0]),
}));

// We capture the props each subcomponent receives so we can assert the
// *exact* string the page hands them — that's where the scope bug
// surfaces.
const hotTakesSectionSpy = vi.fn();
vi.mock("@/components/results/HotTakesSection", () => ({
  __esModule: true,
  default: (props: unknown) => {
    hotTakesSectionSpy(props);
    return <div data-testid="mock-hot-takes" />;
  },
}));

vi.mock("@/components/results/LeaderboardWithDrillDown", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-leaderboard" />,
}));

vi.mock("@/components/results/AwardsSection", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-awards" />,
}));

vi.mock("@/app/results/[id]/CopySummaryButton", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-copy-summary" />,
}));

import { DoneBody } from "./DoneBody";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";

const CONTESTANT_SE: Contestant = {
  id: "2026-se",
  year: 2026,
  event: "final",
  countryCode: "se",
  country: "Sweden",
  artist: "A",
  song: "S",
  flagEmoji: "🇸🇪",
  runningOrder: 1,
};

function mkDoneData(): Extract<ResultsData, { status: "done" }> {
  return {
    status: "done",
    year: 2026,
    event: "final",
    pin: "123456",
    ownerUserId: "owner-aaaa",
    leaderboard: [
      { contestantId: "2026-se", totalPoints: 12, rank: 1 },
    ],
    contestants: [CONTESTANT_SE],
    breakdowns: [],
    contestantBreakdowns: [],
    hotTakes: [
      {
        userId: "alice-cccc",
        displayName: "Alice",
        avatarSeed: "seed-alice",
        contestantId: "2026-se",
        hotTake: "Best stage of the night.",
        // Non-null timestamp triggers the `(edited)` tag — this is the
        // path the scope bug breaks.
        hotTakeEditedAt: "2026-04-25T08:00:00.000Z",
      },
    ],
    awards: [],
    personalNeighbours: [],
    members: [
      { userId: "alice-cccc", displayName: "Alice", avatarSeed: "seed-alice" },
    ],
    categories: [{ name: "Vocals", weight: 1 }],
    voteDetails: [],
  };
}

describe("DoneBody i18n scope — hot-take edited label", () => {
  beforeEach(() => {
    hotTakesSectionSpy.mockReset();
  });

  it("passes the resolved 'edited' label to HotTakesSection, not the missing-key fallback", async () => {
    const jsx = await DoneBody({ data: mkDoneData(), roomId: ROOM_ID });
    render(<>{jsx}</>);

    expect(hotTakesSectionSpy).toHaveBeenCalledTimes(1);
    const props = hotTakesSectionSpy.mock.calls[0][0] as {
      editedLabel: string;
    };

    // The fix: t("hotTake.edited") resolves to "edited" under the
    // `results` namespace.
    expect(props.editedLabel).toBe("edited");

    // Defence-in-depth: the missing-key fallback that the user reported
    // (`RESULTS.RESULTS.HOTTAKE.EDITED`) starts with the upper-cased
    // namespace. If next-intl ever changes its fallback format, the
    // exact-equals check above still catches it, but this guard makes
    // intent explicit.
    expect(props.editedLabel).not.toMatch(/^[A-Z]+\./);
  });
});
