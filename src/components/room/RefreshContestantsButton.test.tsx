// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import RefreshContestantsButton from "./RefreshContestantsButton";

describe("RefreshContestantsButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function flushPromises() {
    return act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows the button label in idle state", () => {
    render(
      <RefreshContestantsButton onRefresh={vi.fn().mockResolvedValue(null)} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent(
      /lobby.refreshContestants.button/,
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("calls onRefresh when clicked and shows busy state", async () => {
    let resolve: (v: { added: string[]; removed: string[]; reordered: string[] } | null) =>
      void = () => {};
    const onRefresh = vi.fn(
      () =>
        new Promise<{ added: string[]; removed: string[]; reordered: string[] } | null>(
          (r) => (resolve = r),
        ),
    );
    render(<RefreshContestantsButton onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveTextContent(
      /lobby.refreshContestants.busy/,
    );
    expect(screen.getByRole("button")).toBeDisabled();
    resolve({ added: [], removed: [], reordered: [] });
    await flushPromises();
    vi.useRealTimers();
  });

  it("renders 'up to date' status when no diff", async () => {
    const onRefresh = vi
      .fn()
      .mockResolvedValue({ added: [], removed: [], reordered: [] });
    render(<RefreshContestantsButton onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button"));
    await flushPromises();
    expect(
      screen.getByText(/lobby.refreshContestants.upToDate/),
    ).toBeInTheDocument();
  });

  it("renders summary status when diff present", async () => {
    const onRefresh = vi
      .fn()
      .mockResolvedValue({ added: ["pl"], removed: ["se"], reordered: ["fr"] });
    render(<RefreshContestantsButton onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button"));
    await flushPromises();
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/lobby.refreshContestants.summary/);
    expect(status.textContent).toContain('"added":1');
    expect(status.textContent).toContain('"removed":1');
    expect(status.textContent).toContain('"reordered":1');
  });

  it("renders error status when onRefresh resolves null", async () => {
    const onRefresh = vi.fn().mockResolvedValue(null);
    render(<RefreshContestantsButton onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button"));
    await flushPromises();
    expect(
      screen.getByText(/lobby.refreshContestants.error/),
    ).toBeInTheDocument();
  });

  it("disables the button for 30 s after a successful refresh, then re-enables", async () => {
    const onRefresh = vi
      .fn()
      .mockResolvedValue({ added: [], removed: [], reordered: [] });
    render(<RefreshContestantsButton onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button"));
    await flushPromises();
    expect(screen.getByRole("button")).toBeDisabled();
    // Advance just under 30 s — still disabled.
    act(() => {
      vi.advanceTimersByTime(29_500);
    });
    expect(screen.getByRole("button")).toBeDisabled();
    // Advance past the cooldown.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("re-enables immediately on error (no cooldown for failed attempts)", async () => {
    const onRefresh = vi.fn().mockResolvedValue(null);
    render(<RefreshContestantsButton onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button"));
    await flushPromises();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
