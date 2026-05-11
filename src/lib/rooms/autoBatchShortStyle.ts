import type { AnnouncerResultRow } from "./advanceAnnouncement";

/**
 * SPEC §10.2.2: under announcement_style = 'short', when a turn begins
 * the server auto-reveals every points row except the 12-point pick
 * (rank = 1). This helper computes "which rows to auto-batch" — the
 * orchestrator does the UPDATE + broadcast.
 */
export function selectShortBatchRows(
  announcerRows: AnnouncerResultRow[],
): AnnouncerResultRow[] {
  return announcerRows.filter((r) => r.rank !== 1);
}

/**
 * Position of the rank-1 (12-point) row inside the announcer's queue,
 * sorted rank DESC so idx 0 = 1pt and idx 9 = 12pt. The orchestrator
 * sets current_announce_idx to this value after the auto-batch so the
 * next advance call reveals only the 12-point row.
 *
 * Returns null when no rank-1 row exists (degenerate; the orchestrator
 * handles it by skipping the auto-batch entirely).
 */
export function twelvePointIdx(
  announcerRows: AnnouncerResultRow[],
): number | null {
  const idx = announcerRows.findIndex((r) => r.rank === 1);
  return idx === -1 ? null : idx;
}
