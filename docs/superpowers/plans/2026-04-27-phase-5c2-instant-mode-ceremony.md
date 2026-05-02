# Phase 5c.2 instant-mode reveal ceremony — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two coupled ceremonies deferred from 5c.1 — a per-user 12-point reveal on each phone before the admin tap, and a worst-to-best animated leaderboard reveal between the admin tap and `/results/{id}`. Both client-only.

**Architecture:** Pure-helper-first per the repo's posture. `leaderboardSequence` (snapshot generator), `staggerTick` (elapsed-ms → step), and `sessionRevealedFlag` (sessionStorage wrapper) live in `src/lib/instant/` with vitest unit tests. Two thin React components (`OwnPointsCeremony`, `LeaderboardCeremony`) and one hook (`useStaggeredReveal`) wire the helpers to JSX; smoke-tested manually under `npm run dev` per repo posture (matching `RevealCtaPanel.tsx` from 5c.1). No DB migration, no new endpoint, no new `RoomEvent` variant. `LeaderboardCeremony` re-uses the public `GET /api/results/{id}` for its data.

**Tech Stack:** Next.js 14 + React 18, TypeScript strict, Tailwind, next-intl 3, Vitest (node env, no jsdom).

**Spec:** [docs/superpowers/specs/2026-04-27-phase-5c2-instant-mode-ceremony-design.md](../specs/2026-04-27-phase-5c2-instant-mode-ceremony-design.md)

**Worktree:** `/Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony`
**Branch:** `feat/phase-5c2-instant-mode-ceremony`

For every git command, use `git -C <worktree-path>`. Before each commit run `git -C <worktree-path> rev-parse --abbrev-ref HEAD` and confirm `feat/phase-5c2-instant-mode-ceremony`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/instant/leaderboardSequence.ts` | Create | Pure: build ordered intermediate snapshots from final leaderboard + contestants |
| `src/lib/instant/leaderboardSequence.test.ts` | Create | Unit tests — empty, no-tie, ties, missing contestants, 0-point entries |
| `src/lib/instant/staggerTick.ts` | Create | Pure: elapsedMs → currentStep with clamp |
| `src/lib/instant/staggerTick.test.ts` | Create | Unit tests — boundaries, clamping, negative-time safety |
| `src/lib/instant/sessionRevealedFlag.ts` | Create | sessionStorage wrapper with SSR + throw guards |
| `src/lib/instant/sessionRevealedFlag.test.ts` | Create | Unit tests — happy path, isolation, SSR, throw safety |
| `src/components/instant/useStaggeredReveal.ts` | Create | React hook wrapping staggerTick over `requestAnimationFrame` |
| `src/components/instant/OwnPointsCeremony.tsx` | Create | Per-user 12-point reveal (Piece A) |
| `src/components/instant/LeaderboardCeremony.tsx` | Create | Worst-to-best leaderboard ceremony (Piece B) |
| `src/components/room/InstantAnnouncingView.tsx` | Modify | Swap `<InstantOwnBreakdown>` → `<OwnPointsCeremony>`; gate Ready CTA on allRevealed |
| `src/components/room/InstantOwnBreakdown.tsx` | Delete | Replaced by `OwnPointsCeremony` |
| `src/app/room/[id]/page.tsx` | Modify | When `done` + `instant` + flag-unset → render `<LeaderboardCeremony>`; else existing `DoneCard` |
| `src/locales/en.json` | Modify | Add 7 keys (`instantAnnounce.ownResults.{revealTwelveButton,revealTwelveSkip,twelveLabel}`, `instantAnnounce.ceremony.{subtitle,redirectingIn,stayHere,seeFullResults}`) |
| `todo.md` | Modify | Flip 5c.2 row to `[x]` after smoke verification |

**Note on tests:** the repo uses `vitest` with `environment: "node"` — no jsdom, no `@testing-library/react`. JSX components and hooks are smoke-tested manually under `npm run dev`. Only the three pure helpers in `src/lib/instant/` get unit tests (matching the posture established by `nextRevealCtaState.ts` from 5c.1).

---

### Task 1: Set up worktree + branch

**Files:** none yet

- [ ] **Step 1: Create worktree**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing
git worktree add .claude/worktrees/phase-5c2-instant-mode-ceremony -b feat/phase-5c2-instant-mode-ceremony main
```

Expected: `Preparing worktree (new branch 'feat/phase-5c2-instant-mode-ceremony')` then `HEAD is now at <sha> ...`

- [ ] **Step 2: Verify**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony rev-parse --abbrev-ref HEAD
```

Expected: `feat/phase-5c2-instant-mode-ceremony`

- [ ] **Step 3: Install deps in the worktree (sanity)**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm install
```

Expected: no errors. (npm reuses the root `node_modules` if symlinked; if not, this materialises one.)

- [ ] **Step 4: Confirm clean tree + green tests**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run pre-push
```

Expected: type-check passes; all tests green.

---

### Task 2: Pure helper — `leaderboardSequence` (TDD)

**Files:**
- Create: `src/lib/instant/leaderboardSequence.ts`
- Create: `src/lib/instant/leaderboardSequence.test.ts`

This is the snapshot generator. Given the final leaderboard (best→worst) and the contestant field, it produces a list of `LeaderboardSnapshot[]` arrays — one per ceremony step, walking worst→best.

- [ ] **Step 1: Write the failing tests first**

Create `src/lib/instant/leaderboardSequence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  leaderboardSequence,
  type LeaderboardSnapshot,
} from "./leaderboardSequence";
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

function mkContestant(id: string, country = id): Contestant {
  return {
    id,
    year: 2026,
    event: "final",
    countryCode: id.split("-")[1] ?? "XX",
    country,
    artist: "Artist",
    song: "Song",
    flagEmoji: "🏳️",
    runningOrder: 1,
  };
}

describe("leaderboardSequence", () => {
  it("returns one initial snapshot when there are no contestants", () => {
    const seq = leaderboardSequence([], []);
    expect(seq).toHaveLength(1);
    expect(seq[0]).toEqual([]);
  });

  it("produces N+1 snapshots for N contestants (initial + one per reveal)", () => {
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    expect(seq).toHaveLength(4);
  });

  it("initial snapshot has every contestant at 0 pts and null rank, sorted by contestantId", () => {
    const contestants = [
      mkContestant("2026-UK"),
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    expect(seq[0]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-AT", pointsAwarded: 0, rank: null },
      { contestantId: "2026-FR", pointsAwarded: 0, rank: null },
      { contestantId: "2026-UK", pointsAwarded: 0, rank: null },
    ]);
  });

  it("reveals worst-first; intermediate snapshots include partial reveals re-sorted by points desc", () => {
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // After step 1: AT (worst, 4 pts) is revealed; FR + UK still at 0.
    expect(seq[1]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-AT", pointsAwarded: 4, rank: 3 },
      { contestantId: "2026-FR", pointsAwarded: 0, rank: null },
      { contestantId: "2026-UK", pointsAwarded: 0, rank: null },
    ]);
    // After step 2: FR (8 pts) climbs above AT.
    expect(seq[2]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-FR", pointsAwarded: 8, rank: 2 },
      { contestantId: "2026-AT", pointsAwarded: 4, rank: 3 },
      { contestantId: "2026-UK", pointsAwarded: 0, rank: null },
    ]);
    // Final snapshot: full leaderboard.
    expect(seq[3]).toEqual<LeaderboardSnapshot[]>([
      { contestantId: "2026-UK", pointsAwarded: 12, rank: 1 },
      { contestantId: "2026-FR", pointsAwarded: 8, rank: 2 },
      { contestantId: "2026-AT", pointsAwarded: 4, rank: 3 },
    ]);
  });

  it("preserves competition-rank ties in the final snapshot (1, 2, 2, 4 pattern)", () => {
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-IT"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
      { contestantId: "2026-IT", totalPoints: 8, rank: 2 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 4 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // Final snapshot ranks reflect input.
    expect(seq[seq.length - 1].map((s) => s.rank)).toEqual([1, 2, 2, 4]);
  });

  it("walks worst-first using contestantId as the inner tiebreak among tied final ranks", () => {
    // FR (8, rank 2) and IT (8, rank 2) — IT comes first alphabetically by id "2026-IT" > "2026-FR" so FR is "worse" in walk order.
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-IT"),
    ];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-FR", totalPoints: 8, rank: 1 },
      { contestantId: "2026-IT", totalPoints: 8, rank: 1 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 3 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // First reveal is the worst — AT (rank 3).
    const firstRevealed = seq[1].find((s) => s.pointsAwarded > 0);
    expect(firstRevealed?.contestantId).toBe("2026-AT");
    // Second reveal walks ties worst-first by contestantId desc within the tie band.
    // IT > FR alphabetically, so within the "rank 1, 8 pts" tie band, IT is revealed before FR.
    const secondRevealed = seq[2]
      .filter((s) => s.pointsAwarded > 0)
      .map((s) => s.contestantId)
      .sort();
    expect(secondRevealed).toEqual(["2026-AT", "2026-IT"]);
  });

  it("includes contestants in the field that are missing from the leaderboard at 0 pts (defensive)", () => {
    // Real data always seeds via buildLeaderboardSeeded so this is unreachable, but the helper is robust.
    const contestants = [
      mkContestant("2026-AT"),
      mkContestant("2026-FR"),
      mkContestant("2026-UK"),
    ];
    const final: LeaderboardEntry[] = [
      // FR missing from the leaderboard.
      { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
      { contestantId: "2026-AT", totalPoints: 4, rank: 2 },
    ];

    const seq = leaderboardSequence(final, contestants);
    // Initial includes FR at 0.
    const ids = seq[0].map((s) => s.contestantId);
    expect(ids).toContain("2026-FR");
    // FR stays at 0 in every snapshot — never gets revealed.
    for (const snap of seq) {
      const fr = snap.find((s) => s.contestantId === "2026-FR");
      expect(fr?.pointsAwarded).toBe(0);
      expect(fr?.rank).toBeNull();
    }
    // 2 reveals happened (UK + AT), so 3 snapshots total.
    expect(seq).toHaveLength(3);
  });

  it("handles 0-point leaderboard entries — they still count as a reveal step (rank becomes non-null)", () => {
    const contestants = [mkContestant("2026-AT"), mkContestant("2026-UK")];
    const final: LeaderboardEntry[] = [
      { contestantId: "2026-UK", totalPoints: 8, rank: 1 },
      { contestantId: "2026-AT", totalPoints: 0, rank: 2 },
    ];

    const seq = leaderboardSequence(final, contestants);
    expect(seq).toHaveLength(3);
    // Step 1: AT (worst per leaderboard) gets revealed at 0 pts; rank is now 2 (no longer null).
    const at1 = seq[1].find((s) => s.contestantId === "2026-AT");
    expect(at1).toEqual({ contestantId: "2026-AT", pointsAwarded: 0, rank: 2 });
  });
});
```

- [ ] **Step 2: Run the tests — verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npx vitest run src/lib/instant/leaderboardSequence.test.ts
```

Expected: FAIL — `Cannot find module './leaderboardSequence'` or similar.

- [ ] **Step 3: Implement `leaderboardSequence.ts`**

Create `src/lib/instant/leaderboardSequence.ts`:

```ts
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

export interface LeaderboardSnapshot {
  contestantId: string;
  pointsAwarded: number;
  rank: number | null;
}

/**
 * Sort revealed-and-unrevealed rows by points desc, then contestantId asc.
 * Mirrors loadResults.buildLeaderboard's secondary sort.
 */
function sortSnapshot(rows: LeaderboardSnapshot[]): LeaderboardSnapshot[] {
  return [...rows].sort((a, b) => {
    if (a.pointsAwarded !== b.pointsAwarded) {
      return b.pointsAwarded - a.pointsAwarded;
    }
    return a.contestantId.localeCompare(b.contestantId);
  });
}

/**
 * Build the ceremony's snapshot timeline.
 *
 * Step 0: every contestant at 0 pts, null rank, sorted alphabetically.
 * Step k (k ∈ 1..N): the k worst leaderboard entries are "revealed" (their
 * pointsAwarded + rank applied); the rest stay at 0 pts / null rank.
 * Step N: matches the input leaderboard.
 *
 * Walk order is the input leaderboard reversed — i.e. worst rank first.
 * Ties are broken by contestantId asc (same as loadResults).
 */
export function leaderboardSequence(
  finalLeaderboard: LeaderboardEntry[],
  contestants: Contestant[],
): LeaderboardSnapshot[][] {
  // Map every contestant to a starting (0 pts, null rank) snapshot.
  const baseRows: LeaderboardSnapshot[] = contestants.map((c) => ({
    contestantId: c.id,
    pointsAwarded: 0,
    rank: null,
  }));

  // The reveal walk: leaderboard reversed — worst rank first.
  // Within tied final ranks, walk worst-to-best by contestantId desc so
  // that "earlier in the walk = worse" stays consistent.
  const walk = [...finalLeaderboard].sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank; // higher rank number = worse
    return b.contestantId.localeCompare(a.contestantId); // tie: desc by id
  });

  const snapshots: LeaderboardSnapshot[][] = [];

  // Step 0: initial.
  snapshots.push(sortSnapshot(baseRows));

  // Apply each reveal sequentially.
  let revealed = new Map<string, LeaderboardSnapshot>();
  for (const entry of walk) {
    revealed.set(entry.contestantId, {
      contestantId: entry.contestantId,
      pointsAwarded: entry.totalPoints,
      rank: entry.rank,
    });
    const next: LeaderboardSnapshot[] = baseRows.map((r) =>
      revealed.get(r.contestantId) ?? r,
    );
    snapshots.push(sortSnapshot(next));
  }

  return snapshots;
}
```

- [ ] **Step 4: Run the tests — verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npx vitest run src/lib/instant/leaderboardSequence.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/lib/instant/leaderboardSequence.ts src/lib/instant/leaderboardSequence.test.ts
git commit -m "$(cat <<'EOF'
feat(instant): leaderboardSequence pure snapshot generator

Walks the final leaderboard worst→best and produces one snapshot per
reveal step. Initial snapshot has every contestant at 0 pts / null rank;
each subsequent snapshot applies one more reveal and re-sorts by points
desc (matching loadResults.buildLeaderboard's tiebreak).

Backbone of <LeaderboardCeremony>: combined with staggerTick the React
layer becomes a pure render function of currentStep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Pure helper — `staggerTick` (TDD)

**Files:**
- Create: `src/lib/instant/staggerTick.ts`
- Create: `src/lib/instant/staggerTick.test.ts`

The pure arithmetic that maps `(elapsedMs, staggerMs, totalSteps)` → `currentStep`. The React hook will call this on every animation frame.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/instant/staggerTick.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { staggerTick } from "./staggerTick";

describe("staggerTick", () => {
  const opts = (elapsedMs: number) => ({
    elapsedMs,
    staggerMs: 250,
    totalSteps: 5,
  });

  it("returns 0 at elapsedMs = 0 (initial snapshot, no reveals applied)", () => {
    expect(staggerTick(opts(0))).toBe(0);
  });

  it("returns 1 at elapsedMs = staggerMs", () => {
    expect(staggerTick(opts(250))).toBe(1);
  });

  it("stays on the same step until next stagger boundary", () => {
    expect(staggerTick(opts(251))).toBe(1);
    expect(staggerTick(opts(499))).toBe(1);
  });

  it("advances to step 2 at exactly 2 × staggerMs", () => {
    expect(staggerTick(opts(500))).toBe(2);
  });

  it("clamps at totalSteps once elapsed reaches staggerMs × totalSteps", () => {
    expect(staggerTick(opts(1250))).toBe(5);
    expect(staggerTick(opts(9999))).toBe(5);
  });

  it("returns 0 for negative elapsed (defensive)", () => {
    expect(staggerTick(opts(-100))).toBe(0);
  });

  it("returns 0 for totalSteps = 0 regardless of elapsed", () => {
    expect(
      staggerTick({ elapsedMs: 9999, staggerMs: 250, totalSteps: 0 }),
    ).toBe(0);
  });

  it("returns 0 for staggerMs = 0 (degenerate; avoid divide-by-zero)", () => {
    expect(
      staggerTick({ elapsedMs: 100, staggerMs: 0, totalSteps: 3 }),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npx vitest run src/lib/instant/staggerTick.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `staggerTick.ts`**

Create `src/lib/instant/staggerTick.ts`:

```ts
export interface StaggerTickInput {
  elapsedMs: number;
  staggerMs: number;
  totalSteps: number;
}

/**
 * Maps elapsed time since ceremony start to the current snapshot step.
 *
 * - Step 0 = initial snapshot (no reveals applied).
 * - Step N = leaderboard fully revealed.
 *
 * elapsedMs in [0, staggerMs) → step 0
 * elapsedMs in [k×staggerMs, (k+1)×staggerMs) → step k
 * elapsedMs >= totalSteps × staggerMs → totalSteps (clamped, complete)
 *
 * Negative elapsed, totalSteps=0, staggerMs=0 all degrade to step 0.
 */
export function staggerTick(input: StaggerTickInput): number {
  const { elapsedMs, staggerMs, totalSteps } = input;
  if (totalSteps <= 0) return 0;
  if (staggerMs <= 0) return 0;
  if (elapsedMs <= 0) return 0;
  const raw = Math.floor(elapsedMs / staggerMs);
  return Math.min(raw, totalSteps);
}
```

- [ ] **Step 4: Run — verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npx vitest run src/lib/instant/staggerTick.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/lib/instant/staggerTick.ts src/lib/instant/staggerTick.test.ts
git commit -m "$(cat <<'EOF'
feat(instant): staggerTick pure elapsed-to-step mapper

Pure arithmetic for the leaderboard ceremony's stagger animation. The
hook (next task) calls this every animation frame; the result drives
the LeaderboardSnapshot index that React renders.

Defensive against negative elapsed, totalSteps=0, staggerMs=0 — all
collapse to step 0 rather than NaN/Infinity propagating into render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Pure helper — `sessionRevealedFlag` (TDD)

**Files:**
- Create: `src/lib/instant/sessionRevealedFlag.ts`
- Create: `src/lib/instant/sessionRevealedFlag.test.ts`

Mirrors the structure of `src/lib/voting/emxHintsSeen.ts` — same SSR + throw-safe pattern.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/instant/sessionRevealedFlag.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  revealedFlagKey,
  hasRevealed,
  markRevealed,
  clearRevealed,
} from "./sessionRevealedFlag";

describe("revealedFlagKey", () => {
  it("formats as emx_revealed_{roomId}", () => {
    expect(revealedFlagKey("abc-123")).toBe("emx_revealed_abc-123");
  });
});

describe("sessionRevealedFlag — happy path", () => {
  const ORIGINAL = globalThis.sessionStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "sessionStorage", {
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
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: ORIGINAL,
    });
  });

  it("hasRevealed returns false initially", () => {
    expect(hasRevealed("room-1")).toBe(false);
  });

  it("markRevealed writes 'true' to the right key", () => {
    markRevealed("room-2");
    expect(store["emx_revealed_room-2"]).toBe("true");
  });

  it("hasRevealed returns true after markRevealed", () => {
    markRevealed("room-3");
    expect(hasRevealed("room-3")).toBe(true);
  });

  it("isolates keys per roomId", () => {
    markRevealed("room-A");
    expect(hasRevealed("room-B")).toBe(false);
  });

  it("clearRevealed removes the key", () => {
    markRevealed("room-4");
    clearRevealed("room-4");
    expect(hasRevealed("room-4")).toBe(false);
  });
});

describe("sessionRevealedFlag — SSR safety", () => {
  const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  });

  it("hasRevealed returns false when window is undefined", () => {
    expect(hasRevealed("any")).toBe(false);
  });

  it("markRevealed does not throw when window is undefined", () => {
    expect(() => markRevealed("any")).not.toThrow();
  });

  it("clearRevealed does not throw when window is undefined", () => {
    expect(() => clearRevealed("any")).not.toThrow();
  });
});

describe("sessionRevealedFlag — throw safety", () => {
  const ORIGINAL = globalThis.sessionStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
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
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: ORIGINAL,
    });
  });

  it("hasRevealed returns false when sessionStorage.getItem throws", () => {
    expect(hasRevealed("any")).toBe(false);
  });

  it("markRevealed swallows when sessionStorage.setItem throws", () => {
    expect(() => markRevealed("any")).not.toThrow();
  });

  it("clearRevealed swallows when sessionStorage.removeItem throws", () => {
    expect(() => clearRevealed("any")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npx vitest run src/lib/instant/sessionRevealedFlag.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `sessionRevealedFlag.ts`**

Create `src/lib/instant/sessionRevealedFlag.ts`:

```ts
export function revealedFlagKey(roomId: string): string {
  return `emx_revealed_${roomId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined") return window.sessionStorage;
    const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return ss ?? null;
  } catch {
    return null;
  }
}

export function hasRevealed(roomId: string): boolean {
  try {
    const ss = getStorage();
    if (!ss) return false;
    return ss.getItem(revealedFlagKey(roomId)) === "true";
  } catch {
    return false;
  }
}

export function markRevealed(roomId: string): void {
  try {
    const ss = getStorage();
    if (!ss) return;
    ss.setItem(revealedFlagKey(roomId), "true");
  } catch {
    /* swallow — Safari private mode or quota */
  }
}

export function clearRevealed(roomId: string): void {
  try {
    const ss = getStorage();
    if (!ss) return;
    ss.removeItem(revealedFlagKey(roomId));
  } catch {
    /* swallow */
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npx vitest run src/lib/instant/sessionRevealedFlag.test.ts
```

Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/lib/instant/sessionRevealedFlag.ts src/lib/instant/sessionRevealedFlag.test.ts
git commit -m "$(cat <<'EOF'
feat(instant): sessionRevealedFlag — sessionStorage replay-guard

Per-room flag the leaderboard ceremony sets after first play. Subsequent
mounts (reload, late-joining guests after the moment passed) check the
flag and skip the animation, rendering the static settled leaderboard
+ "See full results →" button instead.

Mirrors src/lib/voting/emxHintsSeen.ts: SSR-safe, throw-safe under
Safari private mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: React hook — `useStaggeredReveal` (no test; manual smoke)

**Files:**
- Create: `src/components/instant/useStaggeredReveal.ts`

Thin wrapper around `staggerTick`. Drives a `requestAnimationFrame` loop, calls `setState` only when the step index changes. Cancels on unmount. `enabled: false` snaps to `totalSteps`.

- [ ] **Step 1: Implement the hook**

Create `src/components/instant/useStaggeredReveal.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { staggerTick } from "@/lib/instant/staggerTick";

export interface UseStaggeredRevealOptions {
  totalSteps: number;
  staggerMs: number;
  /** Fires once when currentStep first reaches totalSteps. */
  onComplete?: () => void;
  /** When false, snap to totalSteps immediately (used for prefers-reduced-motion). */
  enabled?: boolean;
}

export interface UseStaggeredRevealResult {
  currentStep: number;
  isComplete: boolean;
}

/**
 * Drives a stepwise stagger over `requestAnimationFrame`. Uses the pure
 * `staggerTick` helper so the arithmetic is testable in isolation.
 */
export function useStaggeredReveal(
  opts: UseStaggeredRevealOptions,
): UseStaggeredRevealResult {
  const { totalSteps, staggerMs, onComplete, enabled = true } = opts;

  const [currentStep, setCurrentStep] = useState(() =>
    enabled ? 0 : totalSteps,
  );
  const completeFiredRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setCurrentStep(totalSteps);
      if (!completeFiredRef.current) {
        completeFiredRef.current = true;
        onComplete?.();
      }
      return;
    }

    cancelledRef.current = false;
    startRef.current = null;
    completeFiredRef.current = false;

    const tick = (now: number) => {
      if (cancelledRef.current) return;
      if (startRef.current === null) startRef.current = now;
      const elapsedMs = now - startRef.current;
      const next = staggerTick({ elapsedMs, staggerMs, totalSteps });
      setCurrentStep((prev) => (prev === next ? prev : next));
      if (next >= totalSteps) {
        if (!completeFiredRef.current) {
          completeFiredRef.current = true;
          onComplete?.();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelledRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // onComplete intentionally not in deps — caller is expected to memoize or
    // tolerate identity churn (we only call it once via completeFiredRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staggerMs, totalSteps]);

  return { currentStep, isComplete: currentStep >= totalSteps };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run type-check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/components/instant/useStaggeredReveal.ts
git commit -m "$(cat <<'EOF'
feat(instant): useStaggeredReveal hook

Thin React wrapper around staggerTick — drives a requestAnimationFrame
loop, only setStates when the integer step changes (so React only
re-renders at stagger boundaries, ~4Hz at 250ms cadence). Cancels on
unmount, fires onComplete exactly once.

`enabled: false` (used for prefers-reduced-motion) snaps to
totalSteps in the first render and fires onComplete immediately —
the visual outcome is the same final-state leaderboard, just without
the stagger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Locale keys

**Files:**
- Modify: `src/locales/en.json` (extend `instantAnnounce`)

Non-`en` locales are skeleton today and pass via `it.todo()`; no other test changes needed.

- [ ] **Step 1: Read current `instantAnnounce` block**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
grep -n "instantAnnounce" src/locales/en.json
```

Confirm the block opens at the line shown.

- [ ] **Step 2: Edit `en.json`**

Inside `instantAnnounce.ownResults`, add three keys after `"empty"`:

```json
"empty": "You didn't score any contestants this round.",
"revealTwelveButton": "Reveal your 12 points",
"revealTwelveSkip": "Skip the build-up",
"twelveLabel": "Your 12 points"
```

After the `admin` object's closing `}`, before the closing `}` of `instantAnnounce`, add a new `ceremony` block:

```json
,
"ceremony": {
  "subtitle": "The room's final leaderboard",
  "redirectingIn": "Opening full results in {seconds}s…",
  "stayHere": "Stay here",
  "seeFullResults": "See full results →"
}
```

- [ ] **Step 3: Validate JSON**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json', 'utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Run locale test**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npx vitest run src/locales/locales.test.ts
```

Expected: pass — the non-`en` locales are empty so they hit `it.todo` and don't fail.

- [ ] **Step 5: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(instant): en.json keys for ceremony + 12-point reveal

Adds 7 keys under instantAnnounce:

ownResults.{revealTwelveButton, revealTwelveSkip, twelveLabel}
  — Piece A: per-user 12-point reveal affordances on the own-results
    screen (button, skip-link, post-reveal label).

ceremony.{subtitle, redirectingIn, stayHere, seeFullResults}
  — Piece B: leaderboard ceremony chrome — header, redirect timer
    copy, escape link, post-ceremony settled-state CTA.

Non-en bundles remain skeleton (Phase L L3 deferred).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Component — `OwnPointsCeremony` (Piece A)

**Files:**
- Create: `src/components/instant/OwnPointsCeremony.tsx`

Reads `ownBreakdown` (already loaded by 5c.1's `postRoomOwnPoints` call). Splits into lower nine + the 12-point pick. Lower nine render immediately; 12-point hidden behind a tap.

- [ ] **Step 1: Implement the component**

Create `src/components/instant/OwnPointsCeremony.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";
import type { OwnBreakdownEntry } from "@/components/room/InstantOwnBreakdown";
import Button from "@/components/ui/Button";

export interface OwnPointsCeremonyProps {
  entries: OwnBreakdownEntry[];
  contestants: Contestant[];
  /** Fires when the user has seen all of their picks (12 revealed, or
   *  no 12 to reveal — i.e. degenerate cases that don't gate Ready). */
  onAllRevealed: () => void;
}

export default function OwnPointsCeremony({
  entries,
  contestants,
  onAllRevealed,
}: OwnPointsCeremonyProps) {
  const t = useTranslations();

  const byId = useMemo(() => {
    const m = new Map<string, Contestant>();
    for (const c of contestants) m.set(c.id, c);
    return m;
  }, [contestants]);

  const scored = useMemo(
    () => entries.filter((e) => e.pointsAwarded > 0),
    [entries],
  );
  const top = useMemo(
    () => scored.find((e) => e.pointsAwarded === 12) ?? null,
    [scored],
  );
  const lower = useMemo(
    () =>
      scored
        .filter((e) => e.pointsAwarded !== 12)
        .sort((a, b) => b.pointsAwarded - a.pointsAwarded),
    [scored],
  );

  // Degenerate cases (no entries scored, or no 12-pt pick): no ceremony
  // gate — the parent's Ready CTA is enabled immediately.
  const hasCeremony = top !== null;
  const [topRevealed, setTopRevealed] = useState(!hasCeremony);

  // Fire onAllRevealed exactly once: either on mount when there's no
  // ceremony, or after the user reveals/skips the 12.
  // (Parent gates Ready on this signal.)
  useEffect(() => {
    if (topRevealed) onAllRevealed();
    // onAllRevealed deliberately omitted: parent passes a fresh callback
    // each render; we only want to fire once on the topRevealed flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topRevealed]);

  const handleReveal = () => setTopRevealed(true);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          {t("instantAnnounce.ownResults.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("instantAnnounce.ownResults.subtitle")}
        </p>
      </div>

      {scored.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instantAnnounce.ownResults.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {topRevealed && top ? (
            <PickRow
              key={top.contestantId}
              entry={top}
              contestant={byId.get(top.contestantId) ?? null}
              isTop
              twelveLabel={t("instantAnnounce.ownResults.twelveLabel")}
            />
          ) : null}
          {lower.map((entry) => (
            <PickRow
              key={entry.contestantId}
              entry={entry}
              contestant={byId.get(entry.contestantId) ?? null}
            />
          ))}
        </ul>
      )}

      {!topRevealed ? (
        <div className="space-y-2 pt-2">
          <Button
            variant="primary"
            onClick={handleReveal}
            className="w-full"
          >
            {t("instantAnnounce.ownResults.revealTwelveButton")}
          </Button>
          <button
            type="button"
            onClick={handleReveal}
            className="block mx-auto text-xs text-muted-foreground underline hover:text-foreground"
          >
            {t("instantAnnounce.ownResults.revealTwelveSkip")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface PickRowProps {
  entry: OwnBreakdownEntry;
  contestant: Contestant | null;
  isTop?: boolean;
  twelveLabel?: string;
}

function PickRow({ entry, contestant, isTop, twelveLabel }: PickRowProps) {
  return (
    <li
      className={
        "flex items-start gap-3 rounded-lg border px-3 py-2 " +
        (isTop
          ? "border-primary motion-safe:animate-fade-in motion-safe:emx-glow-gold"
          : "border-border")
      }
    >
      <span
        className={
          "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums " +
          (isTop
            ? "bg-primary text-primary-foreground"
            : "bg-primary/10 text-primary")
        }
      >
        {entry.pointsAwarded}
      </span>
      <div className="flex-1 min-w-0">
        {isTop && twelveLabel ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
            {twelveLabel}
          </p>
        ) : null}
        <p className="text-sm font-medium text-foreground truncate">
          {contestant?.flagEmoji ?? "🏳️"} {contestant?.country ?? entry.contestantId}
          {contestant ? ` — ${contestant.song}` : ""}
        </p>
        {entry.hotTake ? (
          <p className="text-xs text-muted-foreground italic mt-1">
            &ldquo;{entry.hotTake}&rdquo;
          </p>
        ) : null}
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run type-check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/components/instant/OwnPointsCeremony.tsx
git commit -m "$(cat <<'EOF'
feat(instant): OwnPointsCeremony — Piece A 12-point reveal

Replaces InstantOwnBreakdown's always-visible-list pattern with a
compressed Eurovision-broadcast-faithful reveal: lower-nine picks
(1, 2, 3, 4, 5, 6, 7, 8, 10) shown immediately; the 12-point pick
is hidden behind a single tap-to-reveal button + skip-the-build-up
escape hatch.

On reveal, the 12-point row fades in at the top of the list with
animate-fade-in + emx-glow-gold halo (motion-safe gated). Fires
onAllRevealed → parent enables the Ready CTA.

Degenerate cases (no entries, or no 12-pt pick — possible when a
user voted on ≤9 contestants): everything renders immediately and
onAllRevealed fires on mount, so Ready is never gated artificially.

InstantOwnBreakdown.tsx still imports/exports OwnBreakdownEntry —
the type stays put for now; the component swap happens in the
next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire-in — `InstantAnnouncingView`

**Files:**
- Modify: `src/components/room/InstantAnnouncingView.tsx`

Swap `<InstantOwnBreakdown>` → `<OwnPointsCeremony>`. Track local `allRevealed` state and gate the Ready button on it.

- [ ] **Step 1: Read the current file**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
cat src/components/room/InstantAnnouncingView.tsx
```

The current Ready section is the inline ternary: `{ownIsReady ? <p>...</p> : <Button>...}`.

- [ ] **Step 2: Apply the edit**

Edit `src/components/room/InstantAnnouncingView.tsx`:

Replace the import:

```ts
import InstantOwnBreakdown, {
  type OwnBreakdownEntry,
} from "@/components/room/InstantOwnBreakdown";
```

with:

```ts
import { type OwnBreakdownEntry } from "@/components/room/InstantOwnBreakdown";
import OwnPointsCeremony from "@/components/instant/OwnPointsCeremony";
```

(Keep `OwnBreakdownEntry` import — `InstantOwnBreakdown.tsx` still exports the type until it's deleted in Task 11. Do not delete the source file yet.)

Inside the component body, after the existing `firstReadyAt` `useMemo`, add:

```ts
const [allRevealed, setAllRevealed] = useState(false);
```

Add `useState` to the existing React imports if it isn't already there. (The current file imports `useMemo, useState`.)

Replace the existing breakdown render:

```tsx
<InstantOwnBreakdown
  entries={ownBreakdown}
  contestants={contestants}
/>
```

with:

```tsx
<OwnPointsCeremony
  entries={ownBreakdown}
  contestants={contestants}
  onAllRevealed={() => setAllRevealed(true)}
/>
```

Replace the Ready CTA block:

```tsx
{ownIsReady ? (
  <p className="text-sm text-muted-foreground text-center">
    {t("instantAnnounce.ready.waiting", {
      count: Math.max(0, totalCount - readyCount),
    })}
  </p>
) : (
  <Button
    variant="primary"
    disabled={busy}
    onClick={handleReady}
    className="w-full"
  >
    {busy
      ? t("instantAnnounce.ready.busy")
      : t("instantAnnounce.ready.button")}
  </Button>
)}
```

with:

```tsx
{ownIsReady ? (
  <p className="text-sm text-muted-foreground text-center">
    {t("instantAnnounce.ready.waiting", {
      count: Math.max(0, totalCount - readyCount),
    })}
  </p>
) : (
  <Button
    variant="primary"
    disabled={busy || !allRevealed}
    onClick={handleReady}
    className="w-full"
  >
    {busy
      ? t("instantAnnounce.ready.busy")
      : t("instantAnnounce.ready.button")}
  </Button>
)}
```

(Only `disabled` changes — the rest stays intact. Admin-side `RevealCtaPanel` is unaffected; admin can tap Reveal-now without revealing their own 12.)

- [ ] **Step 3: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run type-check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/components/room/InstantAnnouncingView.tsx
git commit -m "$(cat <<'EOF'
feat(instant): swap InstantOwnBreakdown → OwnPointsCeremony

Wires Piece A into InstantAnnouncingView. Ready CTA is now disabled
until the user reveals (or skips) their 12-point pick. Admin's
RevealCtaPanel is unaffected — admins can still Skip-the-wait or
Reveal-early without first revealing their own 12.

OwnBreakdownEntry type re-exported from InstantOwnBreakdown for now;
that file is deleted in Task 11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Component — `LeaderboardCeremony` (Piece B)

**Files:**
- Create: `src/components/instant/LeaderboardCeremony.tsx`

The biggest component. Self-fetches `/api/results/{id}`, drives `useStaggeredReveal` over `leaderboardSequence`, applies FLIP via `useLayoutEffect`, hosts the auto-redirect + Stay-here, gates on `sessionRevealedFlag`, and respects reduced motion.

- [ ] **Step 1: Implement**

Create `src/components/instant/LeaderboardCeremony.tsx`:

```tsx
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { leaderboardSequence } from "@/lib/instant/leaderboardSequence";
import {
  hasRevealed,
  markRevealed,
} from "@/lib/instant/sessionRevealedFlag";
import { useStaggeredReveal } from "@/components/instant/useStaggeredReveal";
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

const STAGGER_MS = 250;
const POST_SETTLE_PAUSE_MS = 3000;
const POST_SETTLE_PAUSE_MS_REDUCED = 1000;

interface LeaderboardCeremonyProps {
  roomId: string;
}

interface FetchedData {
  leaderboard: LeaderboardEntry[];
  contestants: Contestant[];
}

export default function LeaderboardCeremony({ roomId }: LeaderboardCeremonyProps) {
  const router = useRouter();
  const t = useTranslations();

  const [data, setData] = useState<FetchedData | null>(null);
  const [skipReplay] = useState(() => hasRevealed(roomId));
  const [stayedHere, setStayedHere] = useState(false);

  // Detect reduced motion once on mount.
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Fetch /api/results/{id}.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/results/${encodeURIComponent(roomId)}`);
        if (!res.ok) return;
        const body = await res.json();
        // Body is the discriminated ResultsData — only `done` shape has leaderboard.
        if (cancelled) return;
        if (body.status === "done") {
          setData({ leaderboard: body.leaderboard, contestants: body.contestants });
        }
      } catch {
        /* ignore — render fallback in body */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const sequence = useMemo(() => {
    if (!data) return null;
    return leaderboardSequence(data.leaderboard, data.contestants);
  }, [data]);

  // When ceremony is suppressed (replay-skip OR reduced-motion OR no data yet),
  // we still want to drive the hook to immediately fire onComplete so the
  // post-settle pause + redirect happen.
  const animationEnabled =
    sequence !== null && !skipReplay && !prefersReducedMotion;
  const totalSteps = sequence ? sequence.length - 1 : 0;

  const { currentStep, isComplete } = useStaggeredReveal({
    totalSteps,
    staggerMs: STAGGER_MS,
    enabled: animationEnabled,
  });

  // Once the ceremony is "complete" (settled or skipped), set the flag and
  // start the post-settle redirect timer.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!data) return;
    if (!isComplete) return;
    markRevealed(roomId);

    if (skipReplay || stayedHere) return;

    const pause = prefersReducedMotion
      ? POST_SETTLE_PAUSE_MS_REDUCED
      : POST_SETTLE_PAUSE_MS;
    redirectTimerRef.current = setTimeout(() => {
      router.push(`/results/${encodeURIComponent(roomId)}`);
    }, pause);
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, [data, isComplete, skipReplay, stayedHere, prefersReducedMotion, roomId, router]);

  const handleStayHere = useCallback(() => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    markRevealed(roomId);
    setStayedHere(true);
  }, [roomId]);

  // Pick the snapshot to render based on currentStep.
  const snapshot = useMemo(() => {
    if (!sequence) return [];
    if (skipReplay) return sequence[sequence.length - 1];
    return sequence[Math.min(currentStep, sequence.length - 1)];
  }, [sequence, skipReplay, currentStep]);

  // FLIP: capture previous DOM positions per contestantId, apply
  // animate-rank-shift transforms after layout.
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    if (!animationEnabled) {
      prevRectsRef.current = new Map();
      return;
    }
    const newRects = new Map<string, DOMRect>();
    for (const [id, el] of rowRefs.current) {
      newRects.set(id, el.getBoundingClientRect());
    }
    for (const [id, oldRect] of prevRectsRef.current) {
      const newRect = newRects.get(id);
      const el = rowRefs.current.get(id);
      if (!newRect || !el) continue;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dy) < 0.5) continue;
      el.style.setProperty("--shift-from", `${dy}px`);
      el.classList.remove("motion-safe:animate-rank-shift");
      // Force reflow so re-adding the class restarts the animation.
      void el.offsetHeight;
      el.classList.add("motion-safe:animate-rank-shift");
    }
    prevRectsRef.current = newRects;
  }, [snapshot, animationEnabled]);

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p className="text-muted-foreground motion-safe:animate-shimmer">…</p>
      </main>
    );
  }

  const lookup = new Map<string, Contestant>(
    data.contestants.map((c) => [c.id, c]),
  );

  // Rank rendering rule per spec: only when settled (isComplete).
  const showRanks = isComplete || skipReplay;

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-1 text-center">
          <h2 className="text-xl font-semibold">
            {t("instantAnnounce.ceremony.subtitle")}
          </h2>
        </header>

        <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
          {snapshot.map((row) => {
            const c = lookup.get(row.contestantId);
            return (
              <li
                key={row.contestantId}
                ref={(el) => {
                  if (el) rowRefs.current.set(row.contestantId, el);
                  else rowRefs.current.delete(row.contestantId);
                }}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex items-center gap-3">
                  {showRanks && row.rank !== null ? (
                    <span className="tabular-nums text-sm text-muted-foreground w-6 text-right">
                      {row.rank}
                    </span>
                  ) : (
                    <span className="w-6" aria-hidden />
                  )}
                  <span className="text-2xl" aria-hidden>
                    {c?.flagEmoji ?? "🏳️"}
                  </span>
                  <span className="font-medium">
                    {c?.country ?? row.contestantId}
                  </span>
                </span>
                <span className="tabular-nums font-semibold">
                  {row.pointsAwarded > 0 ? row.pointsAwarded : ""}
                </span>
              </li>
            );
          })}
        </ol>

        {(isComplete || skipReplay) && !stayedHere ? (
          <RedirectFooter
            roomId={roomId}
            pauseMs={
              skipReplay
                ? 0
                : prefersReducedMotion
                ? POST_SETTLE_PAUSE_MS_REDUCED
                : POST_SETTLE_PAUSE_MS
            }
            onStayHere={handleStayHere}
            staySkipped={skipReplay}
            labels={{
              redirectingIn: (seconds) =>
                t("instantAnnounce.ceremony.redirectingIn", { seconds }),
              stayHere: t("instantAnnounce.ceremony.stayHere"),
              seeFullResults: t("instantAnnounce.ceremony.seeFullResults"),
            }}
          />
        ) : null}

        {stayedHere ? (
          <a
            href={`/results/${encodeURIComponent(roomId)}`}
            className="block w-full text-center rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {t("instantAnnounce.ceremony.seeFullResults")}
          </a>
        ) : null}
      </div>
    </main>
  );
}

interface RedirectFooterProps {
  roomId: string;
  pauseMs: number;
  staySkipped: boolean;
  onStayHere: () => void;
  labels: {
    redirectingIn: (seconds: number) => string;
    stayHere: string;
    seeFullResults: string;
  };
}

function RedirectFooter({
  roomId,
  pauseMs,
  staySkipped,
  onStayHere,
  labels,
}: RedirectFooterProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    Math.ceil(pauseMs / 1000),
  );

  useEffect(() => {
    if (staySkipped) return;
    if (secondsRemaining <= 0) return;
    const id = setTimeout(() => setSecondsRemaining((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsRemaining, staySkipped]);

  if (staySkipped) {
    return (
      <a
        href={`/results/${encodeURIComponent(roomId)}`}
        className="block w-full text-center rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        {labels.seeFullResults}
      </a>
    );
  }

  return (
    <div className="space-y-2 text-center">
      <p className="text-sm text-muted-foreground tabular-nums">
        {labels.redirectingIn(secondsRemaining)}
      </p>
      <button
        type="button"
        onClick={onStayHere}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        {labels.stayHere}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run type-check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/components/instant/LeaderboardCeremony.tsx
git commit -m "$(cat <<'EOF'
feat(instant): LeaderboardCeremony — Piece B worst-to-best reveal

Self-contained full-screen ceremony triggered when room.status flips to
done in instant-mode rooms. Self-fetches /api/results/{id} (no caller
plumbing changes), seeds an all-zero leaderboard, then ticks reveals
worst→best at 250ms stagger via useStaggeredReveal × leaderboardSequence.

Visual choreography:
- Each snapshot re-sorts by points desc, contestantId asc (matches
  loadResults.buildLeaderboard).
- FLIP animation via useLayoutEffect: captures pre-render rects per
  contestantId, applies translateY via --shift-from + animate-rank-shift
  on rows that moved.
- Rank numbers suppressed during the climb (would be all-tied-1 at the
  start); they fade in once isComplete is true.
- 3s post-settle pause then auto-redirect to /results/{roomId} via the
  next router. Stay-here cancels and shows a static "See full results →"
  button.

Replay guards:
- sessionStorage["emx_revealed_${roomId}"] set on every completion path
  (auto-redirect fired, Stay-here tapped). Subsequent mounts short-circuit
  to the static settled leaderboard.
- prefers-reduced-motion: snap to settled state, compress the post-settle
  pause from 3s to 1s, no FLIP transforms applied.

Wire-in into room/[id]/page.tsx lands in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wire-in — `room/[id]/page.tsx` done branch

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

When `status === "done"` AND `announcementMode === "instant"`, render `<LeaderboardCeremony>` instead of `<DoneCard>`. Live-mode `done` continues to render `<DoneCard>`.

- [ ] **Step 1: Apply the edit**

Add the import alongside the existing `DoneCard` import:

```ts
import LeaderboardCeremony from "@/components/instant/LeaderboardCeremony";
```

Replace the existing `done` branch:

```tsx
if (phase.room.status === "done") {
  return <DoneCard roomId={phase.room.id} />;
}
```

with:

```tsx
if (phase.room.status === "done") {
  if (phase.room.announcementMode === "instant") {
    return <LeaderboardCeremony roomId={phase.room.id} />;
  }
  return <DoneCard roomId={phase.room.id} />;
}
```

(`LeaderboardCeremony` handles its own sessionStorage replay-guard, so no flag check at the page level.)

- [ ] **Step 2: Type-check + run unit tests**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run pre-push
```

Expected: type-check passes; all existing tests + the three new pure-helper test files green.

- [ ] **Step 3: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/app/room/[id]/page.tsx
git commit -m "$(cat <<'EOF'
feat(instant): wire LeaderboardCeremony into room page

Branches the done render: instant-mode rooms get the worst-to-best
ceremony (which self-fetches, plays once per session, then redirects
to /results/{roomId}). Live-mode rooms keep the existing DoneCard +
10s progress-button countdown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Delete `InstantOwnBreakdown`

**Files:**
- Delete: `src/components/room/InstantOwnBreakdown.tsx`

Now that `OwnPointsCeremony` is wired in, the only remaining reference is the type re-import. Move the `OwnBreakdownEntry` type to `OwnPointsCeremony` and update the re-import path.

- [ ] **Step 1: Audit references**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
grep -rn "InstantOwnBreakdown\|OwnBreakdownEntry" src/
```

Expected references:
- `src/components/room/InstantOwnBreakdown.tsx` (the file we're deleting)
- `src/components/room/InstantAnnouncingView.tsx` (imports `OwnBreakdownEntry`)
- `src/components/instant/OwnPointsCeremony.tsx` (imports `OwnBreakdownEntry` from InstantOwnBreakdown)
- `src/app/room/[id]/page.tsx` (imports `OwnBreakdownEntry` from InstantOwnBreakdown)

- [ ] **Step 2: Move the type to `OwnPointsCeremony.tsx`**

Edit `src/components/instant/OwnPointsCeremony.tsx`:

Replace the import block:

```ts
import type { OwnBreakdownEntry } from "@/components/room/InstantOwnBreakdown";
```

with an inline export:

```ts
export interface OwnBreakdownEntry {
  contestantId: string;
  pointsAwarded: number;
  hotTake: string | null;
}
```

(Remove the original import; add the interface near the top of the file before `OwnPointsCeremonyProps`.)

- [ ] **Step 3: Repoint the consumers**

Edit `src/components/room/InstantAnnouncingView.tsx`:

Replace:

```ts
import { type OwnBreakdownEntry } from "@/components/room/InstantOwnBreakdown";
import OwnPointsCeremony from "@/components/instant/OwnPointsCeremony";
```

with:

```ts
import OwnPointsCeremony, {
  type OwnBreakdownEntry,
} from "@/components/instant/OwnPointsCeremony";
```

Edit `src/app/room/[id]/page.tsx`:

Replace:

```ts
import type { OwnBreakdownEntry } from "@/components/room/InstantOwnBreakdown";
```

with:

```ts
import type { OwnBreakdownEntry } from "@/components/instant/OwnPointsCeremony";
```

- [ ] **Step 4: Delete the file**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git rm src/components/room/InstantOwnBreakdown.tsx
```

- [ ] **Step 5: Verify nothing references it**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
grep -rn "InstantOwnBreakdown" src/
```

Expected: no results.

- [ ] **Step 6: Type-check + tests**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run pre-push
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add src/components/room/InstantAnnouncingView.tsx \
  src/components/instant/OwnPointsCeremony.tsx \
  src/app/room/[id]/page.tsx
git commit -m "$(cat <<'EOF'
chore(instant): delete InstantOwnBreakdown — superseded by OwnPointsCeremony

OwnBreakdownEntry interface moves to OwnPointsCeremony (its sole
consumer of substance). InstantAnnouncingView and room/[id]/page.tsx
re-export from the new home.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Manual smoke + tick todo.md

**Files:**
- Modify: `todo.md`

Real-browser verification of every behaviour the pure-helper tests can't reach: the FLIP animation, the redirect timer, the sessionStorage replay-guard, reduced-motion fast-path.

- [ ] **Step 1: Run dev server in the worktree**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
npm run dev
```

Open `http://localhost:3000` in two browser windows (or a regular window + an incognito window so they have separate sessions).

- [ ] **Step 2: Drive a room through to instant-mode `done`**

1. Window A: onboard a user → Create room → pick **Instant** mode → start voting.
2. Window B: onboard a different user → Join via PIN → vote on every contestant.
3. Window A: vote on every contestant (or fewer, to test "no 12-pt pick" degenerate path on B).
4. Window A: tap **End voting** → confirm → wait for the 5-s ending → room flips to `announcing`.
5. **Piece A — Window B:** the lower nine picks render immediately; the 12-point row is hidden behind a `Reveal your 12 points` button. Tap the button → 12 row fades in at top with gold border + halo. Confirm `Ready` button is **disabled** before the tap and **enabled** after.
6. **Piece A — Window B:** reload mid-state (without tapping reveal). Confirm the `Reveal your 12 points` button is back (state isn't persisted — it's per-mount).
7. **Piece A — skip path:** tap `Skip the build-up` instead of the button → same result, 12 row fades in.
8. **Piece A — degenerate:** if Window A only voted on ≤9 contestants and never gave anyone a 12, the ceremony is suppressed and Ready is enabled immediately. Confirm.
9. **Piece B — admin reveal:** Window B taps `I'm ready`. Window A taps `Skip the wait — reveal now` → confirms.

- [ ] **Step 3: Smoke Piece B — happy path**

10. **Both windows:** the leaderboard ceremony renders. Initial state: all rows alphabetical with no points column, no rank numbers.
11. **Climbing animation:** rows physically slide as reveals tick in worst-to-best at ~250ms cadence. Watch a couple of countries swap positions visibly via `animate-rank-shift`.
12. **Settle:** after ~6.5s (for a full final, fewer for short fields), all reveals complete. Rank numbers appear next to the flags. Points column populated.
13. **Redirect copy:** `Opening full results in 3s…` → `2s…` → `1s…` then both windows redirect to `/results/{roomId}`.

- [ ] **Step 4: Smoke — `Stay here`**

14. Repeat the flow with a fresh room (or wipe sessionStorage in DevTools): when the redirect counter shows `2s…`, tap `Stay here`. Confirm the timer stops; the static `See full results →` button appears; tapping it routes to `/results/{roomId}`.

- [ ] **Step 5: Smoke — replay guard**

15. After redirect, navigate back to `/room/{roomId}` (browser back, or paste the URL). Confirm: no animation; settled leaderboard renders immediately with rank numbers; `See full results →` button is present; no auto-redirect.

- [ ] **Step 6: Smoke — reduced motion**

16. Wipe sessionStorage. In DevTools → Rendering → CSS media features → `prefers-reduced-motion: reduce`.
17. Run the flow again to the admin-reveal moment. Confirm: leaderboard appears in its final state instantly (no stagger, no FLIP transforms). Redirect happens after ~1s, not 3s.

- [ ] **Step 7: Smoke — live-mode unaffected**

18. Create a new room with `Live` announcement mode. Drive it to `done` (vote, end voting, run the live announce flow). Confirm: when status flips to `done`, **DoneCard renders as before** — no leaderboard ceremony.

- [ ] **Step 8: Tick todo.md**

After every smoke check passes, update `todo.md` to flip the 5c.2 line. The current line is around line 85:

```
- [~] For `announcement_mode = 'instant'`: ... ceremony + animated worst-to-best leaderboard reveal between admin-tap and `done`.)_
```

Change `[~]` to `[x]` and append to the parenthetical: ` Phase 5c.2 shipped via PR #__ — OwnPointsCeremony + LeaderboardCeremony + leaderboardSequence/staggerTick/sessionRevealedFlag pure helpers. SessionStorage replay-guard, FLIP rank-shift, reduced-motion fast-path. Spec: docs/superpowers/specs/2026-04-27-phase-5c2-instant-mode-ceremony-design.md.`

(Replace `#__` with the actual PR number once opened.)

- [ ] **Step 9: Commit todo update**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git add todo.md
git commit -m "$(cat <<'EOF'
chore(todo): flip 5c.2 to done — instant-mode reveal ceremonies shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Final pre-push check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony && npm run pre-push
```

Expected: green type-check + green tests.

- [ ] **Step 11: Push the branch**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c2-instant-mode-ceremony
git push -u origin feat/phase-5c2-instant-mode-ceremony
```

Then open a PR via `gh pr create` with title `feat(instant): phase 5c.2 reveal ceremonies` and a body summarising the two pieces, the spec/plan links, and the smoke checklist that was exercised.

---

## Self-review checklist

When the implementer finishes Task 12, they should verify against the spec:

- [ ] Piece A — lower nine render immediately, 12 hidden, tap reveals (✅ Task 7).
- [ ] Piece A — skip link works (✅ Task 7 + smoke step 7).
- [ ] Piece A — Ready CTA gated on allRevealed (✅ Task 8).
- [ ] Piece A — degenerate (no 12-pt pick) bypasses ceremony (✅ Task 7 + smoke step 8).
- [ ] Piece B — pre-seeded leaderboard at 0 pts → climbs worst→best via FLIP (✅ Task 9).
- [ ] Piece B — rank numbers appear only at settle (✅ Task 9 — `showRanks = isComplete || skipReplay`).
- [ ] Piece B — 3s post-settle pause then auto-redirect (✅ Task 9).
- [ ] Piece B — Stay-here cancels redirect, shows See-full-results button (✅ Task 9).
- [ ] Piece B — sessionStorage replay-guard short-circuits to settled state (✅ Task 9).
- [ ] Piece B — prefers-reduced-motion fast-path: settled in one frame, 1s pause (✅ Task 9).
- [ ] Live-mode `done` unaffected (✅ Task 10 — the `if (announcementMode === "instant")` branch).
- [ ] No DB migration, no new endpoint, no new RoomEvent (✅ — confirmed by file diff).
- [ ] Locale keys complete, en.json valid (✅ Task 6).
- [ ] todo.md ticked (✅ Task 12 step 8).
