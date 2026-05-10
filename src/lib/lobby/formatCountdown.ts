/**
 * SPEC §6.6.1 — format a millisecond delta as a Eurovision-style countdown.
 *
 * - Returns `DD:HH:MM:SS` (zero-padded each segment) when delta > 0 and
 *   includes 1+ full days.
 * - Returns `HH:MM:SS` when delta is positive but < 1 day.
 * - Returns null when the target is at or before now (caller renders the
 *   "Ready whenever you are." fallback in that case).
 *
 * Pure — no Date.now() or Intl dependency. Caller passes both timestamps
 * so tests can drive deterministic boundaries.
 */
export function formatCountdown(
  targetMs: number,
  nowMs: number,
): string | null {
  const diff = targetMs - nowMs;
  if (diff <= 0) return null;
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) {
    return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
