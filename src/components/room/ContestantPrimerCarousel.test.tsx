// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const { markSeenMock } = vi.hoisted(() => ({ markSeenMock: vi.fn() }));
vi.mock("@/lib/voting/emxHintsSeen", () => ({
  markSeen: markSeenMock,
}));

import ContestantPrimerCarousel from "./ContestantPrimerCarousel";
import type { Contestant } from "@/types";

function mkContestant(
  code: string,
  country: string,
  runningOrder: number,
  artistPreviewUrl?: string,
): Contestant {
  return {
    id: `9999-${code}`,
    country,
    countryCode: code,
    flagEmoji: "🏳️",
    artist: `Artist of ${country}`,
    song: `Song of ${country}`,
    runningOrder,
    event: "final",
    year: 9999,
    ...(artistPreviewUrl ? { artistPreviewUrl } : {}),
  };
}

const SE = mkContestant("se", "Sweden", 1, "https://youtube.com/watch?v=test");
const UA = mkContestant("ua", "Ukraine", 2);
const FR = mkContestant("fr", "France", 3);

const CATEGORIES = [
  { name: "Vocals", hint: "Pitch + power" },
  { name: "Outfit", hint: "Stage drama" },
  { name: "Choreo" }, // no hint
];

describe("<ContestantPrimerCarousel>", () => {
  beforeEach(() => {
    markSeenMock.mockClear();
  });

  it("renders one card per contestant", () => {
    render(
      <ContestantPrimerCarousel
        contestants={[SE, UA, FR]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    expect(screen.getByTestId(`primer-card-${SE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`primer-card-${UA.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`primer-card-${FR.id}`)).toBeInTheDocument();
  });

  it("renders nothing when contestants array is empty", () => {
    const { container } = render(
      <ContestantPrimerCarousel
        contestants={[]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("front shows running order, country, artist, song", () => {
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    expect(screen.getByText(/1/)).toBeInTheDocument();
    expect(screen.getByText(SE.country)).toBeInTheDocument();
    expect(screen.getByText(SE.artist)).toBeInTheDocument();
    expect(screen.getByText(SE.song)).toBeInTheDocument();
  });

  it("tapping a card flips it (data-flipped='true')", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    const card = screen.getByTestId(`primer-card-${SE.id}`);
    expect(card).toHaveAttribute("data-flipped", "false");
    await user.click(card);
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("renders category hints (with hint set) on the back; skips categories without a hint", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    const card = screen.getByTestId(`primer-card-${SE.id}`);
    await user.click(card);
    expect(screen.getByText(/Pitch \+ power/)).toBeInTheDocument();
    expect(screen.getByText(/Stage drama/)).toBeInTheDocument();
    expect(screen.queryByText("Choreo:")).toBeNull();
  });

  it("renders 'Preview on YouTube' link only when artistPreviewUrl is set", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE, UA]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );

    const seCard = screen.getByTestId(`primer-card-${SE.id}`);
    await user.click(seCard);
    const seLink = within(seCard).getByText(/lobby\.primer\.previewSong/);
    expect(seLink.closest("a")).toHaveAttribute("href", SE.artistPreviewUrl);
    expect(seLink.closest("a")).toHaveAttribute("target", "_blank");
    expect(seLink.closest("a")).toHaveAttribute("rel", "noopener noreferrer");

    const uaCard = screen.getByTestId(`primer-card-${UA.id}`);
    await user.click(uaCard);
    expect(within(uaCard).queryByText(/lobby\.primer\.previewSong/)).toBeNull();
  });

  it("calls markSeen(roomId) on first front→back flip", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-42"
      />,
    );
    const card = screen.getByTestId(`primer-card-${SE.id}`);
    await user.click(card);
    expect(markSeenMock).toHaveBeenCalledWith("r-42");
  });
});
