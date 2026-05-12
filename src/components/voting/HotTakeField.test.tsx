// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import HotTakeField from "./HotTakeField";

describe("HotTakeField", () => {
  it("renders the add-pill button when value is empty and not yet expanded", () => {
    render(<HotTakeField value="" onChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /addPillAria/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("expands to textarea when the pill is clicked", () => {
    render(<HotTakeField value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /addPillAria/i }));
    expect(screen.getByRole("textbox", { name: /fieldAria/i })).toBeInTheDocument();
  });

  it("renders the textarea directly when there's already a saved value (skips the pill)", () => {
    render(<HotTakeField value="this is a hot take" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /addPillAria/i })).toBeNull();
    expect(screen.getByRole("textbox", { name: /fieldAria/i })).toHaveValue(
      "this is a hot take",
    );
  });

  it("collapses back to the pill when textarea blurs while empty", () => {
    render(<HotTakeField value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /addPillAria/i }));
    const textarea = screen.getByRole("textbox", { name: /fieldAria/i });
    fireEvent.blur(textarea);
    expect(
      screen.getByRole("button", { name: /addPillAria/i }),
    ).toBeInTheDocument();
  });

  it("does NOT collapse when textarea blurs with a value (rendered text mode)", () => {
    render(<HotTakeField value="something" onChange={vi.fn()} />);
    const textarea = screen.getByRole("textbox", { name: /fieldAria/i });
    fireEvent.blur(textarea);
    // Still renders the textarea because value !== "" forces showInput.
    expect(screen.getByRole("textbox", { name: /fieldAria/i })).toBeInTheDocument();
  });

  it("calls onChange with each typed value", () => {
    const onChange = vi.fn();
    render(<HotTakeField value="hi" onChange={onChange} />);
    const textarea = screen.getByRole("textbox", { name: /fieldAria/i });
    fireEvent.change(textarea, { target: { value: "hi there" } });
    expect(onChange).toHaveBeenCalledWith("hi there");
  });

  it("renders the live char counter as 'count / max'", () => {
    render(<HotTakeField value="hello" onChange={vi.fn()} maxChars={140} />);
    expect(screen.getByText(/5 \/ 140/)).toBeInTheDocument();
  });

  it("flips the counter to text-accent when within 10 chars of the limit (nearLimit)", () => {
    const value = "x".repeat(131); // 131 chars, limit 140 → 9 remaining → nearLimit
    render(<HotTakeField value={value} onChange={vi.fn()} maxChars={140} />);
    const counter = screen.getByText(/131 \/ 140/);
    expect(counter.className).toContain("text-accent");
  });

  it("keeps the counter muted when not near the limit", () => {
    render(<HotTakeField value="hello" onChange={vi.fn()} maxChars={140} />);
    const counter = screen.getByText(/5 \/ 140/);
    expect(counter.className).toContain("text-muted-foreground");
    expect(counter.className).not.toContain("text-accent");
  });

  it("rejects edits that would exceed maxChars (no onChange call)", () => {
    const onChange = vi.fn();
    render(<HotTakeField value={"x".repeat(140)} onChange={onChange} maxChars={140} />);
    const textarea = screen.getByRole("textbox", { name: /fieldAria/i });
    // Try to push over the limit.
    fireEvent.change(textarea, { target: { value: "x".repeat(141) } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("respects a custom maxChars prop", () => {
    render(<HotTakeField value="hi" onChange={vi.fn()} maxChars={20} />);
    expect(screen.getByText(/2 \/ 20/)).toBeInTheDocument();
  });

  it("counts emoji as 2 chars via countHotTakeChars (Intl.Segmenter + EMOJI_RE)", () => {
    render(<HotTakeField value="🇸🇪" onChange={vi.fn()} />);
    expect(screen.getByText(/2 \/ 140/)).toBeInTheDocument();
  });

  it("marks textarea with data-no-swipe so VotingView's swipe-nav doesn't fire", () => {
    render(<HotTakeField value="hi" onChange={vi.fn()} />);
    const textarea = screen.getByRole("textbox", { name: /fieldAria/i });
    expect(textarea).toHaveAttribute("data-no-swipe");
  });
});
