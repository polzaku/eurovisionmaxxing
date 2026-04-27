# Screen wake lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the screen awake during voting via the Web Wake Lock API, with auto-recovery on `visibilitychange`.

**Architecture:** A `WakeLockController` class (DI-friendly, mocks-injectable) handles the Wake Lock API state machine. A thin `useWakeLock` React hook owns the controller's lifecycle. `VotingView` calls `useWakeLock(true)` once.

**Tech Stack:** TypeScript, React, vitest. Web Wake Lock API. Same DI pattern as [src/lib/voting/MissedUndoController.ts](src/lib/voting/MissedUndoController.ts) + [src/hooks/useMissedUndo.ts](src/hooks/useMissedUndo.ts).

Spec: [docs/superpowers/specs/2026-04-27-screen-wake-lock-design.md](docs/superpowers/specs/2026-04-27-screen-wake-lock-design.md)

---

## Task 1: WakeLockController — happy path acquisition

**Files:**
- Create: `src/lib/wakeLock/WakeLockController.ts`
- Test: `src/lib/wakeLock/WakeLockController.test.ts`

This task establishes the test harness (FakeWakeLock + fakeDocument) and ships the minimal class needed for tests 1–3 (unsupported, supported+visible, idempotent acquisition).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/wakeLock/WakeLockController.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/wakeLock/WakeLockController.test.ts`
Expected: FAIL — `Cannot find module './WakeLockController'`

- [ ] **Step 3: Write minimal implementation (passes tests 1–3 only)**

Create `src/lib/wakeLock/WakeLockController.ts`:

```ts
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
      opts?.navigator ?? (typeof navigator !== "undefined" ? (navigator as unknown as NavigatorLike) : undefined);
    this.api = nav?.wakeLock;
    this.doc =
      opts?.document ?? (typeof document !== "undefined" ? (document as unknown as DocumentLike) : undefined);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/wakeLock/WakeLockController.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wakeLock/WakeLockController.ts src/lib/wakeLock/WakeLockController.test.ts
git commit -m "feat(wakeLock): WakeLockController + acquisition tests

Establishes the controller's request/release lifecycle via injected
navigator + document stubs. Covers: unsupported no-op, single
acquisition, idempotent setActive(true). SPEC §8.9."
```

---

## Task 2: Release on deactivate

**Files:**
- Modify: `src/lib/wakeLock/WakeLockController.test.ts`

The implementation already supports release on `setActive(false)`, but we need a test asserting it.

- [ ] **Step 1: Append the failing test**

Add inside the `describe("WakeLockController", ...)` block in `WakeLockController.test.ts`, after the existing tests:

```ts
  it("releases sentinel on setActive(false)", async () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    const s = api.resolveNext();
    await flush();
    expect(s.released).toBe(false);
    ctrl.setActive(false);
    expect(s.releaseCalls).toBe(1);
    expect(s.released).toBe(true);
    ctrl.dispose();
  });
```

- [ ] **Step 2: Run tests to verify the new test passes**

Run: `npx vitest run src/lib/wakeLock/WakeLockController.test.ts`
Expected: PASS — 4 tests passed.

(Implementation already supports this path via `releaseHeld()` — no code change needed.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/wakeLock/WakeLockController.test.ts
git commit -m "test(wakeLock): cover release-on-deactivate path"
```

---

## Task 3: Browser-released sentinel + visibility re-acquire

**Files:**
- Modify: `src/lib/wakeLock/WakeLockController.test.ts`

Cover SPEC §8.9 bullets: "If the lock is released by the browser ... re-acquire automatically on visibilitychange → visible."

- [ ] **Step 1: Append the failing tests**

Add inside the `describe` block:

```ts
  it("does not immediately re-request when sentinel auto-releases", async () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    const s = api.resolveNext();
    await flush();
    s.fireRelease();
    await flush();
    expect(api.requestCalls).toBe(1);
    ctrl.dispose();
  });

  it("re-acquires when visibility returns to visible", async () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    const s1 = api.resolveNext();
    await flush();
    s1.fireRelease();
    doc.fireVisibility("hidden");
    doc.fireVisibility("visible");
    await flush();
    expect(api.requestCalls).toBe(2);
    api.resolveNext();
    ctrl.dispose();
  });

  it("defers acquisition until visible when started hidden", async () => {
    const hiddenDoc = makeFakeDocument("hidden");
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: hiddenDoc as unknown as Document,
    });
    ctrl.setActive(true);
    expect(api.requestCalls).toBe(0);
    hiddenDoc.fireVisibility("visible");
    expect(api.requestCalls).toBe(1);
    api.resolveNext();
    ctrl.dispose();
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/wakeLock/WakeLockController.test.ts`
Expected: PASS — 7 tests passed.

(Implementation already supports these paths.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/wakeLock/WakeLockController.test.ts
git commit -m "test(wakeLock): cover browser auto-release + visibility re-acquire"
```

---

## Task 4: In-flight request + concurrent setActive(false)

**Files:**
- Modify: `src/lib/wakeLock/WakeLockController.test.ts`

Cover the race: caller sets active → setActive(false) before the Promise resolves. The resolved sentinel must be released, not held.

- [ ] **Step 1: Append the failing test**

Add inside the `describe` block:

```ts
  it("releases sentinel that resolves after setActive(false)", async () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    expect(api.requestCalls).toBe(1);
    ctrl.setActive(false);
    const s = api.resolveNext();
    await flush();
    expect(s.releaseCalls).toBe(1);
    ctrl.dispose();
  });
```

- [ ] **Step 2: Run tests to verify it passes**

Run: `npx vitest run src/lib/wakeLock/WakeLockController.test.ts`
Expected: PASS — 8 tests passed.

(Implementation already supports this path — when the request resolves and `desired` is false, the resolved sentinel is released immediately.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/wakeLock/WakeLockController.test.ts
git commit -m "test(wakeLock): cover in-flight request + deactivate race"
```

---

## Task 5: dispose() cleans up listeners and is idempotent

**Files:**
- Modify: `src/lib/wakeLock/WakeLockController.test.ts`

- [ ] **Step 1: Append the failing tests**

Add inside the `describe` block:

```ts
  it("dispose() removes the visibility listener and stops further activity", async () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    const s = api.resolveNext();
    await flush();
    expect(doc.listenerCount()).toBe(1);
    ctrl.dispose();
    expect(s.releaseCalls).toBe(1);
    expect(doc.listenerCount()).toBe(0);
    ctrl.setActive(true);
    expect(api.requestCalls).toBe(1);
  });

  it("dispose() is idempotent", () => {
    const ctrl = new WakeLockController({
      navigator: { wakeLock: api },
      document: doc as unknown as Document,
    });
    ctrl.setActive(true);
    api.resolveNext();
    ctrl.dispose();
    expect(() => ctrl.dispose()).not.toThrow();
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/wakeLock/WakeLockController.test.ts`
Expected: PASS — 10 tests passed.

(Implementation already supports both paths.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/wakeLock/WakeLockController.test.ts
git commit -m "test(wakeLock): cover dispose listener cleanup + idempotency"
```

---

## Task 6: `useWakeLock` hook

**Files:**
- Create: `src/hooks/useWakeLock.ts`

No test file — voting hooks in this codebase are validated by manual smoke + the controller's unit tests. Pattern matches `useMissedUndo.ts` (untested itself; controller bears the weight).

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useWakeLock.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import { WakeLockController } from "@/lib/wakeLock/WakeLockController";

/**
 * Keeps the screen awake while `active` is true.
 * On unmount, releases the sentinel and removes listeners.
 * Silently no-ops on browsers without Web Wake Lock support.
 *
 * SPEC §8.9.
 */
export function useWakeLock(active: boolean): void {
  const ctrlRef = useRef<WakeLockController | null>(null);

  useEffect(() => {
    const ctrl = new WakeLockController();
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    ctrlRef.current?.setActive(active);
  }, [active]);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWakeLock.ts
git commit -m "feat(wakeLock): useWakeLock hook

Thin React lifecycle wrapper around WakeLockController. Mounts the
controller, calls setActive(active) on prop changes, disposes on
unmount."
```

---

## Task 7: Wire into `VotingView`

**Files:**
- Modify: `src/components/voting/VotingView.tsx`

- [ ] **Step 1: Add import + hook call**

In `src/components/voting/VotingView.tsx`, add the import beside the existing `@/hooks/useMissedUndo` import:

```ts
import { useWakeLock } from "@/hooks/useWakeLock";
```

Inside the component body, immediately after the `useTranslations` call (so it sits with the other hooks above any `useMemo`s and well before any conditional returns), add:

```ts
  useWakeLock(true);
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS — existing tests green plus 10 new WakeLockController tests.

- [ ] **Step 4: Commit**

```bash
git add src/components/voting/VotingView.tsx
git commit -m "feat(voting): hold screen wake lock while voting

VotingView is mounted only during rooms.status === 'voting' (and will
extend to 'voting_ending' when R4 lands), so a single useWakeLock(true)
call covers SPEC §8.9 bullet 1. Sentinel is released on unmount."
```

---

## Task 8: Verification + ship

- [ ] **Step 1: Final type-check + tests + lint**

Run: `npm run type-check && npx vitest run && npm run lint`
Expected: type-check exit 0, tests all green (10 new wake-lock tests), lint clean (or unchanged from main's baseline).

- [ ] **Step 2: Manual dev-server smoke**

```bash
npm run dev
```

Open `/room/[id]` while voting. In Chrome devtools → Application → "Wake Locks" panel, confirm a `screen` wake lock is active. Switch tabs (lock should auto-release per browser); switch back; confirm a new sentinel appears within ~50ms (the visibility-handler re-acquire path). Navigate back to lobby/results; confirm the lock is released.

If devtools "Wake Locks" panel is unavailable, the indirect smoke is: leave the voting tab open with system display-sleep set short (System Settings → Lock Screen → 1 minute on macOS) and confirm the screen does not lock while the tab is foregrounded.

- [ ] **Step 3: Update TODO.md**

In `/Users/valeriiakulynych/Projects/eurovisionmaxxing/TODO.md`, find the line under Phase R3:

```
- [ ] §8.9 screen wake lock — `navigator.wakeLock.request('screen')` on voting + present, re-acquire on `visibilitychange`, release on unmount
```

Change it to:

```
- [~] §8.9 screen wake lock — `navigator.wakeLock.request('screen')` on voting + present, re-acquire on `visibilitychange`, release on unmount  _(voting view shipped on `feat/voting-wake-lock`: `WakeLockController` + `useWakeLock` + `VotingView` wire-in. Present-screen wake lock follows when /present route lands in Phase 5c.)_
```

Note: `[~]` (partial), not `[x]` — present-screen scope still pending.

(TODO.md is gitignored, so no commit needed.)

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feat/voting-wake-lock
gh pr create --title "feat(voting): screen wake lock (SPEC §8.9, voting view)" --body "$(cat <<'EOF'
## Summary
- New \`WakeLockController\` class wraps \`navigator.wakeLock\`: feature-detected, idempotent, handles browser auto-release + \`visibilitychange\` re-acquire.
- New \`useWakeLock(active)\` hook owns lifecycle for one component.
- Wired into \`VotingView\` — single \`useWakeLock(true)\` call. \`VotingView\` is mounted only during \`rooms.status = 'voting'\`, so mount/unmount maps directly to SPEC §8.9 bullet 1.
- 10 controller unit tests covering: unsupported no-op, acquisition, idempotency, release, browser auto-release, visibility re-acquire, in-flight + deactivate race, dispose cleanup + idempotency.

Closes the biggest user-facing UX bug for live voting: phones currently lock every ~30s during the 3-hour show. Doesn't tick a §20 box yet (#10 is /present-scoped) but removes the dominant defect during the dominant phase of the show (~85% of show duration is voting).

Spec: [docs/superpowers/specs/2026-04-27-screen-wake-lock-design.md](docs/superpowers/specs/2026-04-27-screen-wake-lock-design.md)
Plan: [docs/superpowers/plans/2026-04-27-screen-wake-lock.md](docs/superpowers/plans/2026-04-27-screen-wake-lock.md)
TODO: Phase R3 §8.9 (partial — voting view only; /present follows in Phase 5c)

## Verification
- ✅ \`npm run type-check\` clean
- ✅ \`npx vitest run\` — all green incl. 10 new controller tests
- ✅ \`npm run lint\` — no new warnings

## Test plan (manual smoke)
- [ ] Devtools → Application → Wake Locks shows \`screen\` lock during voting
- [ ] Switch tabs → re-focus → new sentinel acquired within ~50ms
- [ ] Status transitions out of voting → lock released

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

- **Spec coverage:**
  - SPEC §8.9 bullet 1 (voting view acquire/release) → Task 7
  - SPEC §8.9 bullet 2 (present screen) → out of scope, tracked in TODO §8.9 partial-tick
  - SPEC §8.9 bullet 3 (`navigator.wakeLock.request('screen')` + feature-detect + silent no-op) → Task 1 (test 1) + controller `if (!this.api) return;`
  - SPEC §8.9 bullet 4 (auto-released → re-acquire on `visibilitychange`) → Task 3
  - SPEC §8.9 bullet 5 (never on idle phases) → handled by component-level mount gating; VotingView itself is not rendered during lobby/results
  - SPEC §8.9 bullet 6 (no toggle in MVP) → no toggle UI is built
- **Placeholder scan:** No TBDs. All test code, types, methods spelled out.
- **Type consistency:** `WakeLockSentinelLike`, `WakeLockApiLike`, `WakeLockController` interfaces are stable across Tasks 1, 6, 7. The hook signature `useWakeLock(active: boolean): void` is consistent with the wire-in.
- **Risk:** "Wake Locks" panel may not exist in older Chrome versions — manual smoke step has a fallback (system display-sleep timer test). The `useEffect`-with-`useRef` pattern in the hook matches `useMissedUndo` exactly; reviewers familiar with that file will recognize it instantly.
