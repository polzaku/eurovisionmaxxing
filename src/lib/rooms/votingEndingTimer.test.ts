import { describe, it, expect } from "vitest";
import { votingEndingTimer } from "./votingEndingTimer";

const REF = new Date("2026-04-27T10:00:00.000Z");

describe("votingEndingTimer", () => {
  it("returns zero/false for null votingEndsAt (status not voting_ending)", () => {
    expect(votingEndingTimer({ votingEndsAt: null, now: REF })).toEqual({
      remainingMs: 0,
      remainingSeconds: 0,
      expired: false,
    });
  });

  it("returns 5000ms / 5s when deadline is exactly 5 seconds in the future", () => {
    const ends = new Date(REF.getTime() + 5000).toISOString();
    expect(votingEndingTimer({ votingEndsAt: ends, now: REF })).toEqual({
      remainingMs: 5000,
      remainingSeconds: 5,
      expired: false,
    });
  });

  it("ceils sub-second remainders", () => {
    const ends = new Date(REF.getTime() + 4500).toISOString();
    const r = votingEndingTimer({ votingEndsAt: ends, now: REF });
    expect(r.remainingMs).toBe(4500);
    expect(r.remainingSeconds).toBe(5);
    expect(r.expired).toBe(false);
  });

  it("returns expired=true when deadline equals now", () => {
    const r = votingEndingTimer({ votingEndsAt: REF.toISOString(), now: REF });
    expect(r).toEqual({ remainingMs: 0, remainingSeconds: 0, expired: true });
  });

  it("clamps remainingMs >= 0 when deadline is in the past", () => {
    const ends = new Date(REF.getTime() - 1).toISOString();
    expect(votingEndingTimer({ votingEndsAt: ends, now: REF })).toEqual({
      remainingMs: 0,
      remainingSeconds: 0,
      expired: true,
    });
  });

  it("ceils 100ms remainder to 1 second", () => {
    const ends = new Date(REF.getTime() + 100).toISOString();
    const r = votingEndingTimer({ votingEndsAt: ends, now: REF });
    expect(r.remainingMs).toBe(100);
    expect(r.remainingSeconds).toBe(1);
    expect(r.expired).toBe(false);
  });

  it("falls back to zero/false on invalid ISO string", () => {
    expect(
      votingEndingTimer({ votingEndsAt: "not-a-date", now: REF })
    ).toEqual({ remainingMs: 0, remainingSeconds: 0, expired: false });
  });

  it("handles far-future deadlines correctly", () => {
    const ends = new Date(REF.getTime() + 3600 * 1000).toISOString();
    const r = votingEndingTimer({ votingEndsAt: ends, now: REF });
    expect(r.remainingMs).toBe(3600 * 1000);
    expect(r.remainingSeconds).toBe(3600);
    expect(r.expired).toBe(false);
  });
});
