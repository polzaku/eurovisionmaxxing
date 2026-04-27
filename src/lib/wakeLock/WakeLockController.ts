export interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

export interface WakeLockApiLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

interface NavigatorLike {
  wakeLock?: WakeLockApiLike;
}

interface DocumentLike {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface WakeLockControllerOpts {
  navigator?: NavigatorLike;
  document?: DocumentLike;
}

export class WakeLockController {
  private readonly api: WakeLockApiLike | undefined;
  private readonly doc: DocumentLike | undefined;
  private desired = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private pendingRequest: Promise<WakeLockSentinelLike | null> | null = null;
  private readonly visibilityListener: EventListener;
  private readonly releaseListener: () => void;
  private listenerAttached = false;
  private disposed = false;

  constructor(opts?: WakeLockControllerOpts) {
    const nav: NavigatorLike | undefined =
      opts?.navigator ??
      (typeof navigator !== "undefined"
        ? (navigator as unknown as NavigatorLike)
        : undefined);
    this.api = nav?.wakeLock;
    this.doc =
      opts?.document ??
      (typeof document !== "undefined"
        ? (document as unknown as DocumentLike)
        : undefined);
    this.visibilityListener = () => {
      this.onVisibilityChange();
    };
    this.releaseListener = () => {
      this.onSentinelReleased();
    };
  }

  setActive(active: boolean): void {
    if (this.disposed) return;
    this.desired = active;
    if (active) {
      if (!this.api) return;
      this.attachVisibilityListener();
      this.tryAcquire();
    } else {
      this.detachVisibilityListener();
      this.releaseHeld();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.desired = false;
    this.detachVisibilityListener();
    this.releaseHeld();
  }

  private attachVisibilityListener(): void {
    if (this.listenerAttached || !this.doc) return;
    this.doc.addEventListener("visibilitychange", this.visibilityListener);
    this.listenerAttached = true;
  }

  private detachVisibilityListener(): void {
    if (!this.listenerAttached || !this.doc) return;
    this.doc.removeEventListener("visibilitychange", this.visibilityListener);
    this.listenerAttached = false;
  }

  private tryAcquire(): void {
    if (!this.api) return;
    if (this.sentinel || this.pendingRequest) return;
    if (this.doc && this.doc.visibilityState !== "visible") return;
    const promise = this.api.request("screen").then(
      (s) => {
        this.pendingRequest = null;
        if (!this.desired || this.disposed) {
          void s.release();
          return null;
        }
        this.sentinel = s;
        s.addEventListener("release", this.releaseListener);
        return s;
      },
      () => {
        this.pendingRequest = null;
        return null;
      }
    );
    this.pendingRequest = promise;
  }

  private releaseHeld(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (s) {
      s.removeEventListener("release", this.releaseListener);
      void s.release();
    }
  }

  private onSentinelReleased(): void {
    this.sentinel = null;
  }

  private onVisibilityChange(): void {
    if (!this.desired || this.disposed) return;
    if (this.doc?.visibilityState === "visible") this.tryAcquire();
  }
}
