import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import {
  loadQueue,
  appendToQueue,
  saveQueue,
  shiftFromQueue,
  type QueueEntry,
  type QueueStorage,
} from "@/lib/voting/offlineQueue";
import {
  partitionByConflict,
  makeServerStateKey,
  type SkippedEntry,
} from "@/lib/voting/conflictCheck";

export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
  overflowed: boolean;
}

export interface DrainNotice {
  skipped: SkippedEntry[];
  votingEndedRoomIds: string[];
}

export interface OfflineAdapterDeps {
  realPost: (p: PostVoteInput) => Promise<PostVoteResult>;
  storage: QueueStorage | null;
  onStateChange: (state: OfflineAdapterState) => void;
  isOnline?: () => boolean;
  /** Listener for `online` event, window focus, visibility-becomes-visible — all are drain triggers. */
  addOnlineListener?: (cb: () => void) => () => void;
  now?: () => number;
  uuid?: () => string;
  /** Polling interval (ms). Default 10000. Pass 0 to disable. */
  pollIntervalMs?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  /** Fetches server's current votes for one (roomId, userId) — used at drain start to detect conflicts. Optional for back-compat. */
  fetchServerVotes?: (
    roomId: string,
    userId: string
  ) => Promise<{ contestantId: string; updatedAt: string }[]>;
  /** Max queue size before FIFO eviction. Default 200. */
  maxQueueSize?: number;
  /** Fired when a drain completes with skipped entries OR a voting-ended abort. */
  onDrainComplete?: (notice: DrainNotice) => void;
}

const defaultIsOnline = (): boolean =>
  typeof navigator === "undefined" ? true : navigator.onLine;

/**
 * Registers a callback for "something might have changed; try draining now"
 * triggers: the `online` event, window `focus`, and document
 * `visibilitychange` (back to visible). DevTools "Offline" toggle doesn't
 * always fire `online` reliably, so we layer multiple events.
 */
const defaultAddOnlineListener = (cb: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const onlineHandler = () => cb();
  const focusHandler = () => cb();
  const visHandler = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      cb();
    }
  };
  window.addEventListener("online", onlineHandler);
  window.addEventListener("focus", focusHandler);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", visHandler);
  }
  return () => {
    window.removeEventListener("online", onlineHandler);
    window.removeEventListener("focus", focusHandler);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", visHandler);
    }
  };
};

const defaultUuid = (): string => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_QUEUE_SIZE = 200;

function uniqueRoomUserPairs(
  entries: readonly QueueEntry[]
): Array<[string, string]> {
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const e of entries) {
    const key = `${e.payload.roomId}::${e.payload.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([e.payload.roomId, e.payload.userId]);
  }
  return pairs;
}

/**
 * Wraps the real postVote with offline-awareness, conflict detection,
 * 200-entry cap, and voting-ended abort.
 *
 * See docs/superpowers/specs/2026-04-25-voting-offline-conflicts-design.md
 * (PR 3) and docs/superpowers/specs/2026-04-24-voting-offline-queue-design.md
 * (PR 2) for the full design.
 */
export class OfflineAdapter {
  private readonly realPost: OfflineAdapterDeps["realPost"];
  private readonly storage: QueueStorage | null;
  private readonly onStateChange: (s: OfflineAdapterState) => void;
  private readonly isOnlineFn: () => boolean;
  private readonly nowFn: () => number;
  private readonly uuidFn: () => string;
  private readonly removeOnlineListener: () => void;
  private readonly setIntervalFn: typeof globalThis.setInterval;
  private readonly clearIntervalFn: typeof globalThis.clearInterval;
  private readonly pollIntervalMs: number;
  private readonly fetchServerVotes:
    | ((
        roomId: string,
        userId: string
      ) => Promise<{ contestantId: string; updatedAt: string }[]>)
    | null;
  private readonly maxQueueSize: number;
  private readonly onDrainComplete: ((notice: DrainNotice) => void) | null;
  private pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private queueSize: number;
  private draining = false;
  private disposed = false;
  private overflowed = false;

  constructor(deps: OfflineAdapterDeps) {
    this.realPost = deps.realPost;
    this.storage = deps.storage;
    this.onStateChange = deps.onStateChange;
    this.isOnlineFn = deps.isOnline ?? defaultIsOnline;
    this.nowFn = deps.now ?? (() => Date.now());
    this.uuidFn = deps.uuid ?? defaultUuid;
    this.setIntervalFn =
      deps.setInterval ?? globalThis.setInterval.bind(globalThis);
    this.clearIntervalFn =
      deps.clearInterval ?? globalThis.clearInterval.bind(globalThis);
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.fetchServerVotes = deps.fetchServerVotes ?? null;
    this.maxQueueSize = deps.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.onDrainComplete = deps.onDrainComplete ?? null;
    const addListener = deps.addOnlineListener ?? defaultAddOnlineListener;
    this.removeOnlineListener = addListener(() => {
      void this.drain();
    });
    this.queueSize = loadQueue(this.storage).length;
    if (this.queueSize > this.maxQueueSize) this.overflowed = true;
    this.emitState();
    if (this.queueSize > 0) {
      void this.drain();
      this.startPolling();
    }
  }

  async post(payload: PostVoteInput): Promise<PostVoteResult> {
    if (this.disposed) {
      return { ok: true, data: { vote: {}, scoredCount: 0 } };
    }

    // Offline OR queue non-empty → route through queue so writes stay ordered.
    if (!this.isOnlineFn() || this.queueSize > 0) {
      this.enqueue(payload);
      void this.drain();
      return { ok: true, data: { vote: {}, scoredCount: 0 } };
    }

    // Online + empty queue — try a direct post.
    try {
      return await this.realPost(payload);
    } catch {
      this.enqueue(payload);
      return { ok: true, data: { vote: {}, scoredCount: 0 } };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.removeOnlineListener();
    this.stopPolling();
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    if (this.pollIntervalMs <= 0) return;
    this.pollTimer = this.setIntervalFn(() => {
      if (this.queueSize === 0 || this.disposed) {
        this.stopPolling();
        return;
      }
      if (this.isOnlineFn()) {
        void this.drain();
      }
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      this.clearIntervalFn(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private enqueue(payload: PostVoteInput): void {
    const entry: QueueEntry = {
      id: this.uuidFn(),
      timestamp: this.nowFn(),
      payload,
    };
    let next = appendToQueue(this.storage, entry);
    while (next.length > this.maxQueueSize) {
      const { rest } = shiftFromQueue(this.storage);
      next = rest;
      this.overflowed = true;
    }
    this.queueSize = next.length;
    this.startPolling();
    this.emitState();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    if (!this.isOnlineFn()) return;
    this.draining = true;
    let skipped: SkippedEntry[] = [];
    const votingEndedRoomIds = new Set<string>();
    try {
      // Phase 1: pre-drain conflict fetch (best effort)
      const all = loadQueue(this.storage);
      if (all.length === 0) return;
      const serverState = new Map<string, string>();
      if (this.fetchServerVotes) {
        const pairs = uniqueRoomUserPairs(all);
        for (const [roomId, userId] of pairs) {
          let votes: { contestantId: string; updatedAt: string }[];
          try {
            votes = await this.fetchServerVotes(roomId, userId);
          } catch {
            // Pre-drain fetch failed — abort entire drain; poll will retry.
            return;
          }
          for (const v of votes) {
            serverState.set(
              makeServerStateKey(roomId, v.contestantId),
              v.updatedAt
            );
          }
        }
      }
      const partition = partitionByConflict(all, serverState);
      skipped = partition.skipped;
      saveQueue(this.storage, partition.drainable);
      this.queueSize = partition.drainable.length;
      this.emitState();

      // Phase 2: drain drainable entries, watching for 409 ROOM_NOT_VOTING
      while (!this.disposed && this.isOnlineFn()) {
        const current = loadQueue(this.storage);
        if (current.length === 0) break;
        const head = current[0];

        if (votingEndedRoomIds.has(head.payload.roomId)) {
          // Drop without POSTing.
          const remaining = current.filter(
            (e) => e.payload.roomId !== head.payload.roomId
          );
          saveQueue(this.storage, remaining);
          this.queueSize = remaining.length;
          this.emitState();
          continue;
        }

        let result: PostVoteResult;
        try {
          result = await this.realPost(head.payload);
        } catch {
          // Network error during drain — stop, polling will retry.
          break;
        }

        if (!result.ok && result.code === "ROOM_NOT_VOTING") {
          votingEndedRoomIds.add(head.payload.roomId);
          const remaining = current.filter(
            (e) => e.payload.roomId !== head.payload.roomId
          );
          saveQueue(this.storage, remaining);
          this.queueSize = remaining.length;
          this.emitState();
          continue;
        }

        // Both ok:true and ok:false (other 4xx/5xx) drop the head entry.
        if (result.ok && result.data) {
          // Update server-state map for subsequent same-row entries.
          const v = (result.data.vote as { updatedAt?: string } | undefined) ?? undefined;
          if (v?.updatedAt) {
            serverState.set(
              makeServerStateKey(head.payload.roomId, head.payload.contestantId),
              v.updatedAt
            );
          }
        }
        const { rest } = shiftFromQueue(this.storage);
        this.queueSize = rest.length;
        this.emitState();
      }

      // Phase 3: emit consolidated notice if anything happened
      if (skipped.length > 0 || votingEndedRoomIds.size > 0) {
        this.onDrainComplete?.({
          skipped,
          votingEndedRoomIds: Array.from(votingEndedRoomIds),
        });
      }

      // Clear overflowed sticky flag if queue is back below the cap
      if (this.overflowed && this.queueSize < this.maxQueueSize) {
        this.overflowed = false;
        this.emitState();
      }
    } finally {
      this.draining = false;
      if (this.queueSize === 0) {
        this.stopPolling();
      }
    }
  }

  private emitState(): void {
    if (this.disposed) return;
    this.onStateChange({
      online: this.isOnlineFn(),
      queueSize: this.queueSize,
      overflowed: this.overflowed,
    });
  }
}
