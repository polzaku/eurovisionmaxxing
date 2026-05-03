// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import ScoredByChip from "./ScoredByChip";

describe("ScoredByChip", () => {
  it("renders 'N / M scored' for the partial state (1 ≤ N < M)", () => {
    render(<ScoredByChip count={2} total={5} />);
    expect(screen.getByText(/2 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/voting.scoredChip.partial/)).toBeInTheDocument();
  });

  it("renders the muted-only state when count is 0", () => {
    render(<ScoredByChip count={0} total={5} />);
    expect(screen.getByText(/0 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText(/voting.scoredChip.partial/)).toBeInTheDocument();
  });

  it("renders the all-scored badge when count equals total", () => {
    render(<ScoredByChip count={5} total={5} />);
    expect(screen.getByText(/voting.scoredChip.all/)).toBeInTheDocument();
    // The numeric '5 / 5' is suppressed in favour of the 'all scored' badge.
  });

  it("renders nothing useful when total is 0 (degenerate room)", () => {
    const { container } = render(<ScoredByChip count={0} total={0} />);
    // Should render nothing or a minimal placeholder; spec doesn't define
    // this case explicitly. Asserting we don't crash and don't claim
    // 'all scored' at 0/0.
    expect(container.textContent ?? "").not.toContain("voting.scoredChip.all");
  });

  it("applies the colour-ladder class for all-scored (text-primary)", () => {
    const { container } = render(<ScoredByChip count={5} total={5} />);
    const root = container.querySelector("[data-testid='scored-by-chip']");
    expect(root).toBeTruthy();
    expect(root?.className).toContain("text-primary");
  });

  it("applies the colour-ladder class for partial (text-muted-foreground)", () => {
    const { container } = render(<ScoredByChip count={2} total={5} />);
    const root = container.querySelector("[data-testid='scored-by-chip']");
    expect(root?.className).toContain("text-muted-foreground");
  });

  it("supports a sizing variant for the jump-to drawer (smaller)", () => {
    const { container } = render(
      <ScoredByChip count={2} total={5} size="sm" />,
    );
    const root = container.querySelector("[data-testid='scored-by-chip']");
    expect(root?.className).toContain("text-[10px]");
  });
});
