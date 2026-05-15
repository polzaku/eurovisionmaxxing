// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

import TvModeChooser from "./TvModeChooser";
import { readTvModeChoice } from "@/lib/room/tvModeChoice";

const ROOM_ID = "room-xyz";

describe("TvModeChooser", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("renders the two clear CTAs and the body copy", () => {
    render(<TvModeChooser roomId={ROOM_ID} onChosen={() => {}} />);
    expect(screen.getByText(/tvMode\.chooser\.title/)).toBeInTheDocument();
    expect(screen.getByText(/tvMode\.chooser\.body/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /tvMode\.chooser\.openButtonAria/ }),
    ).toHaveAttribute("href", `/room/${ROOM_ID}/present`);
    expect(
      screen.getByRole("button", { name: /tvMode\.chooser\.skipButton/ }),
    ).toBeInTheDocument();
  });

  it("opens the /present route in a new tab (target=_blank)", () => {
    render(<TvModeChooser roomId={ROOM_ID} onChosen={() => {}} />);
    const link = screen.getByRole("link", {
      name: /tvMode\.chooser\.openButtonAria/,
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringMatching(/noopener/));
  });

  it("persists 'tv' and fires onChosen when the Open link is clicked", () => {
    const onChosen = vi.fn();
    render(<TvModeChooser roomId={ROOM_ID} onChosen={onChosen} />);
    fireEvent.click(
      screen.getByRole("link", { name: /tvMode\.chooser\.openButtonAria/ }),
    );
    expect(readTvModeChoice(ROOM_ID)).toBe("tv");
    expect(onChosen).toHaveBeenCalledWith("tv");
  });

  it("persists 'skip' and fires onChosen when the skip button is clicked", () => {
    const onChosen = vi.fn();
    render(<TvModeChooser roomId={ROOM_ID} onChosen={onChosen} />);
    fireEvent.click(
      screen.getByRole("button", { name: /tvMode\.chooser\.skipButton/ }),
    );
    expect(readTvModeChoice(ROOM_ID)).toBe("skip");
    expect(onChosen).toHaveBeenCalledWith("skip");
  });

  it("renders as a labelled region (non-modal banner) for accessibility", () => {
    render(<TvModeChooser roomId={ROOM_ID} onChosen={() => {}} />);
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-labelledby", "tv-mode-chooser-title");
  });
});
