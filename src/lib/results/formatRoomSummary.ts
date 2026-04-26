import type { Contestant, EventType } from "@/types";

export interface LeaderboardEntry {
  contestantId: string;
  totalPoints: number;
  rank: number;
}

export interface RoomSummaryBet {
  symbol: "✅" | "❌" | "⚪";
  question: string;
}

export interface RoomSummaryInput {
  year: number;
  event: EventType;
  leaderboard: LeaderboardEntry[];
  contestants: Contestant[];
  shareUrl: string;
  labels: {
    eventTitle: (year: number, event: EventType) => string;
    topLine: string;
    fullResults: string;
  };
  bets?: {
    headerLine: string;
    rows: RoomSummaryBet[];
  };
}

const MEDALS = ["🥇", "🥈", "🥉"];
const MAX_ROWS = 10;

function formatRow(
  entry: LeaderboardEntry,
  contestant: Contestant | undefined,
): string {
  const flag = contestant?.flagEmoji ?? "?";
  const country = contestant?.country ?? entry.contestantId;
  const prefix =
    entry.rank >= 1 && entry.rank <= 3
      ? `${MEDALS[entry.rank - 1]} `
      : entry.rank.toString().padEnd(3, " ");
  return `${prefix}${flag} ${country} — ${entry.totalPoints} pts`;
}

/**
 * SPEC §12.2 text summary. Pure — no I/O, caller supplies rendered locale
 * labels + share URL. Top 10 only (rooms with fewer contestants render the
 * full list).
 */
export function formatRoomSummary(input: RoomSummaryInput): string {
  const contestantById = new Map<string, Contestant>(
    input.contestants.map((c) => [c.id, c]),
  );

  const topRows = input.leaderboard
    .slice(0, MAX_ROWS)
    .map((e) => formatRow(e, contestantById.get(e.contestantId)));

  const lines: string[] = [];
  lines.push(`🇪🇺 ${input.labels.eventTitle(input.year, input.event)}`);
  lines.push(input.labels.topLine);
  lines.push(...topRows);

  if (input.bets && input.bets.rows.length > 0) {
    lines.push("");
    lines.push(input.bets.headerLine);
    for (const row of input.bets.rows) {
      lines.push(`${row.symbol} ${row.question}`);
    }
  }

  lines.push("");
  lines.push(`${input.labels.fullResults}: ${input.shareUrl}`);

  return lines.join("\n");
}
