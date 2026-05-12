// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import EndVotingCountdownToast from "./EndVotingCountdownToast";

function fiveSecondsFromNow(): string {
  return new Date(Date.now() + 5000).toISOString();
}

function inThePast(): string {
  return new Date(Date.now() - 1000).toISOString();
}

describe("EndVotingCountdownToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin the system clock so votingEndingTimer's "now" is predictable.
    vi.setSystemTime(new Date("2026-05-03T19:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when votingEndsAt is null", () => {
    const { container } = render(
      <EndVotingCountdownToast
        votingEndsAt={null}
        onUndo={vi.fn()}
        onElapsed={vi.fn()}
      />,
    );
    expect(container.textContent ?? "").toBe("");
    expect(
      screen.queryByTestId("end-voting-countdown-toast"),
    ).not.toBeInTheDocument();
  });

  it("renders the countdown label with remaining seconds (key form)", () => {
    render(
      <EndVotingCountdownToast
        votingEndsAt={fiveSecondsFromNow()}
        onUndo={vi.fn()}
        onElapsed={vi.fn()}
      />,
    );
    // With mock: t("label", {remainingSeconds:5}) → "label:{\"remainingSeconds\":5}"
    expect(screen.getByText(/label:/)).toBeInTheDocument();
  });

  it("ticks the displayed countdown as time elapses (key still present)", () => {
    render(
      <EndVotingCountdownToast
        votingEndsAt={fiveSecondsFromNow()}
        onUndo={vi.fn()}
        onElapsed={vi.fn()}
      />,
    );
    expect(screen.getByText(/label:/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    // key is still "label:" with updated params
    expect(screen.getByText(/label:/)).toBeInTheDocument();
  });

  it("renders the Undo button while countdown is live", () => {
    render(
      <EndVotingCountdownToast
        votingEndsAt={fiveSecondsFromNow()}
        onUndo={vi.fn()}
        onElapsed={vi.fn()}
      />,
    );
    // With mock: aria-label = t("undoAria") → "undoAria"
    expect(
      screen.getByRole("button", { name: /undoAria/i }),
    ).toBeInTheDocument();
  });

  it("fires onUndo when the Undo button is clicked", () => {
    const onUndo = vi.fn();
    render(
      <EndVotingCountdownToast
        votingEndsAt={fiveSecondsFromNow()}
        onUndo={onUndo}
        onElapsed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /undoAria/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("disables the Undo button + shows undoBusy key when undoBusy is true", () => {
    render(
      <EndVotingCountdownToast
        votingEndsAt={fiveSecondsFromNow()}
        onUndo={vi.fn()}
        onElapsed={vi.fn()}
        undoBusy
      />,
    );
    const btn = screen.getByRole("button", { name: /undoAria/i });
    expect(btn).toBeDisabled();
    // With mock: t("undoBusy") → "undoBusy"
    expect(btn).toHaveTextContent(/undoBusy/i);
  });

  it("flips the label to 'finalising' key and hides Undo once expired", () => {
    render(
      <EndVotingCountdownToast
        votingEndsAt={inThePast()}
        onUndo={vi.fn()}
        onElapsed={vi.fn()}
      />,
    );
    // With mock: t("finalising") → "finalising"
    expect(screen.getByText("finalising")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /undoAria/i }),
    ).not.toBeInTheDocument();
  });

  it("fires onElapsed exactly once when the countdown reaches zero (firedRef guard)", () => {
    const onElapsed = vi.fn();
    render(
      <EndVotingCountdownToast
        votingEndsAt={fiveSecondsFromNow()}
        onUndo={vi.fn()}
        onElapsed={onElapsed}
      />,
    );
    expect(onElapsed).not.toHaveBeenCalled();
    // Cross the deadline.
    act(() => {
      vi.advanceTimersByTime(5_500);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
    // Many subsequent ticks: still only once.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("resets the firedRef when votingEndsAt changes (so a re-fire can trigger again)", () => {
    const onElapsed = vi.fn();
    const initial = fiveSecondsFromNow();
    const { rerender } = render(
      <EndVotingCountdownToast
        votingEndsAt={initial}
        onUndo={vi.fn()}
        onElapsed={onElapsed}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5_500);
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);

    // Operator undoes, then the admin re-fires End-voting → new deadline.
    const next = new Date(Date.now() + 5_000).toISOString();
    rerender(
      <EndVotingCountdownToast
        votingEndsAt={next}
        onUndo={vi.fn()}
        onElapsed={onElapsed}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5_500);
    });
    expect(onElapsed).toHaveBeenCalledTimes(2);
  });

  it("clears the interval on unmount (no leaked ticks)", () => {
    const onUndo = vi.fn();
    const { unmount } = render(
      <EndVotingCountdownToast
        votingEndsAt={fiveSecondsFromNow()}
        onUndo={onUndo}
        onElapsed={vi.fn()}
      />,
    );
    expect(screen.getByText(/label:/)).toBeInTheDocument();
    unmount();
    // After unmount, advancing time should not cause errors or extra calls.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onUndo).not.toHaveBeenCalled();
  });
});
