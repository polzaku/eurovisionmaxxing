// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("guestAllScored — shows admin name when provided", () => {
    render(
      <EndOfVotingCard
        variant={{ kind: "guestAllScored", total: 17 }}
        adminDisplayName="Alice"
        onJumpTo={() => {}}
      />,
    );
    const card = screen.getByTestId("end-of-voting-card");
    expect(card).toHaveAttribute("data-variant", "guest-all-scored");
    expect(card).toHaveTextContent(/all 17 scored/i);
    expect(card).toHaveTextContent(/waiting for alice/i);
  });

  it("guestAllScored — falls back to 'the host' when no admin name", () => {
    render(
      <EndOfVotingCard
        variant={{ kind: "guestAllScored", total: 5 }}
        onJumpTo={() => {}}
      />,
    );
    expect(screen.getByTestId("end-of-voting-card")).toHaveTextContent(
      /waiting for the host/i,
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
    expect(screen.getByText(/you marked 2 as missed/i)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /rescore albania/i }),
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
    expect(screen.getByText(/1 still unscored/i)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /score now belgium/i }),
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
    expect(card).toHaveTextContent(
      /most of the room has finished — you have 2 still to score/i,
    );
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
    expect(card).toHaveTextContent(/everyone.s done/i);
    await userEvent.click(screen.getByRole("button", { name: /end voting/i }));
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
      screen.queryByRole("button", { name: /end voting/i }),
    ).not.toBeInTheDocument();
  });

  it("hostMostDone — shows the ready/total ratio + secondary End-voting CTA", async () => {
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
    expect(card).toHaveTextContent(/3 of 4 have finished/i);
    await userEvent.click(screen.getByRole("button", { name: /end voting/i }));
    expect(onEndVoting).toHaveBeenCalledTimes(1);
  });

  it("hostSelfDoneOnly — shows progress copy with NO End-voting CTA", () => {
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
    expect(card).toHaveTextContent(/your vote is in/i);
    expect(card).toHaveTextContent(/1 of 4 done so far/i);
    expect(
      screen.queryByRole("button", { name: /end voting/i }),
    ).not.toBeInTheDocument();
    expect(onEndVoting).not.toHaveBeenCalled();
  });
});
