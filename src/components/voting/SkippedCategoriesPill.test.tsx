// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const full = namespace ? `${namespace}.${key}` : key;
      return params ? `${full}:${JSON.stringify(params)}` : full;
    },
}));

import SkippedCategoriesPill from "./SkippedCategoriesPill";

describe("<SkippedCategoriesPill>", () => {
  it("renders 'Skipped N of M' when partial (1 ≤ skipped < total)", () => {
    render(<SkippedCategoriesPill skipped={2} total={5} />);
    const pill = screen.getByTestId("skipped-categories-pill");
    expect(pill).toHaveTextContent("voting.skipped.pill");
    expect(pill.textContent).toContain('"skipped":2');
    expect(pill.textContent).toContain('"total":5');
  });

  it("renders nothing when skipped is 0 (all categories scored)", () => {
    const { container } = render(
      <SkippedCategoriesPill skipped={0} total={5} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when skipped === total (nothing scored yet)", () => {
    // The 'unscored' state is communicated elsewhere — this pill is
    // strictly for *partial* rows.
    const { container } = render(
      <SkippedCategoriesPill skipped={5} total={5} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when total is 0 (degenerate room with no categories)", () => {
    const { container } = render(
      <SkippedCategoriesPill skipped={0} total={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("applies the sm size variant for jump-to drawer rows", () => {
    const { container } = render(
      <SkippedCategoriesPill skipped={1} total={3} size="sm" />,
    );
    expect(container.querySelector("[data-testid='skipped-categories-pill']")?.className)
      .toContain("text-[10px]");
  });

  it("applies the md size by default for the contestant card header", () => {
    const { container } = render(<SkippedCategoriesPill skipped={1} total={3} />);
    expect(container.querySelector("[data-testid='skipped-categories-pill']")?.className)
      .toContain("text-xs");
  });
});
