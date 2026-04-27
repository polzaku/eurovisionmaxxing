import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WakeLockController,
  type WakeLockApiLike,
  type WakeLockSentinelLike,
} from "./WakeLockController";

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  releaseCalls = 0;
  releaseListeners = new Set<() => void>();
  async release() {
    this.releaseCalls += 1;
    this.released = true;
  }
  addEventListener(type: "release", listener: () => void) {
    if (type === "release") this.releaseListeners.add(listener);
  }
  removeEventListener(type: "release", listener: () => void) {
    if (type === "release") this.releaseListeners.delete(listener);
  }
  fireRelease() {
    this.released = true;
    for (const l of this.releaseListeners) l();
  }
}

class FakeWakeLock implements WakeLockApiLike {
  requestCalls = 0;
  pending: Array<(s: FakeSentinel) => void> = [];
  sentinels: FakeSentinel[] = [];
  request(type: "screen") {
    expect(type).toBe("screen");
    this.requestCalls += 1;
    return new Promise<FakeSentinel>((resolve) => {
      this.pending.push((s) => {
        this.sentinels.push(s);
        resolve(s);
      });
    });
  }
  resolveNext(): FakeSentinel {
    const fn = this.pending.shift();
    if (!fn) throw new Error("no pending request");
    const s = new FakeSentinel();
    fn(s);
    return s;
  }
}

interface FakeDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fireVisibility(next: DocumentVisibilityState): void;
  listenerCount(): number;
}

function makeFakeDocument(initial: DocumentVisibilityState = "visible"): FakeDocument {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const addEventListener = vi.fn((type: string, l: EventListener) => {
    if (type === "visibilitychange") listeners.add(l);
  });
  const removeEventListener = vi.fn((type: string, l: EventListener) => {
    if (type === "visibilitychange") listeners.delete(l);
  });
  let visibilityState = initial;
  return {
    get visibilityState() {
      return visibilityState;
    },
    set visibilityState(v) {
      visibilityState = v;
    },
    addEventListener,
    removeEventListener,
    fireVisibility(next) {
      visibilityState = next;
      for (const l of listeners) {
        if (typeof l === "function") l(new Event("visibilitychange"));
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("WakeLockController", () => {
  let api: FakeWakeLock;
  let doc: FakeDocument;

  beforeEach(() => {
    api = new FakeWakeLock();
    doc = makeFakeDocument("visible");
  });

  it("no-ops when navigator has no wakeLock support", async () => {
    const ctrl = new WakeLockController({
      navigator: {},
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    await flush();
    ctrl.setActive(false);
    expect(api.requestCalls).toBe(0);
    expect(doc.listenerCount()).toBe(0);
  });

  it("requests one sentinel when active and visible", async () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    expect(api.requestCalls).toBe(1);
    api.resolveNext();
    await flush();
    expect(api.sentinels.length).toBe(1);
    expect(api.sentinels[0].released).toBe(false);
    ctrl.dispose();
  });

  it("does not double-request when setActive(true) is called twice", async () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    ctrl.setActive(true);
    expect(api.requestCalls).toBe(1);
    ctrl.dispose();
  });
});
