# "I missed this" — PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pure-logic foundation for the "I missed this" feature: a projected-average helper, plus an additive `scheduleMissed` method on the Autosaver that flushes alongside scheduled scores in a single per-contestant POST. No UI changes. No call-site behaviour changes. PR2/PR3 build on this.

**Architecture:** Stays inside `src/lib/voting/` plus a small additive callback on `useVoteAutosave`. The Autosaver gains a second scheduling method (`scheduleMissed`) rather than mutating the existing `schedule(contestantId, categoryName, value)` signature — preserves all 11 existing Autosaver tests verbatim. Pending entries merge `scores` + `missed` into one POST payload.

**Tech Stack:** TypeScript (strict), vitest, fake timers. No new deps.

**Spec:** `docs/superpowers/specs/2026-04-25-i-missed-this-design.md`

**Spec deviation note:** Spec §4 PR1 sketched a unified `schedule(contestantId, fields)` signature. Plan uses an additive `scheduleMissed` method instead. Same end state (merged POST per debounce window), zero churn in existing tests + call sites. The spec's intent is preserved.

---

### Task 1: `computeProjectedAverage` — failing test for the empty case

**Files:**
- Create: `src/lib/voting/computeProjectedAverage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/voting/computeProjectedAverage.test.ts
import { describe, it, expect } from "vitest";
import { computeProjectedAverage } from "@/lib/voting/computeProjectedAverage";

describe("computeProjectedAverage", () => {
  it("returns all-5 defaults when there are no votes", () => {
    const result = computeProjectedAverage(
      {},
      {},
      [{ name: "Vocals" }, { name: "Stage" }]
    );
    expect(result.perCategory).toEqual({ Vocals: 5, Stage: 5 });
    expect(result.overall).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails for the right reason**

Run: `npx vitest run src/lib/voting/computeProjectedAverage.test.ts`
Expected: FAIL with module-not-found / "Cannot find module '@/lib/voting/computeProjectedAverage'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/voting/computeProjectedAverage.ts
export interface ProjectedAverage {
  perCategory: Record<string, number>;
  overall: number;
}

export function computeProjectedAverage(
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categories: { name: string }[]
): ProjectedAverage {
  void scoresByContestant;
  void missedByContestant;
  const perCategory: Record<string, number> = {};
  for (const cat of categories) {
    perCategory[cat.name] = 5;
  }
  return { perCategory, overall: 5 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/voting/computeProjectedAverage.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/voting/computeProjectedAverage.ts src/lib/voting/computeProjectedAverage.test.ts
git commit -m "$(cat <<'EOF'
voting: computeProjectedAverage scaffolding (empty case)

Per-category projected average + overall mean for the missed-state
card (SPEC §8.4). This commit ships only the no-votes default-5 case;
later commits add real averaging, exclusion of missed-flagged
contestants, and rounding semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `computeProjectedAverage` — average scored values per category

**Files:**
- Modify: `src/lib/voting/computeProjectedAverage.test.ts`
- Modify: `src/lib/voting/computeProjectedAverage.ts`

- [ ] **Step 1: Add the failing test**

Append to `computeProjectedAverage.test.ts`, inside the existing `describe`:

```ts
it("averages a single contestant's scored values per category", () => {
  const result = computeProjectedAverage(
    { c1: { Vocals: 8, Stage: 6 } },
    {},
    [{ name: "Vocals" }, { name: "Stage" }]
  );
  expect(result.perCategory).toEqual({ Vocals: 8, Stage: 6 });
  expect(result.overall).toBe(7); // mean(8, 6) = 7
});

it("averages across multiple contestants per category", () => {
  const result = computeProjectedAverage(
    {
      c1: { Vocals: 8, Stage: 6 },
      c2: { Vocals: 6, Stage: 4 },
      c3: { Vocals: 10, Stage: 5 },
    },
    {},
    [{ name: "Vocals" }, { name: "Stage" }]
  );
  expect(result.perCategory).toEqual({ Vocals: 8, Stage: 5 }); // mean(8,6,10)=8, mean(6,4,5)=5
  expect(result.overall).toBe(7); // mean(8, 5) = 6.5 → 7
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `npx vitest run src/lib/voting/computeProjectedAverage.test.ts`
Expected: 1 PASS (the empty case), 2 FAIL.

- [ ] **Step 3: Replace the body of `computeProjectedAverage`**

Edit `src/lib/voting/computeProjectedAverage.ts`:

```ts
export interface ProjectedAverage {
  perCategory: Record<string, number>;
  overall: number;
}

export function computeProjectedAverage(
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categories: { name: string }[]
): ProjectedAverage {
  const perCategory: Record<string, number> = {};
  for (const cat of categories) {
    const values: number[] = [];
    for (const contestantId of Object.keys(scoresByContestant)) {
      if (missedByContestant[contestantId]) continue;
      const v = scoresByContestant[contestantId][cat.name];
      if (typeof v === "number") values.push(v);
    }
    if (values.length === 0) {
      perCategory[cat.name] = 5;
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    perCategory[cat.name] = clamp1to10(Math.round(mean));
  }
  const allCatMeans = Object.values(perCategory);
  const overallMean =
    allCatMeans.length === 0
      ? 5
      : allCatMeans.reduce((a, b) => a + b, 0) / allCatMeans.length;
  return {
    perCategory,
    overall: clamp1to10(Math.round(overallMean)),
  };
}

function clamp1to10(n: number): number {
  if (n < 1) return 1;
  if (n > 10) return 10;
  return n;
}
```

- [ ] **Step 4: Run tests, all pass**

Run: `npx vitest run src/lib/voting/computeProjectedAverage.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voting/computeProjectedAverage.ts src/lib/voting/computeProjectedAverage.test.ts
git commit -m "$(cat <<'EOF'
voting: computeProjectedAverage averages per category

Implements the per-category mean + overall mean with Math.round and
1..10 clamping. Still missing: exclusion of contestants flagged
missed, and the explicit no-votes-anywhere default. Those land next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `computeProjectedAverage` — exclude missed contestants and partial-category votes

**Files:**
- Modify: `src/lib/voting/computeProjectedAverage.test.ts`

- [ ] **Step 1: Add failing tests for missed exclusion and partial categories**

Append inside the existing `describe`:

```ts
it("excludes contestants flagged as missed even if their scores are still in the map", () => {
  const result = computeProjectedAverage(
    {
      c1: { Vocals: 8, Stage: 6 },
      c2: { Vocals: 2, Stage: 2 }, // would drag the average down
    },
    { c2: true },
    [{ name: "Vocals" }, { name: "Stage" }]
  );
  expect(result.perCategory).toEqual({ Vocals: 8, Stage: 6 });
});

it("treats a category with no scored values as default 5 even when others have votes", () => {
  const result = computeProjectedAverage(
    { c1: { Vocals: 9 } }, // Stage missing
    {},
    [{ name: "Vocals" }, { name: "Stage" }]
  );
  expect(result.perCategory).toEqual({ Vocals: 9, Stage: 5 });
  expect(result.overall).toBe(7); // mean(9, 5) = 7
});

it("ignores null score values", () => {
  const result = computeProjectedAverage(
    { c1: { Vocals: null, Stage: 8 } },
    {},
    [{ name: "Vocals" }, { name: "Stage" }]
  );
  expect(result.perCategory).toEqual({ Vocals: 5, Stage: 8 });
});

it("rounds to nearest int — 6.5 → 7, 6.4 → 6", () => {
  const result1 = computeProjectedAverage(
    { c1: { Vocals: 6 }, c2: { Vocals: 7 } },
    {},
    [{ name: "Vocals" }]
  );
  expect(result1.perCategory.Vocals).toBe(7); // mean(6,7)=6.5 → 7

  const result2 = computeProjectedAverage(
    { c1: { Vocals: 6 }, c2: { Vocals: 6 }, c3: { Vocals: 7 } },
    {},
    [{ name: "Vocals" }]
  );
  expect(result2.perCategory.Vocals).toBe(6); // mean(6,6,7)=6.33 → 6
});

it("clamps overall to 1..10", () => {
  const single10 = computeProjectedAverage(
    { c1: { Vocals: 10, Stage: 10 } },
    {},
    [{ name: "Vocals" }, { name: "Stage" }]
  );
  expect(single10.overall).toBe(10);
});
```

- [ ] **Step 2: Run tests — `missed exclusion` should fail; the others may already pass**

Run: `npx vitest run src/lib/voting/computeProjectedAverage.test.ts`
Expected: at minimum, the `missed exclusion` test fails because the current implementation already filters `if (missedByContestant[contestantId]) continue` — wait, it does. Let me re-verify that the implementation filters correctly. If all 5 new tests pass, that's fine — they're regression coverage.

- [ ] **Step 3: If any test fails, narrow the bug and fix**

The most likely failure mode: the implementation was written correctly in Task 2 to filter `missedByContestant`. If a test fails, it means a logic gap; fix and re-run. If all pass, skip to Step 4.

- [ ] **Step 4: Confirm full file passes**

Run: `npx vitest run src/lib/voting/computeProjectedAverage.test.ts`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voting/computeProjectedAverage.test.ts
git commit -m "$(cat <<'EOF'
voting: computeProjectedAverage edge-case coverage

Adds tests for missed-flagged exclusion, partial categories, null
score values, rounding semantics, and 1..10 clamping. No
implementation change (Task 2's body already handles all of these).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Autosaver — add `scheduleMissed` (failing test for missed-only flush)

**Files:**
- Modify: `src/lib/voting/Autosaver.test.ts`

- [ ] **Step 1: Add failing test** (inside the existing `describe("Autosaver", ...)` block, after the last existing `it`)

```ts
it("scheduleMissed flushes a missed-only payload after the debounce window", async () => {
  const { saver, post } = makeSaver(async () => makeSuccess());
  saver.scheduleMissed("c1", true);
  await vi.advanceTimersByTimeAsync(500);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith({
    roomId: ROOM_ID,
    userId: USER_ID,
    contestantId: "c1",
    missed: true,
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run src/lib/voting/Autosaver.test.ts`
Expected: FAIL with "saver.scheduleMissed is not a function" (TS will likely complain too — that's fine, the test runs via vitest's TS support).

- [ ] **Step 3: Add `scheduleMissed` to `Autosaver`**

Edit `src/lib/voting/Autosaver.ts`:

Replace the `PendingEntry` interface and the `schedule`/`flushContestant` methods. Show the full updated class body for clarity:

```ts
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
}

const DEFAULT_DEBOUNCE_MS = 500;

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

  schedule(
    contestantId: string,
    categoryName: string,
    value: number | null
  ): void {
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
```

Key change vs. the prior implementation:
- `flushContestant` now omits `scores` from the payload when it's empty (prevents an empty-scores write on a missed-only flush).
- New `scheduleMissed` uses the same per-contestant debounce window and merges with any pending scores.

- [ ] **Step 4: Run tests, all pass**

Run: `npx vitest run src/lib/voting/Autosaver.test.ts`
Expected: All previously-passing tests still pass, plus the new `scheduleMissed flushes a missed-only payload` test passes. Total = 12 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voting/Autosaver.ts src/lib/voting/Autosaver.test.ts
git commit -m "$(cat <<'EOF'
voting: Autosaver.scheduleMissed for the missed-toggle write path

Adds an additive scheduleMissed(contestantId, missed) method that
shares the per-contestant debounce window and merges into a single
POST payload. flushContestant now omits empty scores so the missed-
only path produces { contestantId, missed } without a stray
scores: {}. Existing 11 tests + 1 new test green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Autosaver — coalesce score + missed in the same window

**Files:**
- Modify: `src/lib/voting/Autosaver.test.ts`

- [ ] **Step 1: Add coalesce tests**

Append inside the `describe("Autosaver", ...)` block:

```ts
it("coalesces schedule + scheduleMissed for the same contestant into one post", async () => {
  const { saver, post } = makeSaver(async () => makeSuccess());
  saver.schedule("c1", "Vocals", 7);
  saver.scheduleMissed("c1", true);
  await vi.advanceTimersByTimeAsync(500);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith({
    roomId: ROOM_ID,
    userId: USER_ID,
    contestantId: "c1",
    scores: { Vocals: 7 },
    missed: true,
  });
});

it("coalesces scheduleMissed then schedule into one post", async () => {
  const { saver, post } = makeSaver(async () => makeSuccess());
  saver.scheduleMissed("c1", true);
  saver.schedule("c1", "Vocals", 7);
  await vi.advanceTimersByTimeAsync(500);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith({
    roomId: ROOM_ID,
    userId: USER_ID,
    contestantId: "c1",
    scores: { Vocals: 7 },
    missed: true,
  });
});

it("two scheduleMissed calls in the window — last value wins", async () => {
  const { saver, post } = makeSaver(async () => makeSuccess());
  saver.scheduleMissed("c1", true);
  saver.scheduleMissed("c1", false);
  await vi.advanceTimersByTimeAsync(500);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith({
    roomId: ROOM_ID,
    userId: USER_ID,
    contestantId: "c1",
    missed: false,
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/lib/voting/Autosaver.test.ts`
Expected: All 15 tests PASS.

The coalesce + last-write-wins semantics are already encoded by Task 4's implementation:
- `schedule` preserves `existing?.missed` when merging
- `scheduleMissed` preserves `existing?.scores ?? {}` when merging
- Both clear-and-rearm the per-contestant timer

If anything fails, fix the implementation in `Autosaver.ts` to honour these invariants and re-run.

- [ ] **Step 3: Commit**

```bash
git add src/lib/voting/Autosaver.test.ts
git commit -m "$(cat <<'EOF'
voting: Autosaver coalesce coverage for score + missed

Three regression tests: schedule then scheduleMissed, scheduleMissed
then schedule, and last-write-wins for two scheduleMissed calls in
the same debounce window. Implementation unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `useVoteAutosave` — expose `onMissedChange` callback

**Files:**
- Modify: `src/components/voting/useVoteAutosave.ts`

- [ ] **Step 1: Update the hook to expose `onMissedChange`**

Edit `src/components/voting/useVoteAutosave.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import {
  OfflineAdapter,
  type OfflineAdapterState,
  type DrainNotice,
} from "@/lib/voting/OfflineAdapter";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import type { DisplaySaveStatus } from "@/components/voting/SaveChip";

export interface UseVoteAutosaveParams {
  roomId: string;
  userId: string | null;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
  fetchServerVotes?: (
    roomId: string,
    userId: string
  ) => Promise<{ contestantId: string; updatedAt: string }[]>;
}

export interface UseVoteAutosaveResult {
  onScoreChange: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  onMissedChange: (contestantId: string, missed: boolean) => void;
  status: DisplaySaveStatus;
  offlineBannerVisible: boolean;
  drainNotice: DrainNotice | null;
  dismissDrainNotice: () => void;
  queueOverflow: boolean;
}

export function useVoteAutosave(
  params: UseVoteAutosaveParams
): UseVoteAutosaveResult {
  const [autosaverStatus, setAutosaverStatus] = useState<SaveStatus>("idle");
  const [adapterState, setAdapterState] = useState<OfflineAdapterState>({
    online: true,
    queueSize: 0,
    overflowed: false,
  });
  const [drainNotice, setDrainNotice] = useState<DrainNotice | null>(null);
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!params.userId) {
      saverRef.current = null;
      setAutosaverStatus("idle");
      setAdapterState({ online: true, queueSize: 0, overflowed: false });
      setDrainNotice(null);
      return;
    }

    const storage =
      typeof window !== "undefined" ? window.localStorage : null;

    const adapter = new OfflineAdapter({
      realPost: params.post,
      storage,
      onStateChange: setAdapterState,
      fetchServerVotes: params.fetchServerVotes,
      onDrainComplete: setDrainNotice,
    });

    const saver = new Autosaver(params.roomId, params.userId, {
      post: (payload) => adapter.post(payload),
      onStatusChange: setAutosaverStatus,
    });
    saverRef.current = saver;

    return () => {
      saver.dispose();
      adapter.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [params.roomId, params.userId, params.post, params.fetchServerVotes]);

  const onScoreChange = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      saverRef.current?.schedule(contestantId, categoryName, next);
    },
    []
  );

  const onMissedChange = useCallback(
    (contestantId: string, missed: boolean) => {
      saverRef.current?.scheduleMissed(contestantId, missed);
    },
    []
  );

  const dismissDrainNotice = useCallback(() => setDrainNotice(null), []);

  const status: DisplaySaveStatus =
    adapterState.queueSize > 0 || !adapterState.online
      ? "offline"
      : autosaverStatus;

  return {
    onScoreChange,
    onMissedChange,
    status,
    offlineBannerVisible: !adapterState.online,
    drainNotice,
    dismissDrainNotice,
    queueOverflow: adapterState.overflowed,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean (no errors). The `useVoteAutosave` consumer in `src/app/room/[id]/page.tsx` doesn't read `onMissedChange` yet, so it's an additive non-breaking change.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all PASS. No new tests added at the hook layer — `onMissedChange` is a thin pass-through to `Autosaver.scheduleMissed`, which is already covered. Adding a hook-level integration test would duplicate that coverage.

- [ ] **Step 4: Commit**

```bash
git add src/components/voting/useVoteAutosave.ts
git commit -m "$(cat <<'EOF'
voting: expose onMissedChange from useVoteAutosave

Thin pass-through to Autosaver.scheduleMissed. Additive — existing
consumers of useVoteAutosave are unchanged. Wires PR2 into the
existing autosave + offline pipeline so missed toggles flow through
the same debounce + offline queue + conflict-reconciliation path
as scores.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verification

**Files:** none (read-only checks).

- [ ] **Step 1: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all PASS, including the new `computeProjectedAverage` (8) and `Autosaver` (15) tests.

- [ ] **Step 4: Pre-push gate**

Run: `npm run pre-push`
Expected: clean. Confirms the branch is shippable.

- [ ] **Step 5: Manual smoke (optional, ~2 minutes)**

Run: `npm run dev`
- Open a room, start voting.
- In the React DevTools, find the Autosaver instance via the page tree and call `.scheduleMissed("<a contestant id>", true)` from the console (or use a temporary debug button). Confirm the network tab shows a `POST /api/rooms/{id}/votes` with `missed: true` and 200 OK.
- Skip if PR2's footer button is the cleaner gate — the next phase covers it.

---

## Self-Review

**Spec coverage:**
- §4 PR1 "computeProjectedAverage" → Tasks 1–3.
- §4 PR1 "Autosaver extension" → Tasks 4–5.
- §4 PR1 "useVoteAutosave.onMissedChange" → Task 6.
- §4 PR1 "preserve existing 11 Autosaver tests" → preserved (Task 4 adds the 12th, Task 5 adds 13–15).
- Spec §3 step 7 ("tap missed → tap undo within 500ms never hits the wire") → covered by Task 5's last-write-wins coalesce test.
- Verification gates → Task 7.

PR2/PR3 are explicitly out of scope for this plan and are described in the spec.

**Placeholder scan:** none (no TBD/TODO/"add appropriate"; every code step shows the code).

**Type consistency:**
- `ProjectedAverage` shape is consistent across Tasks 1–3.
- `scheduleMissed(contestantId, missed: boolean): void` consistent across Tasks 4–6.
- `onMissedChange(contestantId, missed)` matches the spec §6 surface and the `UseVoteAutosaveResult` interface in Task 6.
- `PostVoteInput` already permits `missed?: boolean` (per `src/lib/voting/postVote.ts`), so the new flush payload is type-clean without further changes.
