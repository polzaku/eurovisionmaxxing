// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
