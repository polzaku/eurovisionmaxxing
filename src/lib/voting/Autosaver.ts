import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaverDeps {
  onStatusChange: (status: SaveStatus) => void;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
  debounceMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

interface PendingEntry {
  timerId: ReturnType<typeof globalThis.setTimeout>;
  scores: Record<string, number | null>;
}

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Per-contestant debounced autosave coordinator.
 * See docs/superpowers/specs/2026-04-24-voting-autosave-design.md §4.
 */
export class Autosaver {
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;
  private readonly debounceMs: number;
  private readonly pending: Map<string, PendingEntry> = new Map();
  private inflight = 0;
  private hasWritten = false;
  private lastOutcome: "success" | "error" | null = null;
  private disposed = false;
  private lastStatusEmitted: SaveStatus = "idle";

  constructor(
    private readonly roomId: string,
    private readonly userId: string,
    private readonly deps: AutosaverDeps
  ) {
    this.setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout;
    this.clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout;
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  schedule(contestantId: string, categoryName: string, value: number | null): void {
    if (this.disposed) return;
    this.hasWritten = true;
    const existing = this.pending.get(contestantId);
    const nextScores = { ...(existing?.scores ?? {}), [categoryName]: value };
    if (existing) this.clearTimeoutFn(existing.timerId);
    const timerId = this.setTimeoutFn(
      () => this.flushContestant(contestantId),
      this.debounceMs
    );
    this.pending.set(contestantId, { timerId, scores: nextScores });
    this.emitStatus();
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) {
      this.clearTimeoutFn(entry.timerId);
    }
    this.pending.clear();
  }

  private async flushContestant(contestantId: string): Promise<void> {
    if (this.disposed) return;
    const entry = this.pending.get(contestantId);
    if (!entry) return;
    this.pending.delete(contestantId);
    this.inflight += 1;
    this.emitStatus();
    try {
      const result = await this.deps.post({
        roomId: this.roomId,
        userId: this.userId,
        contestantId,
        scores: entry.scores,
      });
      this.inflight -= 1;
      if (this.disposed) return;
      this.lastOutcome = result.ok ? "success" : "error";
    } catch {
      this.inflight -= 1;
      if (this.disposed) return;
      this.lastOutcome = "error";
    }
    this.emitStatus();
  }

  private deriveStatus(): SaveStatus {
    if (!this.hasWritten) return "idle";
    if (this.pending.size > 0 || this.inflight > 0) return "saving";
    if (this.lastOutcome === "error") return "error";
    return "saved";
  }

  private emitStatus(): void {
    if (this.disposed) return;
    const next = this.deriveStatus();
    if (next === this.lastStatusEmitted) return;
    this.lastStatusEmitted = next;
    this.deps.onStatusChange(next);
  }
}
