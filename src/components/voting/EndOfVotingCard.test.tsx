// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import EndOfVotingCard from "./EndOfVotingCard";
import type { Contestant } from "@/types";

const contestant = (id: string, country: string, flag = "🏳️"): Contestant => ({
  id,
  country,
  countryCode: id.slice(-2),
  flagEmoji: flag,
  artist: "A",
  song: "S",
  runningOrder: 1,
  event: "final",
  year: 2026,
});

const ALBANIA = contestant("2026-al", "Albania", "🇦🇱");
const BELGIUM = contestant("2026-be", "Belgium", "🇧🇪");

describe("<EndOfVotingCard>", () => {
  it("renders nothing for the 'none' variant", () => {
    const { container } = render(
      <EndOfVotingCard variant={{ kind: "none" }} onJumpTo={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("guestAllScored — shows key with admin param when provided", () => {
    render(
      <EndOfVotingCard
        variant={{ kind: "guestAllScored", total: 17 }}
        adminDisplayName="Alice"
        onJumpTo={() => {}}
      />,
    );
    const card = screen.getByTestId("end-of-voting-card");
    expect(card).toHaveAttribute("data-variant", "guest-all-scored");
    // With mock: t("allScored", {count:17, admin:"Alice"}) → "allScored:{...}"
    expect(card).toHaveTextContent(/allScored:/);
  });

  it("guestAllScored — uses fallback key when no admin name", () => {
    render(
      <EndOfVotingCard
        variant={{ kind: "guestAllScored", total: 5 }}
        onJumpTo={() => {}}
      />,
    );
    // With mock: t("allScoredFallback", {count:5}) → "allScoredFallback:{...}"
    expect(screen.getByTestId("end-of-voting-card")).toHaveTextContent(
      /allScoredFallback:/,
    );
  });

  it("guestMissedSome — lists each missed contestant with a Rescore CTA", async () => {
    const onJumpTo = vi.fn();
    render(
      <EndOfVotingCard
        variant={{ kind: "guestMissedSome", missed: [ALBANIA, BELGIUM] }}
        onJumpTo={onJumpTo}
      />,
    );
    expect(
      screen.getByTestId("end-of-voting-card"),
    ).toHaveAttribute("data-variant", "guest-missed-some");
    // With mock: t("missedSome", {count:2}) → "missedSome:{...}"
    expect(screen.getByTestId("end-of-voting-card")).toHaveTextContent(/missedSome:/);
    // aria-label is "rescoreCta Albania"
    await userEvent.click(
      screen.getByRole("button", { name: /rescoreCta Albania/i }),
    );
    expect(onJumpTo).toHaveBeenCalledWith(ALBANIA.id);
  });

  it("guestUnscored — lists each unscored contestant with a Score-now CTA", async () => {
    const onJumpTo = vi.fn();
    render(
      <EndOfVotingCard
        variant={{ kind: "guestUnscored", unscored: [BELGIUM] }}
        onJumpTo={onJumpTo}
      />,
    );
    expect(screen.getByTestId("end-of-voting-card")).toHaveAttribute(
      "data-variant",
      "guest-unscored",
    );
    // With mock: t("unscoredCount", {count:1}) → "unscoredCount:{...}"
    expect(screen.getByTestId("end-of-voting-card")).toHaveTextContent(/unscoredCount:/);
    // aria-label is "jumpToCta Belgium"
    await userEvent.click(
      screen.getByRole("button", { name: /jumpToCta Belgium/i }),
    );
    expect(onJumpTo).toHaveBeenCalledWith(BELGIUM.id);
  });

  it("guestRoomMomentum — shows room nudge + jump list", () => {
    render(
      <EndOfVotingCard
        variant={{ kind: "guestRoomMomentum", unscored: [ALBANIA, BELGIUM] }}
        onJumpTo={() => {}}
      />,
    );
    const card = screen.getByTestId("end-of-voting-card");
    expect(card).toHaveAttribute("data-variant", "guest-room-momentum");
    // With mock: t("roomMomentum", {count:2}) → "roomMomentum:{...}"
    expect(card).toHaveTextContent(/roomMomentum:/);
  });

  it("hostAllDone — surfaces a primary End-voting CTA wired to onEndVoting", async () => {
    const onEndVoting = vi.fn();
    render(
      <EndOfVotingCard
        variant={{ kind: "hostAllDone", ready: 4, total: 4 }}
        onJumpTo={() => {}}
        onEndVoting={onEndVoting}
      />,
    );
    const card = screen.getByTestId("end-of-voting-card");
    expect(card).toHaveAttribute("data-variant", "host-all-done");
    // With mock: t("host.allDone") → "host.allDone"
    expect(card).toHaveTextContent("host.allDone");
    // With mock: t("host.endVotingCta") → "host.endVotingCta" (button text)
    await userEvent.click(screen.getByRole("button", { name: /host\.endVotingCta/i }));
    expect(onEndVoting).toHaveBeenCalledTimes(1);
  });

  it("hostAllDone — suppresses the CTA when no onEndVoting is wired", () => {
    render(
      <EndOfVotingCard
        variant={{ kind: "hostAllDone", ready: 4, total: 4 }}
        onJumpTo={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /host\.endVotingCta/i }),
    ).not.toBeInTheDocument();
  });

  it("hostMostDone — shows the ready/total ratio key + secondary End-voting CTA", async () => {
    const onEndVoting = vi.fn();
    render(
      <EndOfVotingCard
        variant={{ kind: "hostMostDone", ready: 3, total: 4 }}
        onJumpTo={() => {}}
        onEndVoting={onEndVoting}
      />,
    );
    const card = screen.getByTestId("end-of-voting-card");
    expect(card).toHaveAttribute("data-variant", "host-most-done");
    // With mock: t("host.mostDone", {ready:3, total:4}) → "host.mostDone:{...}"
    expect(card).toHaveTextContent(/host\.mostDone:/);
    await userEvent.click(screen.getByRole("button", { name: /host\.endVotingCta/i }));
    expect(onEndVoting).toHaveBeenCalledTimes(1);
  });

  it("hostSelfDoneOnly — shows progress key with NO End-voting CTA", () => {
    const onEndVoting = vi.fn();
    render(
      <EndOfVotingCard
        variant={{ kind: "hostSelfDoneOnly", ready: 1, total: 4 }}
        onJumpTo={() => {}}
        onEndVoting={onEndVoting}
      />,
    );
    const card = screen.getByTestId("end-of-voting-card");
    expect(card).toHaveAttribute("data-variant", "host-self-done-only");
    // With mock: t("host.selfDoneOnly", {ready:1, total:4}) → "host.selfDoneOnly:{...}"
    expect(card).toHaveTextContent(/host\.selfDoneOnly:/);
    expect(
      screen.queryByRole("button", { name: /host\.endVotingCta/i }),
    ).not.toBeInTheDocument();
    expect(onEndVoting).not.toHaveBeenCalled();
  });

  // SPEC §8.11.2 "Count semantics — no degenerate `1 of 1` fallback"
  it("hostSelfDoneOnlyNoCount — shows the 'host.selfDoneOnlyNoCount' key without any fraction", () => {
    const onEndVoting = vi.fn();
    render(
      <EndOfVotingCard
        variant={{ kind: "hostSelfDoneOnlyNoCount" }}
        onJumpTo={() => {}}
        onEndVoting={onEndVoting}
      />,
    );
    const card = screen.getByTestId("end-of-voting-card");
    expect(card).toHaveAttribute(
      "data-variant",
      "host-self-done-only-no-count",
    );
    // With mock: t("host.selfDoneOnlyNoCount") → "host.selfDoneOnlyNoCount"
    expect(card).toHaveTextContent("host.selfDoneOnlyNoCount");
    // Critical: no "X of Y" fraction must appear
    expect(card.textContent).not.toMatch(/\d+\s*:\s*\{.*"ready".*"total"/i);
    expect(
      screen.queryByRole("button", { name: /host\.endVotingCta/i }),
    ).not.toBeInTheDocument();
    expect(onEndVoting).not.toHaveBeenCalled();
  });
});
