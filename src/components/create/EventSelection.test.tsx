// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import EventSelection from "./EventSelection";

const BASE_PROPS = {
  year: 2026,
  event: "final" as const,
  availableYears: [2026, 2025] as const,
  onChange: vi.fn(),
  onNext: vi.fn(),
};

describe("EventSelection", () => {
  it("renders the year + event selectors and the Next button", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "idle" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/create\.eventSelection\.yearLabel/i)).toBeInTheDocument();
    expect(screen.getByText(/create\.eventLabels\.final/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create\.actions\.next/ })).toBeDisabled();
  });

  it("enables Next only when contestants.kind is 'ready'", () => {
    const { rerender } = render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "loading" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /create\.actions\.next/ })).toBeDisabled();
    rerender(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /create\.actions\.next/ })).not.toBeDisabled();
  });

  it("renders the loading shimmer when contestants is loading", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "loading" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByText(/create\.eventSelection\.loading/i)).toBeInTheDocument();
  });

  it("renders the loaded count when contestants is ready", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    // With the i18n mock, the key is returned verbatim (with params).
    expect(screen.getByText(/create\.eventSelection\.countryCount/i)).toBeInTheDocument();
  });

  it("renders the inline error with role='alert' when contestants is in error state", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{
          kind: "error",
          errorMessage: "We couldn't load contestant data for this event.",
        }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    // errorMessage is passed directly and rendered as-is
    expect(alert).toHaveTextContent(/couldn.?t load contestant data/i);
  });

  it("falls back to the i18n key when no errorMessage is provided", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "error" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /create\.eventSelection\.error/i,
    );
  });

  it("does NOT render the Back button when not in error state, even if onBack is provided", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /create\.actions\.back/ }),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the Back button in error state when onBack is not provided", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "error" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /create\.actions\.back/ }),
    ).not.toBeInTheDocument();
  });

  it("renders the Back button only in error state when onBack is provided (A13)", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "error" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /create\.actions\.back/ }),
    ).toBeInTheDocument();
  });

  it("calls onBack when the Back button is clicked", () => {
    const onBack = vi.fn();
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "error" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create\.actions\.back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders exactly the availableYears in the year dropdown (newest first)", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        availableYears={[2026, 2025]}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const select = screen.getByLabelText(
      /create\.eventSelection\.yearLabel/i,
    ) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["2026", "2025"]);
  });

  it("prepends extraYears (dev-only test fixtures) above the real years", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        availableYears={[2026, 2025]}
        extraYears={[9999]}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const select = screen.getByLabelText(
      /create\.eventSelection\.yearLabel/i,
    ) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["9999", "2026", "2025"]);
  });

  it("calls onChange with the new year when the year selector changes", () => {
    const onChange = vi.fn();
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={onChange}
        onNext={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/create\.eventSelection\.yearLabel/i), {
      target: { value: "2025" },
    });
    expect(onChange).toHaveBeenCalledWith({ year: 2025 });
  });

  it("calls onChange with the new event when an event card is clicked", () => {
    const onChange = vi.fn();
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={onChange}
        onNext={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("create.eventLabels.semi1"));
    expect(onChange).toHaveBeenCalledWith({ event: "semi1" });
  });

  it("renders the slow indicator with distinct copy when contestants is in slow state", () => {
    // SPEC §5.1e — at 5s the wizard escalates from "Loading contestants…" to
    // a "this is taking a while" cue so the user knows we're still trying.
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "slow" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByTestId("contestants-slow")).toHaveTextContent(
      /create\.eventSelection\.slow/i,
    );
    expect(screen.queryByText(/create\.eventSelection\.loading/i)).not.toBeInTheDocument();
  });

  it("renders the timeout error with role='alert' when contestants is in timeout state", () => {
    // SPEC §5.1e — 10s hard cut renders an actionable error rather than
    // leaving the wizard in a forever-loading state.
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{
          kind: "timeout",
          errorMessage:
            "Loading is taking too long. Try again, or pick a different year/event.",
        }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    // errorMessage is passed directly and rendered as-is
    expect(alert).toHaveTextContent(/taking too long/i);
    expect(screen.getByTestId("contestants-timeout")).toBeInTheDocument();
  });

  it("renders the Back button in timeout state when onBack is provided", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{
          kind: "timeout",
          errorMessage: "Loading is taking too long.",
        }}
        onChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /create\.actions\.back/ }),
    ).toBeInTheDocument();
  });

  it("disables Next in slow + timeout states", () => {
    const { rerender } = render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "slow" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /create\.actions\.next/ })).toBeDisabled();
    rerender(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "timeout", errorMessage: "x" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /create\.actions\.next/ })).toBeDisabled();
  });

  it("calls onNext when the Next button is clicked (and enabled)", () => {
    const onNext = vi.fn();
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={vi.fn()}
        onNext={onNext}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /create\.actions\.next/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  describe("allocation-draw-lag caveat (SPEC §5.3)", () => {
    it("renders the caveat below the error alert for current-year semi-final 1", () => {
      render(
        <EventSelection
          {...BASE_PROPS}
          year={2026}
          availableYears={[2026, 2025]}
          event="semi1"
          contestants={{ kind: "error" }}
          onChange={vi.fn()}
          onNext={vi.fn()}
        />,
      );
      expect(screen.getByTestId("allocation-draw-caveat")).toHaveTextContent(
        /create\.eventSelection\.allocationDrawCaveat/i,
      );
    });

    it("renders the caveat for current-year semi-final 2", () => {
      render(
        <EventSelection
          {...BASE_PROPS}
          year={2026}
          availableYears={[2026, 2025]}
          event="semi2"
          contestants={{ kind: "error" }}
          onChange={vi.fn()}
          onNext={vi.fn()}
        />,
      );
      expect(screen.getByTestId("allocation-draw-caveat")).toBeInTheDocument();
    });

    it("renders the caveat in timeout state for current-year semis", () => {
      render(
        <EventSelection
          {...BASE_PROPS}
          year={2026}
          availableYears={[2026, 2025]}
          event="semi1"
          contestants={{ kind: "timeout", errorMessage: "x" }}
          onChange={vi.fn()}
          onNext={vi.fn()}
        />,
      );
      expect(screen.getByTestId("allocation-draw-caveat")).toBeInTheDocument();
    });

    it("does NOT render the caveat for current-year Grand Final (lineup published earlier)", () => {
      render(
        <EventSelection
          {...BASE_PROPS}
          year={2026}
          availableYears={[2026, 2025]}
          event="final"
          contestants={{ kind: "error" }}
          onChange={vi.fn()}
          onNext={vi.fn()}
        />,
      );
      expect(
        screen.queryByTestId("allocation-draw-caveat"),
      ).not.toBeInTheDocument();
    });

    it("does NOT render the caveat for past-year semis (draw long since happened)", () => {
      render(
        <EventSelection
          {...BASE_PROPS}
          year={2024}
          availableYears={[2026, 2025]}
          event="semi1"
          contestants={{ kind: "error" }}
          onChange={vi.fn()}
          onNext={vi.fn()}
        />,
      );
      expect(
        screen.queryByTestId("allocation-draw-caveat"),
      ).not.toBeInTheDocument();
    });

    it("does NOT render the caveat outside error/timeout states", () => {
      render(
        <EventSelection
          {...BASE_PROPS}
          year={2026}
          availableYears={[2026, 2025]}
          event="semi1"
          contestants={{ kind: "loading" }}
          onChange={vi.fn()}
          onNext={vi.fn()}
        />,
      );
      expect(
        screen.queryByTestId("allocation-draw-caveat"),
      ).not.toBeInTheDocument();
    });
  });
});
