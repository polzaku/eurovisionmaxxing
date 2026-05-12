// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
}));

import YourNeighbourCard from "./YourNeighbourCard";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice-seed" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob-seed" },
  { userId: "u3", displayName: "Carol", avatarSeed: "carol-seed" },
];

function mkPN(
  userId: string,
  neighbourUserId: string,
  pearson = 0.84,
  isReciprocal = false,
): PersonalNeighbour {
  return { userId, neighbourUserId, pearson, isReciprocal };
}

describe("YourNeighbourCard", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  it("renders nothing when there is no session", () => {
    mockGetSession.mockReturnValue(null);
    const { container } = render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1")]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the session userId has no entry in personalNeighbours", () => {
    mockGetSession.mockReturnValue({
      userId: "stranger-id",
      expiresAt: "2099-01-01",
    });
    const { container } = render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1")]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when personalNeighbours is empty", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    const { container } = render(
      <YourNeighbourCard members={MEMBERS} personalNeighbours={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the viewer's neighbour with name, caption, and Pearson stat", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1", 0.84, false)]}
      />,
    );
    expect(
      screen.getByText("awards.your_neighbour.name"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Pearson 0\.84/)).toBeInTheDocument();
    expect(
      screen.getByText("awards.your_neighbour.caption"),
    ).toBeInTheDocument();
  });

  it("renders the reciprocity badge when isReciprocal=true", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1", 0.84, true)]}
      />,
    );
    expect(
      screen.getByText("awards.your_neighbour.reciprocalBadge"),
    ).toBeInTheDocument();
  });

  it("hides the reciprocity badge when isReciprocal=false", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1", 0.84, false)]}
      />,
    );
    expect(
      screen.queryByText("awards.your_neighbour.reciprocalBadge"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the neighbour can't be resolved against members (defensive)", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    const { container } = render(
      <YourNeighbourCard
        members={[MEMBERS[0]]}
        personalNeighbours={[mkPN("u3", "missing-user")]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("includes the explainer text", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1")]}
      />,
    );
    expect(
      screen.getByText(/your votes lined up most closely/),
    ).toBeInTheDocument();
  });
});
