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

  const baseProps = {
    isAdmin: false,
    roomId: "r-abc-123",
    shareUrl: "https://x.test/results/r1",
    textSummary: "hello",
    year: 2026,
    event: "final",
  };

  it("guest sees Copy link + Copy summary + View full results (no Create another)", () => {
    render(<EndOfShowCtas {...baseProps} isAdmin={false} />);
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.copyLink/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.copySummary/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /awards.endOfShow.viewFullResults/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /awards.endOfShow.createAnother/ }),
    ).toBeNull();
  });

  it("admin also sees Create another room", () => {
    render(<EndOfShowCtas {...baseProps} isAdmin={true} />);
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.createAnother/ }),
    ).toBeInTheDocument();
    // View full results stays visible for admin too — it's everyone-shown.
    expect(
      screen.getByRole("button", {
        name: /awards.endOfShow.viewFullResults/,
      }),
    ).toBeInTheDocument();
  });

  it("View full results routes to /results/{roomId} (URL-encoded)", () => {
    render(<EndOfShowCtas {...baseProps} roomId="r-abc-123" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /awards.endOfShow.viewFullResults/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith("/results/r-abc-123");
  });

  it("View full results URL-encodes a roomId with special characters", () => {
    render(<EndOfShowCtas {...baseProps} roomId="weird id/with slash" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /awards.endOfShow.viewFullResults/,
      }),
    );
    expect(pushMock).toHaveBeenCalledWith(
      "/results/weird%20id%2Fwith%20slash",
    );
  });

  it("Copy link writes share URL and shows confirmation that auto-clears after ~2s", async () => {
    vi.useFakeTimers();
    try {
      render(<EndOfShowCtas {...baseProps} isAdmin={false} />);
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
        {...baseProps}
        isAdmin={false}
        textSummary="🇪🇺 Eurovision recap"
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
    render(<EndOfShowCtas {...baseProps} isAdmin={true} />);
    fireEvent.click(
      screen.getByRole("button", { name: /awards.endOfShow.createAnother/ }),
    );
    expect(pushMock).toHaveBeenCalledWith("/create?year=2026&event=final");
  });
});
