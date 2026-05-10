// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SkipBannerQueue, {
  type SkipEvent,
} from "@/components/room/SkipBannerQueue";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, p?: Record<string, unknown>) => {
    if (k === "announce.skipBanner.single") return `${p?.name} skipped`;
    if (k === "announce.skipBanner.coalesced")
      return `${p?.count} skipped: ${p?.names}`;
    if (k === "announce.skipBanner.coalescedTrailing")
      return `+${p?.remaining}`;
    return k;
  },
}));

describe("<SkipBannerQueue>", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders nothing when no events", () => {
    const { container } = render(<SkipBannerQueue events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a single banner for one event for 3 s, then disappears", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent("Alice skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders 3 sequential banners (3 s each, in arrival order)", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
      { id: "2", userId: "u2", displayName: "Bob", at: 1100 },
      { id: "3", userId: "u3", displayName: "Carol", at: 1200 },
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent("Alice skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("status")).toHaveTextContent("Bob skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("status")).toHaveTextContent("Carol skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("coalesces to a single banner when >3 events arrive within 2 s", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
      { id: "2", userId: "u2", displayName: "Bob", at: 1100 },
      { id: "3", userId: "u3", displayName: "Carol", at: 1200 },
      { id: "4", userId: "u4", displayName: "Dave", at: 1300 },
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 skipped: Alice, Bob, Carol",
    );
    expect(screen.getByRole("status")).toHaveTextContent("+1");
  });

  it("does not coalesce when events arrive >2 s apart", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
      { id: "2", userId: "u2", displayName: "Bob", at: 5000 }, // 4 s later
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent("Alice skipped");
  });
});
