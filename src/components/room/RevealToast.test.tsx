// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import RevealToast, { type ToastEvent } from "./RevealToast";

const messages = {
  announce: {
    revealToast: "{name} gave {points} to {flag} {country}",
  },
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("RevealToast", () => {
  it("renders 12-point short-style event (regression for short reveal flow)", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 12,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    expect(
      screen.getByText(/Alice gave 12 to 🇸🇪 Sweden/),
    ).toBeInTheDocument();
  });

  it("renders 5-point full-style event with the same component", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Bob",
        country: "Austria",
        flagEmoji: "🇦🇹",
        points: 5,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    expect(
      screen.getByText(/Bob gave 5 to 🇦🇹 Austria/),
    ).toBeInTheDocument();
  });

  it("renders the most recent event when multiple are queued", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 1,
        at: 1,
      },
      {
        id: "2",
        announcingUserDisplayName: "Bob",
        country: "Austria",
        flagEmoji: "🇦🇹",
        points: 12,
        at: 2,
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    expect(screen.getByText(/Bob gave 12 to 🇦🇹 Austria/)).toBeInTheDocument();
    expect(screen.queryByText(/Alice gave 1/)).not.toBeInTheDocument();
  });

  it("auto-dismisses after dismissAfterMs", () => {
    vi.useFakeTimers();
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 12,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} dismissAfterMs={3000} />);
    expect(screen.queryByText(/Alice gave 12/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText(/Alice gave 12/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders nothing when events is empty", () => {
    renderWithIntl(<RevealToast events={[]} />);
    expect(screen.queryByText(/gave/)).not.toBeInTheDocument();
  });

  it("exposes a role=status / aria-live=polite container for screen readers", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 12,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    const toast = screen.getByTestId("reveal-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });
});
