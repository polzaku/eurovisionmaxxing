import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import {
  loadQueue,
  appendToQueue,
  shiftFromQueue,
  type QueueEntry,
  type QueueStorage,
} from "@/lib/voting/offlineQueue";

export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
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
  /** Polling interval (ms) — drain attempted on a timer while queue is non-empty as a belt-and-suspenders fallback. Default 10000. Pass 0 to disable. */
  pollIntervalMs?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
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

/**
 * Wraps the real postVote with offline-awareness.
 * See docs/superpowers/specs/2026-04-24-voting-offline-queue-design.md §5.
 */
const DEFAULT_POLL_INTERVAL_MS = 10_000;

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
  private pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private queueSize: number;
  private draining = false;
  private disposed = false;

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
    const addListener = deps.addOnlineListener ?? defaultAddOnlineListener;
    this.removeOnlineListener = addListener(() => {
      void this.drain();
    });
    this.queueSize = loadQueue(this.storage).length;
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
    const next = appendToQueue(this.storage, entry);
    this.queueSize = next.length;
    this.startPolling();
    this.emitState();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    if (!this.isOnlineFn()) return;
    this.draining = true;
    try {
      while (!this.disposed && this.isOnlineFn()) {
        const current = loadQueue(this.storage);
        if (current.length === 0) break;
        const head = current[0];
        let drop = false;
        try {
          const result = await this.realPost(head.payload);
          // Both ok:true and ok:false drop the entry. 4xx/5xx retries
          // won't help; PR 3 will revisit with conflict reconciliation.
          drop = true;
          void result;
        } catch {
          break;
        }
        if (drop) {
          const { rest } = shiftFromQueue(this.storage);
          this.queueSize = rest.length;
          this.emitState();
        }
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
    });
  }
}
