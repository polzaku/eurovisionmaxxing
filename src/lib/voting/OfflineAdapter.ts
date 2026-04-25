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
  addOnlineListener?: (cb: () => void) => () => void;
  now?: () => number;
  uuid?: () => string;
}

const defaultIsOnline = (): boolean =>
  typeof navigator === "undefined" ? true : navigator.onLine;

const defaultAddOnlineListener = (cb: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", cb);
  return () => window.removeEventListener("online", cb);
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
export class OfflineAdapter {
  private readonly realPost: OfflineAdapterDeps["realPost"];
  private readonly storage: QueueStorage | null;
  private readonly onStateChange: (s: OfflineAdapterState) => void;
  private readonly isOnlineFn: () => boolean;
  private readonly nowFn: () => number;
  private readonly uuidFn: () => string;
  private readonly removeOnlineListener: () => void;
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
    const addListener = deps.addOnlineListener ?? defaultAddOnlineListener;
    this.removeOnlineListener = addListener(() => {
      void this.drain();
    });
    this.queueSize = loadQueue(this.storage).length;
    this.emitState();
    if (this.queueSize > 0) {
      void this.drain();
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
  }

  private enqueue(payload: PostVoteInput): void {
    const entry: QueueEntry = {
      id: this.uuidFn(),
      timestamp: this.nowFn(),
      payload,
    };
    const next = appendToQueue(this.storage, entry);
    this.queueSize = next.length;
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
