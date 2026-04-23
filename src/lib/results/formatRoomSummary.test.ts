import { describe, it, expect } from "vitest";
import type { Contestant, EventType } from "@/types";
import {
  formatRoomSummary,
  type LeaderboardEntry,
} from "@/lib/results/formatRoomSummary";

const LABELS = {
  eventTitle: (year: number, event: EventType) =>
    event === "final"
      ? `Eurovision ${year} — Grand Final`
      : event === "semi1"
        ? `Eurovision ${year} — Semi-final 1`
        : `Eurovision ${year} — Semi-final 2`,
  topLine: "Our room's top 10:",
  fullResults: "Full results",
};

function makeContestant(
  id: string,
  country: string,
  flag: string,
  runningOrder: number,
): Contestant {
  return {
    id,
    country,
    countryCode: id.slice(-2),
    flagEmoji: flag,
    artist: "Artist",
    song: "Song",
    runningOrder,
    event: "final",
    year: 2026,
  };
}

const TOP10_CONTESTANTS: Contestant[] = [
  makeContestant("2026-se", "Sweden", "🇸🇪", 1),
  makeContestant("2026-ua", "Ukraine", "🇺🇦", 2),
  makeContestant("2026-fr", "France", "🇫🇷", 3),
  makeContestant("2026-it", "Italy", "🇮🇹", 4),
  makeContestant("2026-gb", "UK", "🇬🇧", 5),
  makeContestant("2026-de", "Germany", "🇩🇪", 6),
  makeContestant("2026-es", "Spain", "🇪🇸", 7),
  makeContestant("2026-no", "Norway", "🇳🇴", 8),
  makeContestant("2026-lt", "Lithuania", "🇱🇹", 9),
  makeContestant("2026-pl", "Poland", "🇵🇱", 10),
];

const TOP10_LEADERBOARD: LeaderboardEntry[] = [
  { contestantId: "2026-se", totalPoints: 142, rank: 1 },
  { contestantId: "2026-ua", totalPoints: 128, rank: 2 },
  { contestantId: "2026-fr", totalPoints: 114, rank: 3 },
  { contestantId: "2026-it", totalPoints: 89, rank: 4 },
  { contestantId: "2026-gb", totalPoints: 72, rank: 5 },
  { contestantId: "2026-de", totalPoints: 65, rank: 6 },
  { contestantId: "2026-es", totalPoints: 58, rank: 7 },
  { contestantId: "2026-no", totalPoints: 51, rank: 8 },
  { contestantId: "2026-lt", totalPoints: 44, rank: 9 },
  { contestantId: "2026-pl", totalPoints: 39, rank: 10 },
];

describe("formatRoomSummary", () => {
  it("emits the SPEC §12.2 exemplar top-10 + bets block", () => {
    const out = formatRoomSummary({
      year: 2026,
      event: "final",
      leaderboard: TOP10_LEADERBOARD,
      contestants: TOP10_CONTESTANTS,
      shareUrl: "https://eurovisionmaxxing.com/results/abc123def",
      labels: LABELS,
      bets: {
        headerLine: "Bet results (3 / 3 won):",
        rows: [
          { symbol: "✅", question: "Will Sweden finish top 5?" },
          { symbol: "❌", question: "Will anyone perform barefoot?" },
          { symbol: "✅", question: "Will the winning song be non-English?" },
        ],
      },
    });

    const expected = [
      "🇪🇺 Eurovision 2026 — Grand Final",
      "Our room's top 10:",
      "🥇 🇸🇪 Sweden — 142 pts",
      "🥈 🇺🇦 Ukraine — 128 pts",
      "🥉 🇫🇷 France — 114 pts",
      "4  🇮🇹 Italy — 89 pts",
      "5  🇬🇧 UK — 72 pts",
      "6  🇩🇪 Germany — 65 pts",
      "7  🇪🇸 Spain — 58 pts",
      "8  🇳🇴 Norway — 51 pts",
      "9  🇱🇹 Lithuania — 44 pts",
      "10 🇵🇱 Poland — 39 pts",
      "",
      "Bet results (3 / 3 won):",
      "✅ Will Sweden finish top 5?",
      "❌ Will anyone perform barefoot?",
      "✅ Will the winning song be non-English?",
      "",
      "Full results: https://eurovisionmaxxing.com/results/abc123def",
    ].join("\n");

    expect(out).toBe(expected);
  });

  it("omits the bets block entirely when `bets` arg is not supplied", () => {
    const out = formatRoomSummary({
      year: 2026,
      event: "final",
      leaderboard: TOP10_LEADERBOARD,
      contestants: TOP10_CONTESTANTS,
      shareUrl: "https://ex.com/r/xyz",
      labels: LABELS,
    });
    expect(out).not.toContain("Bet results");
    expect(out.endsWith("\nFull results: https://ex.com/r/xyz")).toBe(true);
    // Exactly one blank line before the share URL (no bets block).
    expect(out.split("\n").filter((line) => line === "")).toHaveLength(1);
  });

  it("renders a leaderboard shorter than 10 without truncation or padding rows", () => {
    const out = formatRoomSummary({
      year: 2026,
      event: "semi1",
      leaderboard: TOP10_LEADERBOARD.slice(0, 3),
      contestants: TOP10_CONTESTANTS,
      shareUrl: "https://ex.com/r/xyz",
      labels: LABELS,
    });
    const lines = out.split("\n");
    expect(lines).toContain("🥇 🇸🇪 Sweden — 142 pts");
    expect(lines).toContain("🥉 🇫🇷 France — 114 pts");
    // No 4th-placed row.
    expect(lines.some((l) => l.startsWith("4 "))).toBe(false);
  });

  it("truncates a 12-entry leaderboard to 10 rows", () => {
    const twelve: LeaderboardEntry[] = [
      ...TOP10_LEADERBOARD,
      { contestantId: "2026-lv", totalPoints: 12, rank: 11 },
      { contestantId: "2026-mt", totalPoints: 3, rank: 12 },
    ];
    const twelveContestants: Contestant[] = [
      ...TOP10_CONTESTANTS,
      makeContestant("2026-lv", "Latvia", "🇱🇻", 11),
      makeContestant("2026-mt", "Malta", "🇲🇹", 12),
    ];
    const out = formatRoomSummary({
      year: 2026,
      event: "final",
      leaderboard: twelve,
      contestants: twelveContestants,
      shareUrl: "https://ex.com/r/xyz",
      labels: LABELS,
    });
    expect(out).toContain("10 🇵🇱 Poland — 39 pts");
    expect(out).not.toContain("Latvia");
    expect(out).not.toContain("Malta");
  });

  it("falls back to ? flag and the raw id when a contestant is missing", () => {
    const out = formatRoomSummary({
      year: 2026,
      event: "final",
      leaderboard: [
        { contestantId: "2026-zz", totalPoints: 99, rank: 1 },
      ],
      contestants: [],
      shareUrl: "https://ex.com/r/xyz",
      labels: LABELS,
    });
    expect(out).toContain("🥇 ? 2026-zz — 99 pts");
  });

  it("omits the bets block when `bets.rows` is an empty array", () => {
    const out = formatRoomSummary({
      year: 2026,
      event: "final",
      leaderboard: TOP10_LEADERBOARD.slice(0, 1),
      contestants: TOP10_CONTESTANTS,
      shareUrl: "https://ex.com/r/xyz",
      labels: LABELS,
      bets: { headerLine: "Bet results (0 / 0 won):", rows: [] },
    });
    expect(out).not.toContain("Bet results");
  });
});
