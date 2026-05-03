// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import CatchingUpPill from "./CatchingUpPill";

describe("CatchingUpPill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when active is false", () => {
    const { container } = render(<CatchingUpPill active={false} />);
    expect(container.textContent ?? "").toBe("");
  });

  it("renders the locale-keyed message when active is true", () => {
    render(<CatchingUpPill active={true} />);
    expect(screen.getByTestId("catching-up-pill")).toBeInTheDocument();
    expect(screen.getByText("room.catchingUp")).toBeInTheDocument();
  });

  it("auto-clears after ~1 second", () => {
    render(<CatchingUpPill active={true} />);
    expect(screen.getByTestId("catching-up-pill")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.queryByTestId("catching-up-pill")).not.toBeInTheDocument();
  });

  it("uses role='status' aria-live='polite' for screen readers", () => {
    render(<CatchingUpPill active={true} />);
    const el = screen.getByTestId("catching-up-pill");
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("applies motion-safe shimmer to the inner text (reduced-motion gated)", () => {
    render(<CatchingUpPill active={true} />);
    const inner = screen.getByText("room.catchingUp");
    expect(inner.className).toContain("motion-safe:animate-shimmer");
  });
});
