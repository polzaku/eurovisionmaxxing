# "I missed this" — PR 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the entrance UX for "I missed this": a bottom toast that appears when the user marks a contestant missed, auto-dismisses at 5s, and offers an Undo button that reverts the action.

**Architecture:** Splits the timer logic into a plain class (`MissedUndoController`) that's pure-testable with fake timers, plus a thin React hook (`useMissedUndo`) that wraps it. Mirrors the existing `Autosaver` (class) + `useVoteAutosave` (hook) pattern in this repo. The toast component is presentational only.

**Tech Stack:** TypeScript, React, vitest fake timers, Tailwind. No new deps.

**Spec:** `docs/superpowers/specs/2026-04-25-i-missed-this-design.md` §4 PR3.

**Predecessor:** PR2 must be merged or applied. PR2 leaves `setMissed` in `VotingView` already wired to autosave; PR3 only adds the toast layer above it.

---

### Task 1: `MissedUndoController` — pure class with TDD

**Files:**
- Create: `src/lib/voting/MissedUndoController.ts`
- Create: `src/lib/voting/MissedUndoController.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/voting/MissedUndoController.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MissedUndoController,
  type MissedUndoToast,
} from "@/lib/voting/MissedUndoController";

function setup() {
  const onUndo = vi.fn();
  const states: (MissedUndoToast | null)[] = [];
  const ctrl = new MissedUndoController({
    onUndo,
    onChange: (t) => states.push(t),
    ttlMs: 5000,
  });
  return { ctrl, onUndo, states };
}

describe("MissedUndoController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with no toast", () => {
    const { ctrl } = setup();
    expect(ctrl.current).toBeNull();
  });

  it("trigger sets toast and arms a timer that auto-clears at ttlMs", async () => {
    const { ctrl, states } = setup();
    ctrl.trigger("c1", 7);
    expect(ctrl.current).toEqual({ contestantId: "c1", projectedOverall: 7 });
    expect(states[states.length - 1]).toEqual({
      contestantId: "c1",
      projectedOverall: 7,
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(ctrl.current).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(ctrl.current).toBeNull();
    expect(states[states.length - 1]).toBeNull();
  });

  it("undo calls onUndo with the toast's contestantId and clears", () => {
    const { ctrl, onUndo } = setup();
    ctrl.trigger("c1", 7);
    ctrl.undo();
    expect(onUndo).toHaveBeenCalledWith("c1");
    expect(ctrl.current).toBeNull();
  });

  it("undo without an active toast is a no-op", () => {
    const { ctrl, onUndo } = setup();
    ctrl.undo();
    expect(onUndo).not.toHaveBeenCalled();
    expect(ctrl.current).toBeNull();
  });

  it("a second trigger replaces the toast and re-arms the timer", async () => {
    const { ctrl } = setup();
    ctrl.trigger("c1", 7);
    await vi.advanceTimersByTimeAsync(4000); // 1s of life left
    ctrl.trigger("c2", 8);
    expect(ctrl.current).toEqual({ contestantId: "c2", projectedOverall: 8 });

    await vi.advanceTimersByTimeAsync(4999);
    expect(ctrl.current).not.toBeNull(); // re-armed for full 5s
    await vi.advanceTimersByTimeAsync(1);
    expect(ctrl.current).toBeNull();
  });

  it("dismiss clears immediately without calling onUndo", () => {
    const { ctrl, onUndo } = setup();
    ctrl.trigger("c1", 7);
    ctrl.dismiss();
    expect(ctrl.current).toBeNull();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("dispose cancels the active timer (no leak after disposal)", async () => {
    const { ctrl, states } = setup();
    ctrl.trigger("c1", 7);
    const lengthBeforeDispose = states.length;
    ctrl.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    // No further onChange after dispose.
    expect(states.length).toBe(lengthBeforeDispose);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/lib/voting/MissedUndoController.test.ts`
Expected: FAIL with "Cannot find module '@/lib/voting/MissedUndoController'".

- [ ] **Step 3: Implement the controller**

```ts
// src/lib/voting/MissedUndoController.ts
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
```

- [ ] **Step 4: Run, all pass**

Run: `npx vitest run src/lib/voting/MissedUndoController.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voting/MissedUndoController.ts src/lib/voting/MissedUndoController.test.ts
git commit -m "$(cat <<'EOF'
voting: MissedUndoController for the 5s undo timer (PR3 of 3)

Pure class that holds the active "marked missed" toast and its
auto-dismiss timer. Mirrors the Autosaver/useVoteAutosave split:
class is pure-testable with fake timers, hook wrapper lands next.
Trigger replaces (no queue) per spec §4 PR3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `useMissedUndo` — React hook wrapper

**Files:**
- Create: `src/hooks/useMissedUndo.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useMissedUndo.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MissedUndoController,
  type MissedUndoToast,
} from "@/lib/voting/MissedUndoController";

export interface UseMissedUndoParams {
  onUndo: (contestantId: string) => void;
  ttlMs?: number;
}

export interface UseMissedUndoResult {
  toast: MissedUndoToast | null;
  trigger: (contestantId: string, projectedOverall: number) => void;
  undo: () => void;
  dismiss: () => void;
}

export function useMissedUndo(
  params: UseMissedUndoParams
): UseMissedUndoResult {
  const [toast, setToast] = useState<MissedUndoToast | null>(null);
  const ctrlRef = useRef<MissedUndoController | null>(null);

  useEffect(() => {
    const ctrl = new MissedUndoController({
      onUndo: params.onUndo,
      onChange: setToast,
      ttlMs: params.ttlMs,
    });
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    };
  }, [params.onUndo, params.ttlMs]);

  const trigger = useCallback(
    (contestantId: string, projectedOverall: number) => {
      ctrlRef.current?.trigger(contestantId, projectedOverall);
    },
    []
  );

  const undo = useCallback(() => {
    ctrlRef.current?.undo();
  }, []);

  const dismiss = useCallback(() => {
    ctrlRef.current?.dismiss();
  }, []);

  return { toast, trigger, undo, dismiss };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMissedUndo.ts
git commit -m "$(cat <<'EOF'
voting: useMissedUndo hook — React wrapper around MissedUndoController

Thin wrapper that turns the controller's onChange callback into
useState. Mirrors the useVoteAutosave/Autosaver pattern. The class
holds the timer + toast; the hook holds React state. No tests at
this layer — controller is fully covered by the prior commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add toast locale keys

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Extend the `voting.missed` namespace**

Edit `src/locales/en.json`. The existing block is:

```json
"voting": {
  "missed": {
    "button": "I missed this",
    "buttonAria": "Mark this contestant as missed",
    "cardLabel": "This one's marked as missed",
    "estimatedLabel": "Estimated score",
    "perCategoryLabel": "Per category (estimated)",
    "rescoreButton": "Rescore this contestant"
  }
},
```

Add a `toast` sub-namespace just before the closing `}`:

```json
"voting": {
  "missed": {
    "button": "I missed this",
    "buttonAria": "Mark this contestant as missed",
    "cardLabel": "This one's marked as missed",
    "estimatedLabel": "Estimated score",
    "perCategoryLabel": "Per category (estimated)",
    "rescoreButton": "Rescore this contestant",
    "toast": {
      "body": "Marked missed — we'll estimate your scores as ~{overall}.",
      "undo": "Undo",
      "dismissAria": "Dismiss"
    }
  }
},
```

- [ ] **Step 2: Run locale tests**

Run: `npx vitest run src/locales/locales.test.ts`
Expected: PASS (non-en bundles are still empty per existing convention; key-completeness test only runs against bundles that have any keys).

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "$(cat <<'EOF'
voting: en.json toast keys for the missed-state Undo flow

Adds voting.missed.toast.{body,undo,dismissAria}. Body uses an
{overall} placeholder; the toast component will substitute via
template-string interpolation since the rest of the voting surface
hasn't been extracted to next-intl yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Build `<MissedToast>` component

**Files:**
- Create: `src/components/voting/MissedToast.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/voting/MissedToast.tsx
"use client";

import type { MissedUndoToast } from "@/lib/voting/MissedUndoController";

export interface MissedToastProps {
  toast: MissedUndoToast | null;
  onUndo: () => void;
  onDismiss?: () => void;
}

export default function MissedToast({
  toast,
  onUndo,
  onDismiss,
}: MissedToastProps) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 inset-x-4 mx-auto max-w-md z-20 rounded-xl border border-border bg-foreground text-background px-4 py-3 shadow-lg flex items-center justify-between gap-3 animate-fade-in"
    >
      <p className="text-sm flex-1">
        Marked missed — we&rsquo;ll estimate your scores as{" "}
        <span className="font-semibold tabular-nums">~{toast.projectedOverall}</span>.
      </p>
      <button
        type="button"
        onClick={onUndo}
        className="text-sm font-semibold underline underline-offset-2 hover:opacity-90 px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring rounded"
      >
        Undo
      </button>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-background/70 hover:text-background px-1 flex-shrink-0"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

Note: bare English strings consistent with the rest of the voting components (locale keys from Task 3 land for the future Phase L extraction).

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/voting/MissedToast.tsx
git commit -m "$(cat <<'EOF'
voting: MissedToast component — bottom-of-screen undo affordance

Fixed-bottom toast with the projected overall + Undo button.
role="status" aria-live="polite" so screen readers announce it
without stealing focus. Returns null when toast is null so the
parent can render unconditionally. Optional onDismiss adds a × in
case the parent wants to expose explicit dismissal beyond the 5s
auto-clear.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire toast + undo into `VotingView`

**Files:**
- Modify: `src/components/voting/VotingView.tsx`

- [ ] **Step 1: Add imports**

At the top of the file, alongside the other component imports:

```tsx
import MissedToast from "@/components/voting/MissedToast";
import { useMissedUndo } from "@/hooks/useMissedUndo";
```

- [ ] **Step 2: Construct the hook just below `setMissed`**

After the `setMissed` `useCallback` (and before the `useMemo` for `projected`), add:

```tsx
  const undo = useMissedUndo({
    onUndo: (contestantId) => setMissed(contestantId, false),
  });

  const handleMarkMissed = useCallback(
    (contestantId: string) => {
      const nextMissed = { ...missedByContestant, [contestantId]: true };
      const projection = computeProjectedAverage(
        scoresByContestant,
        nextMissed,
        categories
      );
      setMissed(contestantId, true);
      undo.trigger(contestantId, projection.overall);
    },
    [missedByContestant, scoresByContestant, categories, setMissed, undo]
  );
```

The projection is computed using `nextMissed` so the *current* contestant's stale scores don't contribute to the toast value (they wouldn't anyway in `computeProjectedAverage`'s filter, but this makes the intent obvious).

- [ ] **Step 3: Swap the footer's "I missed this" handler**

Inside the footer `<nav>`:

```tsx
          <Button
            variant="ghost"
            onClick={() => handleMarkMissed(contestant.id)}
            disabled={isMissed}
            aria-label="Mark this contestant as missed"
          >
            I missed this
          </Button>
```

Replace the prior `onClick={() => setMissed(contestant.id, true)}` with `onClick={() => handleMarkMissed(contestant.id)}`.

- [ ] **Step 4: Render `<MissedToast>` near the bottom of `<main>`**

Just before the closing `</main>`:

```tsx
      <MissedToast toast={undo.toast} onUndo={undo.undo} />
```

It returns null when there's no active toast, so it's safe to render unconditionally.

- [ ] **Step 5: Type-check + tests**

Run: `npm run type-check && npm test`
Expected: clean type-check, 616 tests pass (609 from PR2 + 7 new from `MissedUndoController`).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no new errors. The pre-existing `useRoomRealtime` warning is unrelated.

- [ ] **Step 7: Commit**

```bash
git add src/components/voting/VotingView.tsx
git commit -m "$(cat <<'EOF'
voting: wire MissedToast + useMissedUndo into VotingView

Tap "I missed this" → setMissed flips local state and autosaves;
useMissedUndo trigger arms a 5s toast; tap Undo (or the timer
expires) → setMissed reverts. Computed projection uses the
prospective nextMissed so the toast shows what the user will see
on the missed-state card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Pre-push gate**

Run: `npm run pre-push`
Expected: clean.

- [ ] **Step 2: Manual smoke**

Run `npm run dev`. In the browser:

1. Start voting in a room. Confirm: tapping **I missed this** in the footer shows the bottom toast: *"Marked missed — we'll estimate your scores as ~5."* and the score-row grid is replaced by `<MissedCard>`.
2. Wait 5s without interacting. Confirm: the toast fades out / disappears; the missed-state card remains.
3. Re-do: mark another contestant missed. Within 5s, tap **Undo** on the toast. Confirm: toast disappears immediately, the score-row grid returns, footer "I missed this" button is enabled again, and the network tab shows a `POST /votes` payload with `missed: false`.
4. Mark contestant A missed → before the 5s elapses, navigate to contestant B and mark *that* one missed. Confirm: the toast updates to show B's projected overall and the timer re-arms (so you have the full 5s on B). Tap Undo — only B is reverted; A stays missed.
5. Network tab: confirm `missed: true` and `missed: false` payloads correlate to taps + undos correctly.

If anything misbehaves, iterate before claiming complete.

- [ ] **Step 3: Tick the Phase 3 TODO line and update memo of state**

Edit `TODO.md`. The `[~]` line for "I missed this" can flip to `[x]` once manual smoke passes:

```
- [x] "I missed this" button + modal + projected score display with live updates on own-votes channel  _(landed on `feat/voting-i-missed-this`: PR1 + PR2 + PR3. Spec: `docs/superpowers/specs/2026-04-25-i-missed-this-design.md`. The "live updates on own-votes channel" wording in the original Phase 3 line was deferred to local-state per spec Q2.)_
```

(`TODO.md` is gitignored — no commit needed.)

---

## Self-Review

**Spec coverage:**
- §3 step 4 "bottom toast appears" → Task 5 step 4 + Task 4 component
- §3 step 4 "auto-dismiss at 5s" → Task 1 controller + Task 2 hook
- §3 step 5 "Undo within 5s reverts" → Task 1's `undo()` + Task 5's `handleMarkMissed`
- §3 step 6 "after 5s, Rescore on the card is the only revert path" → Task 1 expire path nulls toast; PR2's MissedCard already provides Rescore
- §4 PR3 "MissedUndoController" → Task 1
- §4 PR3 "useMissedUndo" → Task 2
- §4 PR3 "MissedToast" → Task 4
- §4 PR3 "VotingView wiring" → Task 5
- §4 PR3 "locale keys" → Task 3
- §5 "second trigger replaces, no queue" → Task 1 covered by the "second trigger" test
- §5 "unmount clears the timer" → Task 1's `dispose()` covered by the dispose test

**Placeholder scan:** none.

**Type consistency:**
- `MissedUndoToast` shape exported from controller, re-imported in hook + component.
- `useMissedUndo` return type matches what `VotingView` consumes (`toast`, `trigger`, `undo`).
- `handleMarkMissed` signature `(contestantId: string) => void` matches the existing footer button handler convention.
