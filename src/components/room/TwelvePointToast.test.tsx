// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import TwelvePointToast, { type ToastEvent } from "./TwelvePointToast";

const messages = {
  announce: {
    shortReveal: {
      guestToast: "{name} gave 12 to {country} {flag}",
    },
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

describe("TwelvePointToast", () => {
  it("renders the most recent event with name + country + flag", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        at: Date.now(),
      },
    ];
    renderWithIntl(<TwelvePointToast events={events} />);
    expect(screen.getByText(/Alice gave 12 to Sweden/)).toBeInTheDocument();
  });

  it("auto-dismisses after dismissAfterMs", () => {
    vi.useFakeTimers();
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        at: Date.now(),
      },
    ];
    renderWithIntl(<TwelvePointToast events={events} dismissAfterMs={3000} />);
    expect(screen.queryByText(/Alice gave 12/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText(/Alice gave 12/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders nothing when events is empty", () => {
    renderWithIntl(<TwelvePointToast events={[]} />);
    expect(screen.queryByText(/gave 12/)).not.toBeInTheDocument();
  });
});
