// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import LobbyCountdown from "./LobbyCountdown";

describe("LobbyCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the fallback copy when broadcastStartUtc is null", () => {
    render(<LobbyCountdown broadcastStartUtc={null} />);
    const section = screen.getByTestId("lobby-countdown");
    expect(section).toHaveAttribute("data-state", "fallback");
    expect(screen.getByText("lobby.countdown.fallback")).toBeInTheDocument();
  });

  it("renders the digits + label when broadcastStartUtc is in the future", () => {
    render(<LobbyCountdown broadcastStartUtc="2026-05-12T01:00:00.000Z" />);
    const section = screen.getByTestId("lobby-countdown");
    expect(section).toHaveAttribute("data-state", "ticking");
    expect(screen.getByText("lobby.countdown.label")).toBeInTheDocument();
    expect(screen.getByText("01:00:00")).toBeInTheDocument();
  });

  it("renders the fallback copy when broadcastStartUtc is in the past", () => {
    render(<LobbyCountdown broadcastStartUtc="2026-05-11T00:00:00.000Z" />);
    const section = screen.getByTestId("lobby-countdown");
    expect(section).toHaveAttribute("data-state", "fallback");
  });

  it("ticks the displayed digits every second", () => {
    render(<LobbyCountdown broadcastStartUtc="2026-05-12T00:00:10.000Z" />);
    expect(screen.getByText("00:00:10")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("00:00:09")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("00:00:08")).toBeInTheDocument();
  });

  it("shows DD:HH:MM:SS format when delta > 24h", () => {
    render(<LobbyCountdown broadcastStartUtc="2026-05-15T03:30:00.000Z" />);
    expect(screen.getByText("03:03:30:00")).toBeInTheDocument();
  });
});
