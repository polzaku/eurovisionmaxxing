import { describe, it, expect } from "vitest";
import { formatCountdown } from "@/lib/lobby/formatCountdown";

describe("formatCountdown", () => {
  it("returns DD:HH:MM:SS when delta > 24h (3 days, 14h, 25m, 9s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 3 * 86400_000 + 14 * 3600_000 + 25 * 60_000 + 9 * 1000;
    expect(formatCountdown(target, now)).toBe("03:14:25:09");
  });

  it("returns DD:HH:MM:SS at exactly 24h (boundary — 1 day, 0h)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 24 * 3600_000;
    expect(formatCountdown(target, now)).toBe("01:00:00:00");
  });

  it("returns HH:MM:SS when delta < 24h (4h, 32m, 12s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 4 * 3600_000 + 32 * 60_000 + 12 * 1000;
    expect(formatCountdown(target, now)).toBe("04:32:12");
  });

  it("returns HH:MM:SS with leading zeros when delta < 1h (45m, 30s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 45 * 60_000 + 30 * 1000;
    expect(formatCountdown(target, now)).toBe("00:45:30");
  });

  it("returns 00:00:SS when delta < 1 minute (15s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 15 * 1000;
    expect(formatCountdown(target, now)).toBe("00:00:15");
  });

  it("returns null when delta is exactly 0", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    expect(formatCountdown(now, now)).toBeNull();
  });

  it("returns null when target is in the past", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now - 1000;
    expect(formatCountdown(target, now)).toBeNull();
  });
});
