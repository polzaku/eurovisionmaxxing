// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import TwelvePointSplash from "./TwelvePointSplash";
import type { Contestant } from "@/types";

const messages = {
  announce: {
    shortReveal: {
      revealed: "Revealed ✓",
    },
  },
};

const sampleContestant: Contestant = {
  id: "2026-se",
  country: "Sweden",
  countryCode: "se",
  flagEmoji: "🇸🇪",
  artist: "Test Artist",
  song: "Test Song",
  runningOrder: 1,
  event: "final",
  year: 2026,
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("TwelvePointSplash", () => {
  it("renders flag + country + artist + song in fullscreen size", () => {
    renderWithIntl(
      <TwelvePointSplash contestant={sampleContestant} size="fullscreen" />,
    );
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Test Artist")).toBeInTheDocument();
    expect(screen.getByText("Test Song")).toBeInTheDocument();
    expect(screen.getByText("🇸🇪")).toBeInTheDocument();
  });

  it("renders all content in card size", () => {
    renderWithIntl(
      <TwelvePointSplash contestant={sampleContestant} size="card" />,
    );
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Test Artist")).toBeInTheDocument();
  });

  it("calls onDismiss after dismissAfterMs", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderWithIntl(
      <TwelvePointSplash
        contestant={sampleContestant}
        size="fullscreen"
        onDismiss={onDismiss}
        dismissAfterMs={3000}
      />,
    );
    vi.advanceTimersByTime(2999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("renders without artist/song when fields are missing (degenerate)", () => {
    const partial: Contestant = {
      ...sampleContestant,
      artist: "",
      song: "",
    };
    renderWithIntl(
      <TwelvePointSplash contestant={partial} size="card" />,
    );
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    // No crash; artist/song absent or empty but country still renders.
  });
});
