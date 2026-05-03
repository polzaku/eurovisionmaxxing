// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import MissedCard from "./MissedCard";

const CATEGORIES = [
  { name: "Vocals" },
  { name: "Outfit" },
  { name: "Stage drama" },
];

const PROJECTED = {
  overall: 6.4,
  perCategory: {
    Vocals: 7.2,
    Outfit: 5.5,
    "Stage drama": 6.8,
  },
};

describe("MissedCard", () => {
  it("renders the missed-state header copy", () => {
    render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/This one.s marked as missed/),
    ).toBeInTheDocument();
  });

  it("renders the estimated overall score with ~ prefix", () => {
    render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(screen.getByText(/^~6\.4$/)).toBeInTheDocument();
  });

  it("renders one row per category with the projected per-category score", () => {
    render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    // Category names.
    expect(screen.getByText("Vocals")).toBeInTheDocument();
    expect(screen.getByText("Outfit")).toBeInTheDocument();
    expect(screen.getByText("Stage drama")).toBeInTheDocument();
    // Per-category estimated scores.
    expect(screen.getByText(/^~7\.2$/)).toBeInTheDocument();
    expect(screen.getByText(/^~5\.5$/)).toBeInTheDocument();
    expect(screen.getByText(/^~6\.8$/)).toBeInTheDocument();
  });

  it("falls back to ~5 for a category without a projected value", () => {
    const partial = {
      overall: 6.0,
      perCategory: { Vocals: 7.2 }, // 'Outfit' missing
    };
    render(
      <MissedCard
        projected={partial}
        categories={[{ name: "Vocals" }, { name: "Outfit" }]}
        onRescore={vi.fn()}
      />,
    );
    expect(screen.getByText(/^~7\.2$/)).toBeInTheDocument();
    expect(screen.getByText(/^~5$/)).toBeInTheDocument();
  });

  it("fires onRescore when the Rescore button is clicked", () => {
    const onRescore = vi.fn();
    render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={onRescore}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Rescore this contestant/i }),
    );
    expect(onRescore).toHaveBeenCalledTimes(1);
  });

  it("renders the data-testid hook for the room-page query selector", () => {
    const { container } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-testid='missed-card']")).toBeTruthy();
  });
});

describe("MissedCard — §8.4 / V8 projected-update animation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT show the updated label on first mount", () => {
    render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("missed-updated-label"),
    ).not.toBeInTheDocument();
  });

  it("does NOT show the updated label when re-rendered with the same projection", () => {
    const { rerender } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    rerender(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("missed-updated-label"),
    ).not.toBeInTheDocument();
  });

  it("shows the 'updated from your recent votes' label when overall projection shifts", () => {
    const { rerender } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    rerender(
      <MissedCard
        projected={{ ...PROJECTED, overall: 6.6 }}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("missed-updated-label"),
    ).toBeInTheDocument();
    expect(screen.getByText(/updated from your recent votes/)).toBeInTheDocument();
  });

  it("auto-clears the updated label after ~2 seconds", () => {
    const { rerender } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    rerender(
      <MissedCard
        projected={{ ...PROJECTED, overall: 6.6 }}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(screen.getByTestId("missed-updated-label")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(
      screen.queryByTestId("missed-updated-label"),
    ).not.toBeInTheDocument();
  });

  it("applies animate-score-pop to the overall cell when overall projection shifts", () => {
    const { rerender, container } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    rerender(
      <MissedCard
        projected={{ ...PROJECTED, overall: 6.6 }}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    const overall = container.querySelector("p.text-5xl");
    expect(overall?.className).toContain("animate-score-pop");
  });

  it("applies animate-score-pop only to per-category cells whose value shifted", () => {
    const next = {
      overall: 6.4,
      perCategory: { ...PROJECTED.perCategory, Vocals: 8.0 }, // only Vocals changes
    };
    const { rerender } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    rerender(
      <MissedCard
        projected={next}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    const vocalsValue = screen.getByText(/^~8$/);
    expect(vocalsValue.className).toContain("animate-score-pop");
    const outfitValue = screen.getByText(/^~5\.5$/);
    expect(outfitValue.className).not.toContain("animate-score-pop");
  });

  it("removes animate-score-pop class once the label clears (2s later)", () => {
    const { rerender, container } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    rerender(
      <MissedCard
        projected={{ ...PROJECTED, overall: 6.6 }}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(container.querySelector("p.text-5xl")?.className).toContain(
      "animate-score-pop",
    );
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(container.querySelector("p.text-5xl")?.className).not.toContain(
      "animate-score-pop",
    );
  });

  it("re-fires animation + label when projection changes a second time", () => {
    const { rerender } = render(
      <MissedCard
        projected={PROJECTED}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    rerender(
      <MissedCard
        projected={{ ...PROJECTED, overall: 6.6 }}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(screen.getByTestId("missed-updated-label")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(
      screen.queryByTestId("missed-updated-label"),
    ).not.toBeInTheDocument();
    rerender(
      <MissedCard
        projected={{ ...PROJECTED, overall: 7.0 }}
        categories={CATEGORIES}
        onRescore={vi.fn()}
      />,
    );
    expect(screen.getByTestId("missed-updated-label")).toBeInTheDocument();
  });
});
