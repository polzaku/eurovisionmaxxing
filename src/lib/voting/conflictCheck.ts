import type { QueueEntry } from "@/lib/voting/offlineQueue";

export interface SkippedEntry {
  entry: QueueEntry;
  reason: "server-newer";
}

export interface ConflictCheckResult {
  drainable: QueueEntry[];
  skipped: SkippedEntry[];
}

/**
 * Partitions queue entries into drainable and skipped. An entry is skipped
 * when the server has a newer `updatedAt` for the same `(roomId, contestantId)`
 * than the entry's `timestamp`.
 *
 * Server-state map keys are `${roomId}::${contestantId}` → ISO updatedAt.
 *
 * SPEC §8.5.1 — server-wins.
 *
 * Notes:
 * - Missing server state for a (room, contestant) → drainable (new-row case).
 * - Malformed server timestamp → drainable (defensive; don't block legit writes).
 * - Clock-skew tolerance: queue.timestamp is client clock, server.updatedAt is
 *   DB clock. A few seconds of skew can produce false-positive conflicts;
 *   acceptable trade-off (we drop a legit write, which the user can re-enter).
 */
export function partitionByConflict(
  entries: readonly QueueEntry[],
  serverState: ReadonlyMap<string, string>
): ConflictCheckResult {
  const drainable: QueueEntry[] = [];
  const skipped: SkippedEntry[] = [];
  for (const entry of entries) {
    const key = makeServerStateKey(
      entry.payload.roomId,
      entry.payload.contestantId
    );
    const serverUpdatedAt = serverState.get(key);
    if (!serverUpdatedAt) {
      drainable.push(entry);
      continue;
    }
    const serverMs = Date.parse(serverUpdatedAt);
    if (!Number.isFinite(serverMs)) {
      drainable.push(entry);
      continue;
    }
    if (serverMs > entry.timestamp) {
      skipped.push({ entry, reason: "server-newer" });
    } else {
      drainable.push(entry);
    }
  }
  return { drainable, skipped };
}

export function makeServerStateKey(
  roomId: string,
  contestantId: string
): string {
  return `${roomId}::${contestantId}`;
}
