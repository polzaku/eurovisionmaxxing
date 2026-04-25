# Jump-to drawer + swipe navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land the last Phase 3 voting-UI sub-features in one PR: `<JumpToDrawer>` (bottom sheet listing contestants with own-state status) and horizontal-swipe navigation (left=next, right=prev outside the score grid).

**Architecture:** Two new pure helpers + one new component + small additive changes to `VotingView`, `ScoreRow`, `HotTakeField`. Spec: `docs/superpowers/specs/2026-04-26-jump-to-swipe-design.md`.

---

### Task 1: `summarizeContestantStatus` — TDD

**Files:** create `src/lib/voting/contestantStatus.ts` + `.test.ts`.

- [ ] Write failing tests:

```ts
import { describe, it, expect } from "vitest";
import { summarizeContestantStatus } from "@/lib/voting/contestantStatus";

describe("summarizeContestantStatus", () => {
  it("returns 'missed' when missedByContestant flag is set, even with full scores", () => {
    const result = summarizeContestantStatus(
      "c1",
      { c1: { Vocals: 7, Stage: 8 } },
      { c1: true },
      ["Vocals", "Stage"]
    );
    expect(result).toBe("missed");
  });

  it("returns 'scored' when all category names have numeric scores", () => {
    const result = summarizeContestantStatus(
      "c1",
      { c1: { Vocals: 7, Stage: 8 } },
      {},
      ["Vocals", "Stage"]
    );
    expect(result).toBe("scored");
  });

  it("returns 'unscored' when at least one category has no numeric score", () => {
    const result = summarizeContestantStatus(
      "c1",
      { c1: { Vocals: 7 } },
      {},
      ["Vocals", "Stage"]
    );
    expect(result).toBe("unscored");
  });

  it("returns 'unscored' when contestant has no entry in either map", () => {
    expect(summarizeContestantStatus("c1", {}, {}, ["Vocals"])).toBe("unscored");
  });

  it("returns 'unscored' for an empty categoryNames list (defensive)", () => {
    expect(summarizeContestantStatus("c1", { c1: {} }, {}, [])).toBe("unscored");
  });
});
```

- [ ] Run, verify failure.
- [ ] Implement:

```ts
export type ContestantStatus = "unscored" | "scored" | "missed";

export function summarizeContestantStatus(
  contestantId: string,
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categoryNames: readonly string[]
): ContestantStatus {
  if (missedByContestant[contestantId]) return "missed";
  if (categoryNames.length === 0) return "unscored";
  const scores = scoresByContestant[contestantId] ?? {};
  const allScored = categoryNames.every(
    (name) => typeof scores[name] === "number"
  );
  return allScored ? "scored" : "unscored";
}
```

- [ ] Run, all 5 pass.
- [ ] Commit: `voting: summarizeContestantStatus pure helper for jump-to drawer`.

---

### Task 2: `nextIdxFromSwipe` — TDD

**Files:** create `src/lib/voting/nextIdxFromSwipe.ts` + `.test.ts`.

- [ ] Write failing tests:

```ts
import { describe, it, expect } from "vitest";
import { nextIdxFromSwipe } from "@/lib/voting/nextIdxFromSwipe";

describe("nextIdxFromSwipe", () => {
  it("left swipe (negative deltaX past threshold) advances next from middle", () => {
    expect(nextIdxFromSwipe(5, 10, -100)).toBe(6);
  });

  it("right swipe (positive deltaX past threshold) goes prev from middle", () => {
    expect(nextIdxFromSwipe(5, 10, 100)).toBe(4);
  });

  it("left swipe at last contestant returns null (no overflow)", () => {
    expect(nextIdxFromSwipe(9, 10, -100)).toBeNull();
  });

  it("right swipe at first contestant returns null", () => {
    expect(nextIdxFromSwipe(0, 10, 100)).toBeNull();
  });

  it("delta below threshold (positive) returns null", () => {
    expect(nextIdxFromSwipe(5, 10, 30)).toBeNull();
  });

  it("delta below threshold (negative) returns null", () => {
    expect(nextIdxFromSwipe(5, 10, -30)).toBeNull();
  });

  it("exactly at threshold returns null (strict greater-than)", () => {
    expect(nextIdxFromSwipe(5, 10, 50)).toBeNull();
    expect(nextIdxFromSwipe(5, 10, -50)).toBeNull();
  });
});
```

- [ ] Run, verify failure.
- [ ] Implement:

```ts
export function nextIdxFromSwipe(
  currentIdx: number,
  total: number,
  deltaX: number,
  threshold: number = 50
): number | null {
  if (deltaX > threshold) {
    return currentIdx > 0 ? currentIdx - 1 : null;
  }
  if (deltaX < -threshold) {
    return currentIdx < total - 1 ? currentIdx + 1 : null;
  }
  return null;
}
```

- [ ] Run, all 7 pass.
- [ ] Commit: `voting: nextIdxFromSwipe pure helper`.

---

### Task 3: Locale keys

**Files:** modify `src/locales/en.json`.

- [ ] Add inside the `voting` namespace, after `hotTake`:

```json
"jumpTo": {
  "footerButton": "Jump to",
  "footerButtonAria": "Jump to a contestant",
  "title": "Jump to contestant",
  "closeAria": "Close",
  "currentSuffix": "(current)",
  "status": {
    "unscored": "Not scored yet",
    "scored": "✓ Scored",
    "missed": "👻 Missed"
  }
}
```

- [ ] Run `npx vitest run src/locales/locales.test.ts` — passes (non-en bundles still empty).
- [ ] Commit: `voting: en.json jumpTo.* keys`.

---

### Task 4: `<JumpToDrawer>` component

**Files:** create `src/components/voting/JumpToDrawer.tsx`.

- [ ] Implement:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { Contestant } from "@/types";
import {
  summarizeContestantStatus,
  type ContestantStatus,
} from "@/lib/voting/contestantStatus";

export interface JumpToDrawerProps {
  isOpen: boolean;
  contestants: Contestant[];
  currentContestantId: string;
  scoresByContestant: Record<string, Record<string, number | null>>;
  missedByContestant: Record<string, boolean>;
  categoryNames: readonly string[];
  onSelect: (contestantId: string) => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<ContestantStatus, string> = {
  unscored: "Not scored yet",
  scored: "✓ Scored",
  missed: "👻 Missed",
};

const STATUS_CLASS: Record<ContestantStatus, string> = {
  unscored: "text-muted-foreground",
  scored: "text-primary font-medium",
  missed: "text-muted-foreground italic",
};

export default function JumpToDrawer({
  isOpen,
  contestants,
  currentContestantId,
  scoresByContestant,
  missedByContestant,
  categoryNames,
  onSelect,
  onClose,
}: JumpToDrawerProps) {
  const currentRowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    currentRowRef.current?.scrollIntoView({ block: "center" });
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="jump-to-title">
      <div
        className="fixed inset-0 bg-foreground/40 z-30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-x-0 bottom-0 max-h-[85dvh] z-40 rounded-t-xl border-t border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border sticky top-0 bg-background">
          <h3 id="jump-to-title" className="text-lg font-semibold">
            Jump to contestant
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            ×
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {contestants.map((c) => {
            const status = summarizeContestantStatus(
              c.id,
              scoresByContestant,
              missedByContestant,
              categoryNames
            );
            const isCurrent = c.id === currentContestantId;
            return (
              <li
                key={c.id}
                ref={isCurrent ? currentRowRef : undefined}
                className={isCurrent ? "bg-muted" : ""}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums w-8 flex-shrink-0">
                    {c.runningOrder}.
                  </span>
                  <span className="text-xl flex-shrink-0" aria-hidden="true">
                    {c.flagEmoji}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">
                      {c.country}
                      {isCurrent && (
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          (current)
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground truncate">
                      &ldquo;{c.song}&rdquo;
                    </span>
                  </span>
                  <span
                    className={`text-xs whitespace-nowrap flex-shrink-0 ${STATUS_CLASS[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] Type-check — `npm run type-check`.
- [ ] Commit: `voting: JumpToDrawer component`.

---

### Task 5: VotingView wire-in (drawer + footer + swipe)

**Files:** modify `src/components/voting/VotingView.tsx`.

- [ ] Add imports:

```tsx
import JumpToDrawer from "@/components/voting/JumpToDrawer";
import { nextIdxFromSwipe } from "@/lib/voting/nextIdxFromSwipe";
```

`useRef` is already imported (it's used by `useMissedUndo` indirectly). If not in the import list yet, add it: `import { useMemo, useState, useCallback, useRef } from "react";`.

- [ ] Add `isDrawerOpen` state and `swipeStartXRef`:

After the existing `useState`s for `idx`, `scoresByContestant`, `missedByContestant`, `hotTakesByContestant`:

```ts
const [isDrawerOpen, setIsDrawerOpen] = useState(false);
const swipeStartXRef = useRef<number | null>(null);
```

- [ ] Add touch handlers (define inside the function body, near other callbacks):

```ts
const handleTouchStart = useCallback((e: React.TouchEvent) => {
  if (e.touches.length !== 1) {
    swipeStartXRef.current = null;
    return;
  }
  const target = e.target as HTMLElement;
  if (target.closest("[data-no-swipe]")) {
    swipeStartXRef.current = null;
    return;
  }
  swipeStartXRef.current = e.touches[0].clientX;
}, []);

const handleTouchEnd = useCallback(
  (e: React.TouchEvent) => {
    const startX = swipeStartXRef.current;
    swipeStartXRef.current = null;
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const next = nextIdxFromSwipe(idx, totalContestants, endX - startX);
    if (next !== null) setIdx(next);
  },
  [idx, totalContestants]
);
```

Note: `totalContestants` is computed later in the function. Move that derivation up so it's available when these callbacks are constructed, OR inline `sortedContestants.length` directly. Inlining is simpler:

```ts
const handleTouchEnd = useCallback(
  (e: React.TouchEvent) => {
    const startX = swipeStartXRef.current;
    swipeStartXRef.current = null;
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const next = nextIdxFromSwipe(idx, sortedContestants.length, endX - startX);
    if (next !== null) setIdx(next);
  },
  [idx, sortedContestants.length]
);
```

- [ ] Wrap the inner div with the touch handlers. Find the existing line:

```tsx
<div className="w-full max-w-xl space-y-6 animate-fade-in">
```

Change to:

```tsx
<div
  className="w-full max-w-xl space-y-6 animate-fade-in"
  onTouchStart={handleTouchStart}
  onTouchEnd={handleTouchEnd}
>
```

- [ ] Replace the 3-col footer with a 4-col version:

Find:

```tsx
<nav className="grid grid-cols-3 gap-3 pt-4">
```

Change to:

```tsx
<nav className="grid grid-cols-4 gap-2 pt-4">
```

Insert the Jump-to button between the missed button and the next button:

```tsx
<Button
  variant="ghost"
  onClick={() => setIsDrawerOpen(true)}
  aria-label="Jump to a contestant"
>
  ☰ Jump to
</Button>
```

- [ ] Render `<JumpToDrawer>` after the closing `</nav>` (still inside the outer wrapper div):

```tsx
<JumpToDrawer
  isOpen={isDrawerOpen}
  contestants={sortedContestants}
  currentContestantId={contestant.id}
  scoresByContestant={scoresByContestant}
  missedByContestant={missedByContestant}
  categoryNames={categoryNames}
  onSelect={(id) => {
    const target = sortedContestants.findIndex((c) => c.id === id);
    if (target >= 0) setIdx(target);
    setIsDrawerOpen(false);
  }}
  onClose={() => setIsDrawerOpen(false)}
/>
```

- [ ] Type-check — clean.
- [ ] Tests — all green (pure helpers covered; no component tests here).
- [ ] Commit: `voting: wire JumpToDrawer + swipe nav into VotingView`.

---

### Task 6: `data-no-swipe` attributes on score grid and hot-take textarea

**Files:** modify `src/components/voting/ScoreRow.tsx`, `src/components/voting/HotTakeField.tsx`.

- [ ] In `ScoreRow.tsx`, add `data-no-swipe` to the existing score-button grid container:

Find:
```tsx
<div
  className="relative grid grid-cols-10 ..."
  role="group"
  aria-label={...}
>
```

Change to:
```tsx
<div
  className="relative grid grid-cols-10 ..."
  role="group"
  aria-label={...}
  data-no-swipe
>
```

- [ ] In `HotTakeField.tsx`, add `data-no-swipe` to the `<textarea>`:

Find:
```tsx
<textarea
  ref={textareaRef}
  ...
/>
```

Change to:
```tsx
<textarea
  ref={textareaRef}
  data-no-swipe
  ...
/>
```

- [ ] Type-check — clean.
- [ ] Commit: `voting: data-no-swipe attrs on score grid + hot-take textarea`.

---

### Task 7: Verification

- [ ] `npm run type-check` clean.
- [ ] `npm run lint` clean (only the pre-existing warning).
- [ ] `npm test` — full suite green (646+ tests after adding 12 new).
- [ ] `npm run pre-push` clean.
- [ ] Manual smoke per spec §5 (9 steps).

---

## Self-Review

**Spec coverage:**
- §3.1 helpers → Tasks 1, 2.
- §3.2 component → Task 4.
- §3.3 VotingView → Task 5.
- §3.3 `data-no-swipe` → Task 6.
- §3.4 locale keys → Task 3.

**Placeholder scan:** none.

**Type consistency:**
- `ContestantStatus` is the same type referenced in `JumpToDrawer.tsx` and `contestantStatus.ts`.
- `nextIdxFromSwipe` always returns `number | null`; consumers in Task 5 check `!== null`.
- `JumpToDrawer.props.contestants` matches the existing `Contestant` type from `@/types` (already used in `VotingView`).
