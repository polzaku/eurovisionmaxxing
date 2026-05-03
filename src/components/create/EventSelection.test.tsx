// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import EventSelection from "./EventSelection";

const BASE_PROPS = {
  year: 2026,
  event: "final" as const,
  minYear: 2000,
  maxYear: 2026,
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
    expect(screen.getByLabelText(/Year/i)).toBeInTheDocument();
    expect(screen.getByText(/Grand Final/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    rerender(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "ready", count: 26, preview: [] }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Next/ })).not.toBeDisabled();
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
    expect(screen.getByText(/Loading contestants/i)).toBeInTheDocument();
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
    // 'countries loaded' is unique; the count '26' would collide with the
    // year option 2026 in the year dropdown.
    expect(screen.getByText(/countries loaded/i)).toBeInTheDocument();
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
    expect(alert).toHaveTextContent(/couldn.?t load contestant data/i);
  });

  it("falls back to the default error message when no errorMessage is provided", () => {
    render(
      <EventSelection
        {...BASE_PROPS}
        contestants={{ kind: "error" }}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn.?t load contestant data/i,
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
      screen.queryByRole("button", { name: /Back/ }),
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
      screen.queryByRole("button", { name: /Back/ }),
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
      screen.getByRole("button", { name: /Back/ }),
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
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
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
    fireEvent.change(screen.getByLabelText(/Year/i), {
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
    fireEvent.click(screen.getByText("Semi-Final 1"));
    expect(onChange).toHaveBeenCalledWith({ event: "semi1" });
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
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
