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
  missed?: boolean;
  hotTake?: string | null;
}

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Per-contestant debounced autosave coordinator.
 * See docs/superpowers/specs/2026-04-24-voting-autosave-design.md §4,
 * docs/superpowers/specs/2026-04-25-i-missed-this-design.md §4 (PR1),
 * and docs/superpowers/specs/2026-04-26-hot-take-design.md §4 (PR1).
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
    this.setTimeoutFn =
      deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutFn =
      deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
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
    this.pending.set(contestantId, {
      timerId,
      scores: nextScores,
      missed: existing?.missed,
      hotTake: existing?.hotTake,
    });
    this.emitStatus();
  }

  scheduleMissed(contestantId: string, missed: boolean): void {
    if (this.disposed) return;
    this.hasWritten = true;
    const existing = this.pending.get(contestantId);
    if (existing) this.clearTimeoutFn(existing.timerId);
    const timerId = this.setTimeoutFn(
      () => this.flushContestant(contestantId),
      this.debounceMs
    );
    this.pending.set(contestantId, {
      timerId,
      scores: existing?.scores ?? {},
      missed,
      hotTake: existing?.hotTake,
    });
    this.emitStatus();
  }

  scheduleHotTake(contestantId: string, hotTake: string | null): void {
    if (this.disposed) return;
    this.hasWritten = true;
    const existing = this.pending.get(contestantId);
    if (existing) this.clearTimeoutFn(existing.timerId);
    const timerId = this.setTimeoutFn(
      () => this.flushContestant(contestantId),
      this.debounceMs
    );
    this.pending.set(contestantId, {
      timerId,
      scores: existing?.scores ?? {},
      missed: existing?.missed,
      hotTake,
    });
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
      const payload: PostVoteInput = {
        roomId: this.roomId,
        userId: this.userId,
        contestantId,
      };
      if (Object.keys(entry.scores).length > 0) payload.scores = entry.scores;
      if (entry.missed !== undefined) payload.missed = entry.missed;
      if (entry.hotTake !== undefined) payload.hotTake = entry.hotTake;
      const result = await this.deps.post(payload);
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
