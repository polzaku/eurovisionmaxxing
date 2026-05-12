// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import MissedToast from "./MissedToast";

const TOAST = {
  contestantId: "2026-se",
  projectedOverall: 6.4,
};

describe("MissedToast", () => {
  it("renders nothing when toast prop is null", () => {
    const { container } = render(
      <MissedToast toast={null} onUndo={vi.fn()} />,
    );
    expect(container.textContent ?? "").toBe("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the missed body copy with the projected overall score (key form)", () => {
    render(<MissedToast toast={TOAST} onUndo={vi.fn()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    // With next-intl mock, t("body", {...}) returns "body:{"overall":6.4}"
    expect(screen.getByText(/body:/)).toBeInTheDocument();
  });

  it("renders the Undo button", () => {
    render(<MissedToast toast={TOAST} onUndo={vi.fn()} />);
    expect(screen.getByRole("button", { name: "undo" })).toBeInTheDocument();
  });

  it("calls onUndo when the Undo button is clicked", () => {
    const onUndo = vi.fn();
    render(<MissedToast toast={TOAST} onUndo={onUndo} />);
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("does NOT render the dismiss × button when onDismiss is omitted", () => {
    render(<MissedToast toast={TOAST} onUndo={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /dismissAria/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the dismiss × button when onDismiss is provided", () => {
    render(
      <MissedToast toast={TOAST} onUndo={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /dismissAria/i }),
    ).toBeInTheDocument();
  });

  it("calls onDismiss when the × button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <MissedToast toast={TOAST} onUndo={vi.fn()} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismissAria/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses aria-live='polite' for screen readers (non-intrusive announcement)", () => {
    render(<MissedToast toast={TOAST} onUndo={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
