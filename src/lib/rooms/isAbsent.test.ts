import { describe, it, expect } from "vitest";
import { isAbsent } from "@/lib/rooms/isAbsent";

const NOW = new Date("2026-05-10T12:00:00.000Z");

describe("isAbsent", () => {
  it("returns true when lastSeenAt is null (never heartbeated)", () => {
    expect(isAbsent(null, NOW)).toBe(true);
  });

  it("returns false for a fresh heartbeat (1s ago)", () => {
    const fresh = new Date(NOW.getTime() - 1_000).toISOString();
    expect(isAbsent(fresh, NOW)).toBe(false);
  });

  it("returns false at the boundary (exactly 30s ago)", () => {
    const boundary = new Date(NOW.getTime() - 30_000).toISOString();
    expect(isAbsent(boundary, NOW)).toBe(false);
  });

  it("returns true at 30001ms (just past the threshold)", () => {
    const past = new Date(NOW.getTime() - 30_001).toISOString();
    expect(isAbsent(past, NOW)).toBe(true);
  });

  it("respects custom thresholdMs", () => {
    const tenSecondsAgo = new Date(NOW.getTime() - 10_000).toISOString();
    expect(isAbsent(tenSecondsAgo, NOW, 5_000)).toBe(true);
    expect(isAbsent(tenSecondsAgo, NOW, 60_000)).toBe(false);
  });

  it("treats future timestamps as not absent (clock skew tolerance)", () => {
    const future = new Date(NOW.getTime() + 5_000).toISOString();
    expect(isAbsent(future, NOW)).toBe(false);
  });
});
