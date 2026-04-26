# Phase S2 voting-card compactness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress the voting card to fit on iPhone 12+ (390×750 CSS px) without scroll for a typical 5-category template by replacing the global Scale strip with a header ⓘ → bottom-sheet, collapsing the score-row header to a single line, and gating hints behind a per-room `emx_hints_seen_{roomId}` flag with one-time first-card onboarding.

**Architecture:** Pure-helper-first. The flag read/write lives in a tiny SSR-safe module (`emxHintsSeen.ts`); the per-card hint state machine is a pure reducer (`nextHintExpansion`) that the `useHintExpansion` hook wraps with `useReducer` + two `useEffect`s. The hook exposes `expandedFor` derived via `useMemo` from `overrides ?? onboarding-default`, so React doesn't need any DOM-aware tests. JSX changes (`<ScaleAnchorsSheet>`, `<ScoreRow>` refactor, `<VotingView>` rewiring) land as one coupled commit and are manually smoke-tested in `npm run dev`.

**Tech Stack:** Next.js 14 + React 18, TypeScript strict, Tailwind, next-intl 3, Vitest (node env — no DOM, so JSX is verified manually). Same testing posture as the Phase S1 slice.

**Spec:** [docs/superpowers/specs/2026-04-26-phase-s2-voting-compactness-design.md](docs/superpowers/specs/2026-04-26-phase-s2-voting-compactness-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/locales/en.json` | Modify | Add 11 new keys under `voting.{status,scale,hint}` |
| `src/lib/voting/emxHintsSeen.ts` | Create | SSR-safe localStorage read/write for the per-room hints-seen flag |
| `src/lib/voting/emxHintsSeen.test.ts` | Create | Unit tests: key shape, default, set, SSR-safe, throw-safe |
| `src/components/voting/useHintExpansion.ts` | Create | Pure reducer `nextHintExpansion` + `useHintExpansion` hook |
| `src/components/voting/useHintExpansion.test.ts` | Create | Reducer-only tests (10 cases) |
| `src/components/voting/ScaleAnchorsSheet.tsx` | Create | Header ⓘ bottom-sheet showing 1/5/10 anchors |
| `src/components/voting/ScoreRow.tsx` | Modify | Single-line header + ⓘ hint-toggle button + `hintExpanded` prop |
| `src/components/voting/VotingView.tsx` | Modify | Remove scale strip, mount sheet + hook, wire onboarding microcopy + per-card overrides |

No other files are touched.

---

### Task 1: Locale keys

**Files:**
- Modify: `src/locales/en.json` — add new keys under `voting.{status,scale,hint}`.

**Worktree:** `/Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness`
**Branch:** `feat/phase-s2-voting-compactness`

Use `git -C <worktree-path>` for every git command. Before each commit run `git -C ... rev-parse --abbrev-ref HEAD` and confirm `feat/phase-s2-voting-compactness`. Verify staged file list with `git -C ... diff --cached --stat` before commit.

- [ ] **Step 1: Read current `en.json`**

Open `src/locales/en.json` and locate the `"voting"` namespace. Identify the existing structure under it (e.g. `voting.missed`, `voting.jumpTo`). The new keys go under three new sub-namespaces: `voting.status`, `voting.scale`, `voting.hint`. None of these exist yet.

- [ ] **Step 2: Add the new keys**

Insert these three new sub-objects inside `voting` (after `voting.missed` and before `voting.jumpTo`, or any sensible alphabetical position — final key order in the file isn't a behavioural property). The exact key/value pairs:

```json
"status": {
  "scored": "✓ scored {value}",
  "unscored": "Not scored"
},
"scale": {
  "openAria": "Show scale anchors",
  "closeAria": "Close scale anchors",
  "title": "Scale",
  "1": "Devastating",
  "5": "Fine",
  "10": "Iconic"
},
"hint": {
  "toggleAria": {
    "collapsed": "Show hint for {category}",
    "expanded": "Hide hint for {category}"
  },
  "onboarding": "Tap ⓘ on a category to hide its hint."
},
```

Make sure the surrounding JSON commas are correct (the previous-final sub-object now has a trailing comma; the inserted blocks have trailing commas; the next sub-object opens cleanly).

- [ ] **Step 3: Validate the JSON**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8')); console.log('OK')"`
Expected: `OK` (or a parse error if you broke a comma).

- [ ] **Step 4: Run the locale test**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm test -- locales`
Expected: 4 todo (the four non-en stubs), zero failures.

- [ ] **Step 5: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness rev-parse --abbrev-ref HEAD   # must say feat/phase-s2-voting-compactness
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness add src/locales/en.json
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness diff --cached --stat   # must show ONLY src/locales/en.json
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness commit -m "$(cat <<'EOF'
locale: add voting status/scale/hint keys (en) for Phase S2

New keys: voting.status.{scored,unscored},
voting.scale.{openAria,closeAria,title,1,5,10},
voting.hint.{toggleAria.collapsed,toggleAria.expanded,onboarding}.
Non-en translations deferred to Phase L L3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `emxHintsSeen` module + tests

**Files:**
- Create: `src/lib/voting/emxHintsSeen.ts`
- Test: `src/lib/voting/emxHintsSeen.test.ts`

TDD applies: write the failing test, watch it fail, then implement.

- [ ] **Step 1: Write the failing test**

Create `src/lib/voting/emxHintsSeen.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { seenHintsKey, isSeen, markSeen } from "./emxHintsSeen";

describe("seenHintsKey", () => {
  it("formats as emx_hints_seen_{roomId}", () => {
    expect(seenHintsKey("abc-123")).toBe("emx_hints_seen_abc-123");
  });
});

describe("isSeen / markSeen — happy path", () => {
  const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ORIGINAL_LOCAL_STORAGE,
    });
  });

  it("isSeen returns false when key is unset", () => {
    expect(isSeen("room-1")).toBe(false);
  });

  it("markSeen writes 'true' to the right key", () => {
    markSeen("room-2");
    expect(store["emx_hints_seen_room-2"]).toBe("true");
  });

  it("isSeen returns true after markSeen", () => {
    markSeen("room-3");
    expect(isSeen("room-3")).toBe(true);
  });

  it("isSeen returns false for a different room than the one marked", () => {
    markSeen("room-A");
    expect(isSeen("room-B")).toBe(false);
  });
});

describe("isSeen / markSeen — SSR safety", () => {
  const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  });

  it("isSeen returns false when window is undefined", () => {
    expect(isSeen("any")).toBe(false);
  });

  it("markSeen does not throw when window is undefined", () => {
    expect(() => markSeen("any")).not.toThrow();
  });
});

describe("isSeen / markSeen — localStorage throw safety", () => {
  const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ORIGINAL_LOCAL_STORAGE,
    });
  });

  it("isSeen returns false when localStorage.getItem throws", () => {
    expect(isSeen("any")).toBe(false);
  });

  it("markSeen does not propagate when localStorage.setItem throws", () => {
    expect(() => markSeen("any")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm test -- emxHintsSeen`
Expected: FAIL — module not found / cannot resolve `./emxHintsSeen`.

- [ ] **Step 3: Implement the module**

Create `src/lib/voting/emxHintsSeen.ts`:

```ts
export function seenHintsKey(roomId: string): string {
  return `emx_hints_seen_${roomId}`;
}

export function isSeen(roomId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(seenHintsKey(roomId)) === "true";
  } catch {
    return false;
  }
}

export function markSeen(roomId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(seenHintsKey(roomId), "true");
  } catch {
    /* swallow — Safari private mode or quota */
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm test -- emxHintsSeen`
Expected: 8 tests passing across 4 describe blocks.

- [ ] **Step 5: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness add src/lib/voting/emxHintsSeen.ts src/lib/voting/emxHintsSeen.test.ts
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness commit -m "$(cat <<'EOF'
voting: emxHintsSeen module for per-room hints-seen flag

SSR-safe localStorage read/write for the emx_hints_seen_{roomId}
flag consumed by Phase S2's hint-collapse default. Guards window
undefined and localStorage throws (Safari private mode, quota).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `nextHintExpansion` reducer + `useHintExpansion` hook

**Files:**
- Create: `src/components/voting/useHintExpansion.ts`
- Test: `src/components/voting/useHintExpansion.test.ts`

TDD applies for the reducer (the unit-tested core). The hook itself is wired around the reducer with `useReducer` + two `useEffect`s + `useMemo`; no test for those — manually verified during the §7 smoke pass in Task 5.

- [ ] **Step 1: Write the failing reducer test**

Create `src/components/voting/useHintExpansion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  nextHintExpansion,
  type HintExpansionState,
} from "./useHintExpansion";

const NAMES = ["Vocals", "Music", "Outfit"] as const;

function initialState(roomSeen: boolean, contestantId = "C1"): HintExpansionState {
  return nextHintExpansion(
    {} as HintExpansionState,
    { type: "init", roomSeen, contestantId },
  );
}

describe("nextHintExpansion", () => {
  it("init when roomSeen=true → not onboarding, no overrides", () => {
    const state = initialState(true);
    expect(state).toEqual({
      contestantId: "C1",
      onboarding: false,
      overrides: {},
    });
  });

  it("init when roomSeen=false → onboarding=true, no overrides", () => {
    const state = initialState(false);
    expect(state).toEqual({
      contestantId: "C1",
      onboarding: true,
      overrides: {},
    });
  });

  it("contestantChanged clears overrides, keeps onboarding flag, updates id", () => {
    const seeded: HintExpansionState = {
      contestantId: "C1",
      onboarding: true,
      overrides: { Vocals: false },
    };
    const next = nextHintExpansion(seeded, {
      type: "contestantChanged",
      contestantId: "C2",
    });
    expect(next).toEqual({
      contestantId: "C2",
      onboarding: true,
      overrides: {},
    });
  });

  it("contestantChanged preserves onboarding=false too", () => {
    const seeded: HintExpansionState = {
      contestantId: "C1",
      onboarding: false,
      overrides: { Vocals: true },
    };
    const next = nextHintExpansion(seeded, {
      type: "contestantChanged",
      contestantId: "C2",
    });
    expect(next.onboarding).toBe(false);
    expect(next.overrides).toEqual({});
    expect(next.contestantId).toBe("C2");
  });

  it("toggle while onboarding flips effective value (true→false) and clears onboarding", () => {
    const state = initialState(false); // onboarding = true (default expanded)
    const next = nextHintExpansion(state, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    expect(next.overrides).toEqual({ Vocals: false });
    expect(next.onboarding).toBe(false);
  });

  it("toggle while steady flips effective value (false→true), onboarding stays false", () => {
    const state = initialState(true); // onboarding = false (default collapsed)
    const next = nextHintExpansion(state, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    expect(next.overrides).toEqual({ Vocals: true });
    expect(next.onboarding).toBe(false);
  });

  it("toggle twice on the same name returns to default", () => {
    const state = initialState(true); // default collapsed (false)
    const after1 = nextHintExpansion(state, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    const after2 = nextHintExpansion(after1, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    expect(after2.overrides).toEqual({ Vocals: false });
  });

  it("scored from onboarding → onboarding flips false, overrides untouched", () => {
    const state = initialState(false);
    const next = nextHintExpansion(state, { type: "scored" });
    expect(next.onboarding).toBe(false);
    expect(next.overrides).toEqual({});
    expect(next.contestantId).toBe("C1");
  });

  it("scored when already steady is identity (referentially equal)", () => {
    const state = initialState(true);
    const next = nextHintExpansion(state, { type: "scored" });
    expect(next).toBe(state);
  });

  it("navigated mirrors scored", () => {
    const state = initialState(false);
    const next = nextHintExpansion(state, { type: "navigated" });
    expect(next.onboarding).toBe(false);
    expect(next.overrides).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm test -- useHintExpansion`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reducer + hook**

Create `src/components/voting/useHintExpansion.ts`:

```ts
import { useEffect, useMemo, useReducer, useCallback } from "react";
import { isSeen, markSeen } from "@/lib/voting/emxHintsSeen";

export type HintExpansionState = {
  contestantId: string;
  onboarding: boolean;
  overrides: Record<string, boolean>;
};

export type HintExpansionEvent =
  | { type: "init"; roomSeen: boolean; contestantId: string }
  | { type: "contestantChanged"; contestantId: string }
  | {
      type: "toggle";
      name: string;
      namesInDisplayOrder: readonly string[];
    }
  | { type: "scored" }
  | { type: "navigated" };

export function nextHintExpansion(
  state: HintExpansionState,
  event: HintExpansionEvent,
): HintExpansionState {
  switch (event.type) {
    case "init":
      return {
        contestantId: event.contestantId,
        onboarding: !event.roomSeen,
        overrides: {},
      };
    case "contestantChanged":
      if (event.contestantId === state.contestantId) return state;
      return {
        contestantId: event.contestantId,
        onboarding: state.onboarding,
        overrides: {},
      };
    case "toggle": {
      const currentEffective =
        state.overrides[event.name] ?? state.onboarding;
      return {
        contestantId: state.contestantId,
        onboarding: false,
        overrides: { ...state.overrides, [event.name]: !currentEffective },
      };
    }
    case "scored":
    case "navigated":
      if (!state.onboarding) return state;
      return { ...state, onboarding: false };
  }
}

export interface UseHintExpansionResult {
  expandedFor: Record<string, boolean>;
  toggleFor: (name: string) => void;
  onScored: () => void;
  onNavigated: () => void;
  onboarding: boolean;
}

export function useHintExpansion(
  roomId: string | undefined,
  contestantId: string,
  categoryNames: readonly string[],
): UseHintExpansionResult {
  const [state, dispatch] = useReducer(
    nextHintExpansion,
    { contestantId, roomId },
    (init) =>
      nextHintExpansion({} as HintExpansionState, {
        type: "init",
        roomSeen: init.roomId ? isSeen(init.roomId) : true,
        contestantId: init.contestantId,
      }),
  );

  useEffect(() => {
    dispatch({ type: "contestantChanged", contestantId });
  }, [contestantId]);

  useEffect(() => {
    if (!state.onboarding && roomId) {
      markSeen(roomId);
    }
  }, [state.onboarding, roomId]);

  const expandedFor = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const name of categoryNames) {
      result[name] = state.overrides[name] ?? state.onboarding;
    }
    return result;
  }, [categoryNames, state.overrides, state.onboarding]);

  const toggleFor = useCallback(
    (name: string) =>
      dispatch({
        type: "toggle",
        name,
        namesInDisplayOrder: categoryNames,
      }),
    [categoryNames],
  );

  const onScored = useCallback(() => dispatch({ type: "scored" }), []);
  const onNavigated = useCallback(() => dispatch({ type: "navigated" }), []);

  return {
    expandedFor,
    toggleFor,
    onScored,
    onNavigated,
    onboarding: state.onboarding,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm test -- useHintExpansion`
Expected: 10 reducer tests passing.

- [ ] **Step 5: Run type-check**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm run type-check`
Expected: clean exit (0).

- [ ] **Step 6: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness add src/components/voting/useHintExpansion.ts src/components/voting/useHintExpansion.test.ts
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness commit -m "$(cat <<'EOF'
voting: nextHintExpansion reducer + useHintExpansion hook

Pure reducer with two pieces of state: a session-wide onboarding flag
(survives navigation, flips on first action) and per-contestant
overrides (reset on contestantId change). Hook wraps the reducer with
useReducer + two useEffects + useMemo and reads/writes the
emx_hints_seen_{roomId} flag at mount and on onboarding-flip.

10 reducer tests cover init, contestantChanged, toggle (both
onboarding and steady states), scored/navigated identity branch, and
double-toggle returns to default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `<ScaleAnchorsSheet>` + `<ScoreRow>` refactor + `<VotingView>` integration

**Files:**
- Create: `src/components/voting/ScaleAnchorsSheet.tsx`
- Modify: `src/components/voting/ScoreRow.tsx`
- Modify: `src/components/voting/VotingView.tsx`

Single coupled commit. The sheet is unused without the header trigger; the row refactor and the hook wiring together remove the existing scale strip without breaking layout. All three changes land together so the worktree is type-check-clean at the commit boundary.

**Component testing posture:** repo's vitest is `node`-env, no testing-library. JSX changes are manually smoke-tested in Step 6.

- [ ] **Step 1: Create `<ScaleAnchorsSheet>`**

Create `src/components/voting/ScaleAnchorsSheet.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

export interface ScaleAnchorsSheetProps {
  open: boolean;
  onClose: () => void;
}

const ANCHORS: ReadonlyArray<{ value: 1 | 5 | 10; key: "1" | "5" | "10" }> = [
  { value: 1, key: "1" },
  { value: 5, key: "5" },
  { value: 10, key: "10" },
];

export default function ScaleAnchorsSheet({
  open,
  onClose,
}: ScaleAnchorsSheetProps) {
  const t = useTranslations();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scale-anchors-title"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className="relative w-full max-w-xl bg-background rounded-t-xl border-t border-border p-6 space-y-4 animate-fade-in"
      >
        <div className="flex items-center justify-between">
          <h2
            id="scale-anchors-title"
            className="text-lg font-bold tracking-tight"
          >
            {t("voting.scale.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("voting.scale.closeAria")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-3">
          {ANCHORS.map(({ value, key }) => (
            <li key={value} className="flex items-baseline gap-3">
              <span className="text-2xl font-bold text-primary tabular-nums w-8 text-right">
                {value}
              </span>
              <span className="text-base text-foreground">
                {t(`voting.scale.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Refactor `<ScoreRow>`**

Replace the entire contents of `src/components/voting/ScoreRow.tsx` with:

```tsx
"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { nextScore } from "./nextScore";

export interface ScoreRowProps {
  categoryName: string;
  hint?: string;
  hintExpanded?: boolean;
  onToggleHint?: () => void;
  value: number | null;
  weightMultiplier?: number;
  onChange: (next: number | null) => void;
  disabled?: boolean;
}

const BUTTONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const ANIMATION_MS = 320;

export default function ScoreRow({
  categoryName,
  hint,
  hintExpanded = false,
  onToggleHint,
  value,
  weightMultiplier,
  onChange,
  disabled = false,
}: ScoreRowProps) {
  const [lastPressed, setLastPressed] = useState<number | null>(null);
  const hintId = useId();
  const t = useTranslations();

  useEffect(() => {
    if (lastPressed === null) return;
    const timer = setTimeout(() => setLastPressed(null), ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [lastPressed]);

  const showWeightBadge =
    typeof weightMultiplier === "number" && weightMultiplier >= 2;
  const scored = value !== null;
  const statusText = scored
    ? t("voting.status.scored", { value })
    : t("voting.status.unscored");

  function handleClick(n: number) {
    if (disabled) return;
    onChange(nextScore(value, n));
    setLastPressed(n);
  }

  return (
    <div
      className={`space-y-2 ${disabled ? "opacity-50" : ""}`}
      data-testid="score-row"
    >
      <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
        <span className="font-medium text-foreground truncate">
          {categoryName}
        </span>
        {showWeightBadge && (
          <span className="inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
            counts {weightMultiplier}×
          </span>
        )}
        {hint && onToggleHint && (
          <button
            type="button"
            onClick={onToggleHint}
            aria-expanded={hintExpanded}
            aria-controls={hintId}
            aria-label={t(
              hintExpanded
                ? "voting.hint.toggleAria.expanded"
                : "voting.hint.toggleAria.collapsed",
              { category: categoryName },
            )}
            className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-muted-foreground text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground"
          >
            i
          </button>
        )}
        <span className="text-sm text-muted-foreground">·</span>
        <span
          className={`text-sm ${
            scored ? "text-primary font-medium" : "text-muted-foreground"
          }`}
        >
          {statusText}
        </span>
      </div>

      {hint && hintExpanded && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      <div
        className="relative grid grid-cols-10 w-full h-11 rounded-lg overflow-hidden border border-border bg-muted"
        role="group"
        aria-label={`${categoryName} — score from 1 to 10`}
        data-no-swipe
      >
        {BUTTONS.map((n, i) => {
          const filled = value !== null && n <= value;
          const selected = value === n;
          const pop = lastPressed === n;
          const isLast = i === BUTTONS.length - 1;
          return (
            <button
              key={n}
              type="button"
              onClick={() => handleClick(n)}
              disabled={disabled}
              aria-label={`${categoryName}: score ${n}`}
              aria-pressed={selected}
              aria-describedby={hint && hintExpanded ? hintId : undefined}
              className={`
                h-11 font-semibold text-sm transition-colors
                focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring
                disabled:cursor-not-allowed
                ${!isLast ? "border-r border-border/30" : ""}
                ${filled ? "bg-primary text-primary-foreground" : "text-muted-foreground"}
                ${pop ? "animate-score-pop" : ""}
              `.trim()}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire `<VotingView>`**

Open `src/components/voting/VotingView.tsx`. Apply these changes (in order):

**3a. Imports.** Add at the top of the existing import block:

```tsx
import ScaleAnchorsSheet from "@/components/voting/ScaleAnchorsSheet";
import { useHintExpansion } from "@/components/voting/useHintExpansion";
import { useTranslations } from "next-intl";
```

Remove the `SCORE_ANCHORS` import (no longer used after Step 3c).

**3b. Hook usage.** Inside the component body, after the existing `useState` calls and before the early returns, add:

```tsx
const t = useTranslations();
const [scaleSheetOpen, setScaleSheetOpen] = useState(false);
```

After the `contestant` and `categoryNames` derivations (around line 257-259 in the current file — directly after `const categoryNames = categories.map((c) => c.name);`), add:

```tsx
const hintExpansion = useHintExpansion(
  roomId,
  contestant.id,
  categoryNames,
);
```

**3c. Replace the Scale strip block.** Remove the existing block that renders:

```tsx
<p className="text-xs text-muted-foreground text-center">
  Scale: <span className="font-medium">1</span> {SCORE_ANCHORS[1].split(".")[0]} ·{" "}
  <span className="font-medium">5</span> {SCORE_ANCHORS[5].split(".")[0]} ·{" "}
  <span className="font-medium">10</span> {SCORE_ANCHORS[10].split(".")[0]}
</p>
```

It is currently between the `</header>` and the `{isMissed ? (` ternary. Replace it with: nothing (just delete the `<p>`).

**3d. Add the ⓘ trigger to the header.** Inside the header `<div className="flex flex-col items-end gap-1 flex-shrink-0">` block (the right column), add an ⓘ button at the top, before the existing `{saveStatus !== undefined && <SaveChip ... />}` line:

```tsx
<button
  type="button"
  onClick={() => setScaleSheetOpen(true)}
  aria-label={t("voting.scale.openAria")}
  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground text-xs text-muted-foreground hover:text-foreground hover:border-foreground"
>
  i
</button>
```

**3e. Mount the sheet.** Just before the closing `</main>` tag (the very end of the component's JSX), add:

```tsx
<ScaleAnchorsSheet
  open={scaleSheetOpen}
  onClose={() => setScaleSheetOpen(false)}
/>
```

**3f. Wire the hook into `<ScoreRow>`.** In the existing `categories.map((cat) => (` block, add the new props:

```tsx
<ScoreRow
  key={cat.name}
  categoryName={cat.name}
  hint={cat.hint}
  hintExpanded={hintExpansion.expandedFor[cat.name]}
  onToggleHint={() => hintExpansion.toggleFor(cat.name)}
  value={scoresByContestant[contestant.id]?.[cat.name] ?? null}
  weightMultiplier={nonUniformWeights ? cat.weight : undefined}
  // ...all other existing props unchanged
/>
```

**3g. Wire `onScored` and `onNavigated`.** Locate the existing `handleScoreChange` (or whatever inline arrow function is passed to `ScoreRow`'s `onChange`). Wrap or extend it so that whenever a score actually changes, `hintExpansion.onScored()` is called. Same for the navigation handlers — `goPrev`, `goNext`, swipe handler, and the jump-to-drawer's selection handler should each call `hintExpansion.onNavigated()` before the `setIdx(...)` (or equivalent).

If a single `handleScoreChange` consolidates score updates: call `hintExpansion.onScored()` at its top.

If navigation handlers are inline arrow functions on the prev/next buttons, wrap them:

```tsx
onClick={() => {
  hintExpansion.onNavigated();
  setIdx((i) => Math.max(0, i - 1));
}}
```

**3h. Add the onboarding microcopy.** Below the `categories.map(...)` block (i.e. after the `<ScoreRow>`s render and before the hot-take pill), add:

```tsx
{hintExpansion.onboarding && (
  <p className="text-xs text-muted-foreground text-center mt-2">
    {t("voting.hint.onboarding")}
  </p>
)}
```

- [ ] **Step 4: Run type-check**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm run type-check`
Expected: clean exit (0). Common issues to look for if it fails:
- Unused `SCORE_ANCHORS` import not removed.
- Missing `next-intl` import in `ScoreRow`.
- Misplaced `useHintExpansion` call (must be after `contestant` is defined or guarded by the early returns).

- [ ] **Step 5: Run the full test suite**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm test`
Expected: all suites pass; new reducer tests + module tests included; no existing test references the removed scale strip text.

- [ ] **Step 6: Manual smoke test in dev server**

Start dev server in the BACKGROUND (use Bash `run_in_background: true`):

```
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm run dev
```

Wait ~5 seconds. Probe:

```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

Expected: `200`. If not, check the dev-server background output for compile errors and fix.

Stop the server with `pkill -f "next dev" || true`.

Click-through verification (the controller will do this manually after the commit; it requires creating a real test room): start the dev server, open the wizard, create a room, join as a participant, navigate to the voting view. Verify:
- Header has an ⓘ button next to the running-order/progress cluster.
- Tapping the ⓘ opens a bottom-sheet with three rows: `1 Devastating`, `5 Fine`, `10 Iconic`. ✕ and Esc dismiss it.
- Below the header, the global "Scale: …" strip is GONE.
- Each category row shows `name · status` on a single line. The right-aligned status pill is GONE.
- When a category has a hint, an ⓘ button appears next to the name. Tapping toggles the hint paragraph below.
- On first entry to a fresh room (clear `localStorage` first via dev tools), all hints are expanded and a small line *"Tap ⓘ on a category to hide its hint."* appears below the score rows.
- Tapping any ⓘ, score, or navigation control makes the microcopy disappear and sets `localStorage.emx_hints_seen_<roomId> = "true"`.
- Navigating to another contestant: hints all collapsed by default, microcopy not shown.
- Reload the page: hints still collapsed (flag persists).
- Open dev tools, run `localStorage.removeItem("emx_hints_seen_<roomId>")`, reload — hints should be expanded again on the active card.

Defer the full UI verification to the controller; report only the HTTP probe in your subagent report.

- [ ] **Step 7: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness add src/components/voting/ScaleAnchorsSheet.tsx src/components/voting/ScoreRow.tsx src/components/voting/VotingView.tsx
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness commit -m "$(cat <<'EOF'
voting: compact card with scale ⓘ + collapsible hints (Phase S2)

Replace the global Scale strip with a header ⓘ → bottom-sheet
(<ScaleAnchorsSheet>) listing the three anchors. Collapse the score-
row header to a single line — name · ✓ scored N or name · Not scored
— and add an ⓘ button next to category names that toggles per-card
hint visibility via the useHintExpansion hook.

First-card onboarding: when emx_hints_seen_{roomId} is unset, all
hints render expanded with a one-line "Tap ⓘ on a category to hide
its hint." microcopy. Any score, navigation, or ⓘ-toggle flips the
flag and clears the microcopy. Subsequent contestants and refreshes
default to collapsed.

Locale keys consumed: voting.status.{scored,unscored},
voting.scale.{title,1,5,10,openAria,closeAria},
voting.hint.{onboarding,toggleAria.{collapsed,expanded}}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Final verification

**Files:** none modified.

- [ ] **Step 1: Type-check**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm run type-check 2>&1`
Expected: clean exit (0).

- [ ] **Step 2: Lint**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm run lint 2>&1`
Expected: clean exit (0). Pre-existing warning in `useRoomRealtime.ts` is acceptable; flag any NEW warnings.

- [ ] **Step 3: Full test suite**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm test 2>&1`
Expected: every suite pass; the new tests (`emxHintsSeen.test.ts` 8 cases + `useHintExpansion.test.ts` 10 cases) are included; no regressions in existing suites.

- [ ] **Step 4: Confirm `SCORE_ANCHORS` no longer imported by `VotingView`**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && grep -n "SCORE_ANCHORS" src/components/voting/VotingView.tsx || echo "NO MATCH (correct)"`
Expected: `NO MATCH (correct)`. The constant is still imported elsewhere (search the rest of the codebase shows it used in `MissedCard.tsx` etc.) — that's fine.

- [ ] **Step 5: Confirm clean git state**

Run: `git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness status -s`
Expected: empty output.

Run: `git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness log --oneline main..HEAD`
Expected list (newest first):
- Task 4: `voting: compact card with scale ⓘ + collapsible hints (Phase S2)`
- Task 3: `voting: nextHintExpansion reducer + useHintExpansion hook`
- Task 2: `voting: emxHintsSeen module for per-room hints-seen flag`
- Task 1: `locale: add voting status/scale/hint keys (en) for Phase S2`
- Spec commit (Task 0): `spec: 2026-04-26 Phase S2 voting-card compactness design`
- (Optionally) the plan commit if landed before Task 1.

5–6 commits ahead of `main`.

- [ ] **Step 6: HTTP probe**

Start dev server background:
```
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-s2-voting-compactness && npm run dev
```

Wait ~5s. Probe:
```
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
```
Expected: `HTTP 200`.

Stop:
```
pkill -f "next dev" || true
```

- [ ] **Step 7: Stop here**

The slice is complete. The controller (the parent / human) handles:
- Final manual click-through smoke on the voting view (per Task 4 Step 6 list).
- TODO.md tick on the main worktree (S2 lines).
- Push branch + open PR.

Do NOT push or open the PR from this task.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-04-26-phase-s2-voting-compactness-design.md`):

- §3.1.A Scale ⓘ replacement → Task 4 Steps 1, 3c, 3d, 3e (sheet component + remove strip + add header trigger + mount sheet).
- §3.1.B Score-row single-line header refactor → Task 4 Step 2 (full ScoreRow rewrite — single-line layout, dropped right-pill, status inline, weight badge stays).
- §3.1.C Score-row ⓘ hint collapse → Task 4 Step 2 (ⓘ button + aria-expanded + aria-controls).
- §3.1.D Hint-collapse state + flag → Task 2 (`emxHintsSeen` module) + Task 3 (`nextHintExpansion` reducer + `useHintExpansion` hook).
- §3.1.E First-card onboarding microcopy → Task 4 Step 3h.
- §3.1.F Locale keys → Task 1.
- §6 Tests → Task 2 module tests (8 cases), Task 3 reducer tests (10 cases). JSX manually smoke-verified.
- §7 Acceptance → Task 4 Step 6 + Task 5.
- §9 Slicing → Tasks 1, 2, 3, 4 each = one commit; Task 5 = verification (no commit).

No gaps.

**Placeholder scan:** no "TBD", "TODO", "implement later", or empty steps. Each step has either complete code, an exact command, or a precise editing instruction with line-level location.

**Type consistency:**
- `HintExpansionState` and `HintExpansionEvent` defined once in Task 3 Step 3, used identically in Task 3 Step 1 (the test file).
- `nextHintExpansion(state, event)` signature matches across reducer body and test.
- `UseHintExpansionResult` field names (`expandedFor`, `toggleFor`, `onScored`, `onNavigated`, `onboarding`) used identically in Task 3 Step 3 and Task 4 Step 3f/3g/3h.
- `seenHintsKey`, `isSeen`, `markSeen` named consistently across module + tests.
- `ScaleAnchorsSheetProps`, `ScoreRowProps` field names match between component definitions and consumer call sites in `VotingView`.
- `voting.scale.1`, `voting.scale.5`, `voting.scale.10` keys match between `en.json` (Task 1), `<ScaleAnchorsSheet>` `t(\`voting.scale.${key}\`)` lookup (Task 4 Step 1), and the spec.
- `voting.status.scored` ICU param `{value}`, `voting.hint.toggleAria.*` ICU param `{category}` — consumer call sites in `<ScoreRow>` (Task 4 Step 2) match.
