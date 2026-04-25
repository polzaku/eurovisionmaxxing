import type { PostVoteInput } from "@/lib/voting/postVote";

export interface QueueEntry {
  id: string;
  timestamp: number;
  payload: PostVoteInput;
}

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const QUEUE_STORAGE_KEY = "emx_offline_queue";

export function loadQueue(
  storage: QueueStorage | null | undefined
): QueueEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(
  storage: QueueStorage | null | undefined,
  entries: QueueEntry[]
): void {
  if (!storage) return;
  try {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Silent — offline-queue persistence is a progressive enhancement.
  }
}

export function appendToQueue(
  storage: QueueStorage | null | undefined,
  entry: QueueEntry
): QueueEntry[] {
  const next = [...loadQueue(storage), entry];
  saveQueue(storage, next);
  return next;
}

export function shiftFromQueue(
  storage: QueueStorage | null | undefined
): { head: QueueEntry | undefined; rest: QueueEntry[] } {
  const current = loadQueue(storage);
  if (current.length === 0) {
    return { head: undefined, rest: [] };
  }
  const [head, ...rest] = current;
  saveQueue(storage, rest);
  return { head, rest };
}
