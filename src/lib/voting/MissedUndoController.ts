export interface MissedUndoToast {
  contestantId: string;
  projectedOverall: number;
}

export interface MissedUndoControllerDeps {
  onUndo: (contestantId: string) => void;
  onChange: (toast: MissedUndoToast | null) => void;
  ttlMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

const DEFAULT_TTL_MS = 5000;

/**
 * Holds the active "marked missed" toast for the voting view.
 * Manages the auto-dismiss timer and the undo callback.
 *
 * See docs/superpowers/specs/2026-04-25-i-missed-this-design.md §4 PR3.
 */
export class MissedUndoController {
  private toast: MissedUndoToast | null = null;
  private timerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private disposed = false;
  private readonly ttlMs: number;
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;

  constructor(private readonly deps: MissedUndoControllerDeps) {
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.setTimeoutFn =
      deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutFn =
      deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  }

  get current(): MissedUndoToast | null {
    return this.toast;
  }

  trigger(contestantId: string, projectedOverall: number): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.toast = { contestantId, projectedOverall };
    this.deps.onChange(this.toast);
    this.timerId = this.setTimeoutFn(() => this.expire(), this.ttlMs);
  }

  undo(): void {
    if (this.disposed) return;
    if (!this.toast) return;
    const id = this.toast.contestantId;
    this.clear();
    this.deps.onUndo(id);
  }

  dismiss(): void {
    if (this.disposed) return;
    if (!this.toast) return;
    this.clear();
  }

  dispose(): void {
    this.cancelTimer();
    this.toast = null;
    this.disposed = true;
  }

  private expire(): void {
    if (this.disposed) return;
    this.toast = null;
    this.timerId = null;
    this.deps.onChange(null);
  }

  private clear(): void {
    this.cancelTimer();
    this.toast = null;
    this.deps.onChange(null);
  }

  private cancelTimer(): void {
    if (this.timerId !== null) {
      this.clearTimeoutFn(this.timerId);
      this.timerId = null;
    }
  }
}
