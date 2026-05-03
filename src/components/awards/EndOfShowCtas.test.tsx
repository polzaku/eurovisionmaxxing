// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import EndOfShowCtas from "./EndOfShowCtas";

describe("EndOfShowCtas", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    pushMock.mockReset();
  });

  it("guest sees only Copy link + Copy summary", () => {
    render(
      <EndOfShowCtas
        isAdmin={false}
        shareUrl="https://x.test/results/r1"
        textSummary="hello"
        year={2026}
        event="final"
      />,
    );
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.copyLink/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.copySummary/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /awards.endOfShow.createAnother/ }),
    ).toBeNull();
  });

  it("admin also sees Create another room", () => {
    render(
      <EndOfShowCtas
        isAdmin={true}
        shareUrl="https://x.test/results/r1"
        textSummary="hello"
        year={2026}
        event="final"
      />,
    );
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.createAnother/ }),
    ).toBeInTheDocument();
  });

  it("Copy link writes share URL and shows confirmation that auto-clears after ~2s", async () => {
    vi.useFakeTimers();
    try {
      render(
        <EndOfShowCtas
          isAdmin={false}
          shareUrl="https://x.test/results/r1"
          textSummary="hello"
          year={2026}
          event="final"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /awards.endOfShow.copyLink/ }),
      );
      // Drain the awaited clipboard.writeText microtask + the resulting setState.
      await act(async () => {
        await Promise.resolve();
      });
      expect(writeText).toHaveBeenCalledWith("https://x.test/results/r1");
      expect(
        screen.getByText(/awards.endOfShow.copyLinkConfirm/),
      ).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(
        screen.queryByText(/awards.endOfShow.copyLinkConfirm/),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Copy summary writes the textSummary prop", async () => {
    render(
      <EndOfShowCtas
        isAdmin={false}
        shareUrl="https://x.test/results/r1"
        textSummary="🇪🇺 Eurovision recap"
        year={2026}
        event="final"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /awards.endOfShow.copySummary/ }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("🇪🇺 Eurovision recap");
  });

  it("Create another routes to /create with prefilled year + event", () => {
    render(
      <EndOfShowCtas
        isAdmin={true}
        shareUrl="https://x.test/results/r1"
        textSummary="hello"
        year={2026}
        event="final"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /awards.endOfShow.createAnother/ }),
    );
    expect(pushMock).toHaveBeenCalledWith("/create?year=2026&event=final");
  });
});
