/**
 * SPEC §10.2.1 — predicate for the advance-time presence check.
 *
 * A user is "absent" if they have never heartbeated (NULL) or if their
 * last heartbeat is older than the threshold. Default threshold is 30 s
 * to match the spec ("last seen ≤30 s"); 30 s exactly counts as present
 * (boundary is inclusive on the present side).
 *
 * Pure — no Supabase / Date-now dependency. Caller passes `now` explicitly
 * so tests are deterministic and so cascade loops can use a single
 * snapshot of "now" across multiple checks.
 */
export function isAbsent(
  lastSeenAt: string | null,
  now: Date,
  thresholdMs = 30_000,
): boolean {
  if (!lastSeenAt) return true;
  const seenMs = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seenMs)) return true;
  return now.getTime() - seenMs > thresholdMs;
}
