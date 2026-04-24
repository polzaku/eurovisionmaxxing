# VotingView — Voting-Screen Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the voting UI at `/room/[id]` when `room.status === 'voting'` — contestant card + global scale strip + `ScoreRow` per category + Prev/Next nav — with scores held in local component state only.

**Architecture:** New presentation-only `VotingView` component receives `contestants` + `categories` as props. Pure helper `scoredCount(scores, categoryNames) → number` drives the header progress bar. `src/app/room/[id]/page.tsx` gains a new `if (status === "voting")` branch parallel to the existing lobby branch. No fetch added; the page's existing `fetchRoomData` call already returns contestants.

**Tech Stack:** Next.js 14 App Router, React 18 (client components), TypeScript strict, Tailwind tokens, Vitest (node env — no DOM tests this slice). Consumes `ScoreRow` from PR #17.

Design: [docs/superpowers/specs/2026-04-21-voting-screen-skeleton-design.md](../specs/2026-04-21-voting-screen-skeleton-design.md) — read it first.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/components/voting/scoredCount.ts` | **new** | Pure helper `(scores, categoryNames) → number` counting filled categories |
| `src/components/voting/scoredCount.test.ts` | **new** | Vitest unit tests for the helper (no DOM) |
| `src/components/voting/VotingView.tsx` | **new** | The client component — header + scale strip + ScoreRows + Prev/Next; owns local score + index state |
| `src/app/room/[id]/page.tsx` | modify | Add `contestants` to the `ready` phase; add a `status === "voting"` render branch |

**Not touched:**
- `src/components/voting/ScoreRow.tsx` — consumed as-is from PR #17.
- `src/lib/**` — no new library code. No fetch wiring this slice.
- `src/types/index.ts` — `Contestant` and `VotingCategory` already exported.
- `src/components/room/LobbyView.tsx` — lobby path unchanged.

---

## Task 1: `scoredCount` helper + tests

**Files:**
- Create: `src/components/voting/scoredCount.ts`
- Create: `src/components/voting/scoredCount.test.ts`

The helper is the only branching logic in the whole slice. TDD it first.

- [ ] **Step 1.1: Create the stub**

Create `src/components/voting/scoredCount.ts`:

```ts
/**
 * Count how many of `categoryNames` have a numeric score in `scores`.
 * - `undefined` scores → 0 (never-touched)
 * - `null` values → not counted (explicitly cleared)
 * - Keys outside `categoryNames` are ignored.
 *
 * See docs/superpowers/specs/2026-04-21-voting-screen-skeleton-design.md §7.
 */
export function scoredCount(
  _scores: Record<string, number | null> | undefined,
  _categoryNames: readonly string[]
): number {
  throw new Error("not implemented");
}
```

- [ ] **Step 1.2: Write failing tests**

Create `src/components/voting/scoredCount.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoredCount } from "@/components/voting/scoredCount";

const CATS = ["Vocals", "Staging", "Outfit"] as const;

describe("scoredCount", () => {
  it("returns 0 for undefined scores", () => {
    expect(scoredCount(undefined, CATS)).toBe(0);
  });

  it("returns 0 for an empty scores object", () => {
    expect(scoredCount({}, CATS)).toBe(0);
  });

  it("counts each category with a numeric value", () => {
    expect(scoredCount({ Vocals: 7, Staging: 4 }, CATS)).toBe(2);
  });

  it("returns the total when every category is filled", () => {
    expect(
      scoredCount({ Vocals: 7, Staging: 4, Outfit: 9 }, CATS)
    ).toBe(CATS.length);
  });

  it("does not count null values (explicit clear)", () => {
    expect(scoredCount({ Vocals: null, Staging: 4 }, CATS)).toBe(1);
  });

  it("ignores keys that are not in the category list", () => {
    expect(
      scoredCount({ Vocals: 7, BogusExtra: 3 }, CATS)
    ).toBe(1);
  });

  it("handles 0-length category list without error", () => {
    expect(scoredCount({ Vocals: 5 }, [])).toBe(0);
  });
});
```

- [ ] **Step 1.3: Run tests — confirm RED**

Run: `npx vitest run src/components/voting/scoredCount.test.ts`
Expected: FAIL — all 7 throw `"not implemented"`.

- [ ] **Step 1.4: Implement**

Replace the body of `src/components/voting/scoredCount.ts`:

```ts
/**
 * Count how many of `categoryNames` have a numeric score in `scores`.
 * - `undefined` scores → 0 (never-touched)
 * - `null` values → not counted (explicitly cleared)
 * - Keys outside `categoryNames` are ignored.
 *
 * See docs/superpowers/specs/2026-04-21-voting-screen-skeleton-design.md §7.
 */
export function scoredCount(
  scores: Record<string, number | null> | undefined,
  categoryNames: readonly string[]
): number {
  if (!scores) return 0;
  let count = 0;
  for (const name of categoryNames) {
    if (typeof scores[name] === "number") count += 1;
  }
  return count;
}
```

- [ ] **Step 1.5: Run tests — confirm GREEN**

Run: `npx vitest run src/components/voting/scoredCount.test.ts`
Expected: PASS — 7/7.

- [ ] **Step 1.6: Commit**

```bash
git add src/components/voting/scoredCount.ts src/components/voting/scoredCount.test.ts
git commit -m "$(cat <<'EOF'
VotingView: scoredCount helper + tests

Pure helper that returns how many of the required categories have a
numeric score. Ignores undefined scores, null values (explicit clear),
and keys outside the category list. Drives the §8.1 header progress bar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `VotingView` component

**Files:**
- Create: `src/components/voting/VotingView.tsx`

Presentation + local state. All rendering decisions are in the design doc §6; this task implements them verbatim.

- [ ] **Step 2.1: Create the component**

Create `src/components/voting/VotingView.tsx`:

```tsx
"use client";

import { useMemo, useState, useCallback } from "react";
import type { Contestant, VotingCategory } from "@/types";
import { SCORE_ANCHORS } from "@/types";
import Button from "@/components/ui/Button";
import ScoreRow from "@/components/voting/ScoreRow";
import { scoredCount } from "@/components/voting/scoredCount";

export interface VotingViewProps {
  /** Expected pre-sorted by runningOrder; component sorts defensively. */
  contestants: Contestant[];
  /** Voting categories for this room. */
  categories: VotingCategory[];
  /** Reserved for a future autosave slice — unused this PR. */
  isAdmin?: boolean;
}

/**
 * Voting screen skeleton. Scores live in local state only — autosave lands
 * in a follow-up PR. See
 * docs/superpowers/specs/2026-04-21-voting-screen-skeleton-design.md
 */
export default function VotingView({
  contestants,
  categories,
}: VotingViewProps) {
  const sortedContestants = useMemo(
    () => [...contestants].sort((a, b) => a.runningOrder - b.runningOrder),
    [contestants]
  );

  const [idx, setIdx] = useState(0);
  const [scoresByContestant, setScoresByContestant] = useState<
    Record<string, Record<string, number | null>>
  >({});

  // Defensive early-outs — room creation should prevent these but the
  // component handles them rather than crashing the page.
  if (categories.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p role="alert" className="text-sm text-destructive text-center max-w-md">
          No voting categories configured — ask the host to check the room setup.
        </p>
      </main>
    );
  }
  if (sortedContestants.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p role="alert" className="text-sm text-destructive text-center max-w-md">
          No contestants for this event.
        </p>
      </main>
    );
  }

  const contestant = sortedContestants[Math.min(idx, sortedContestants.length - 1)];
  const totalContestants = sortedContestants.length;
  const categoryNames = categories.map((c) => c.name);
  const fullyScoredCount = sortedContestants.reduce(
    (acc, c) =>
      acc +
      (scoredCount(scoresByContestant[c.id], categoryNames) ===
      categoryNames.length
        ? 1
        : 0),
    0
  );
  const firstWeight = categories[0].weight;
  const nonUniformWeights = categories.some((c) => c.weight !== firstWeight);

  const updateScore = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      setScoresByContestant((prev) => ({
        ...prev,
        [contestantId]: {
          ...(prev[contestantId] ?? {}),
          [categoryName]: next,
        },
      }));
    },
    []
  );

  const canPrev = idx > 0;
  const canNext = idx < totalContestants - 1;

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-xl space-y-6 animate-fade-in">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-3xl leading-none" aria-hidden="true">
              {contestant.flagEmoji}
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight truncate">
              {contestant.country}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground truncate">
              &ldquo;{contestant.song}&rdquo; — {contestant.artist}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-sm font-mono text-muted-foreground tabular-nums">
              {contestant.runningOrder}/{totalContestants}
            </span>
            <progress
              className="w-24 h-1.5 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
              max={totalContestants}
              value={fullyScoredCount}
              aria-label={`${fullyScoredCount} of ${totalContestants} contestants fully scored`}
            />
            <span className="text-xs text-muted-foreground">
              {fullyScoredCount} scored
            </span>
          </div>
        </header>

        <p className="text-xs text-muted-foreground text-center">
          Scale: <span className="font-medium">1</span> {SCORE_ANCHORS[1].split(".")[0]} ·{" "}
          <span className="font-medium">5</span> {SCORE_ANCHORS[5].split(".")[0]} ·{" "}
          <span className="font-medium">10</span> {SCORE_ANCHORS[10].split(".")[0]}
        </p>

        <div className="space-y-6">
          {categories.map((cat) => (
            <ScoreRow
              key={cat.name}
              categoryName={cat.name}
              hint={cat.hint}
              value={scoresByContestant[contestant.id]?.[cat.name] ?? null}
              weightMultiplier={nonUniformWeights ? cat.weight : undefined}
              onChange={(next) => updateScore(contestant.id, cat.name, next)}
            />
          ))}
        </div>

        <nav className="grid grid-cols-2 gap-4 pt-4">
          <Button
            variant="secondary"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={!canPrev}
            aria-label="Previous contestant"
          >
            ← Prev
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIdx((i) => Math.min(totalContestants - 1, i + 1))}
            disabled={!canNext}
            aria-label="Next contestant"
          >
            Next →
          </Button>
        </nav>
      </div>
    </main>
  );
}
```

**Note on the scale strip.** `SCORE_ANCHORS[1]` is `"Devastating. A moment I will try to forget."` — the design shows just the short anchor ("Devastating", "Fine", "Iconic"), which is the first word before the period. The `.split(".")[0]` pulls it out. If the anchors copy changes, this still works; when i18n lands the whole line gets extracted via `t()` anyway.

- [ ] **Step 2.2: Verify type-check**

Run: `npm run type-check`
Expected: zero errors. `VotingView` is exported, `ScoreRow` + `scoredCount` imports resolve, `SCORE_ANCHORS` exists in `@/types`.

- [ ] **Step 2.3: Verify tests still green**

Run: `npm test -- --run`
Expected: all tests pass, including Task 1's 7 new cases.

- [ ] **Step 2.4: Commit**

```bash
git add src/components/voting/VotingView.tsx
git commit -m "$(cat <<'EOF'
VotingView: voting screen skeleton

Composes ScoreRow, contestant card (flag + country + song + artist +
running-order + progress bar), global 1/5/10 scale strip, and Prev/Next
navigation. Scores held in sparse local state keyed by contestant id
then category name. No persistence this slice — autosave follows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `VotingView` into `/room/[id]` page

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

Two edits:
1. Add `contestants` to the `Phase.ready` shape and thread it into both `setPhase` call sites in `loadRoom`.
2. Add a `status === "voting"` render branch after the existing lobby branch.

- [ ] **Step 3.1: Add the `contestants` field + thread it through load**

Edit `src/app/room/[id]/page.tsx`.

**Edit A — add Contestant import (near the top, with the other imports):**

Find:
```ts
import StatusStub from "@/components/room/StatusStub";
```

Replace with:
```ts
import StatusStub from "@/components/room/StatusStub";
import VotingView from "@/components/voting/VotingView";
import type { Contestant } from "@/types";
```

**Edit B — add `contestants` to the `Phase.ready` shape:**

Find:
```ts
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      room: RoomShape;
      memberships: MembershipShape[];
    };
```

Replace with:
```ts
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      room: RoomShape;
      memberships: MembershipShape[];
      contestants: Contestant[];
    };
```

**Edit C — thread contestants into the initial `setPhase` call:**

Find:
```ts
    setPhase({
      kind: "ready",
      room,
      memberships: ensureSelfInMemberships(memberships, session),
    });
  }, [roomId]);
```

Replace with:
```ts
    setPhase({
      kind: "ready",
      room,
      memberships: ensureSelfInMemberships(memberships, session),
      contestants: (data.contestants ?? []) as Contestant[],
    });
  }, [roomId]);
```

**Edit D — thread contestants into the post-join refetch `setPhase`:**

Find:
```ts
      setPhase({
        kind: "ready",
        room: refetched.room as RoomShape,
        memberships: ensureSelfInMemberships(memberships, session),
      });
      return;
    }
```

Replace with:
```ts
      setPhase({
        kind: "ready",
        room: refetched.room as RoomShape,
        memberships: ensureSelfInMemberships(memberships, session),
        contestants: (refetched.contestants ?? []) as Contestant[],
      });
      return;
    }
```

- [ ] **Step 3.2: Add the voting render branch**

Find (end of the file, the last two blocks):

```ts
  if (phase.room.status === "lobby") {
    const members: LobbyMember[] = phase.memberships.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      avatarSeed: m.avatarSeed,
    }));
    const shareBase =
      process.env.NEXT_PUBLIC_APP_URL ??
      (typeof window !== "undefined" ? window.location.origin : "");
    const shareUrl = `${shareBase}/room/${phase.room.id}`;
    return (
      <LobbyView
        pin={phase.room.pin}
        ownerUserId={phase.room.ownerUserId}
        memberships={members}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        startVotingState={startVotingState}
        shareUrl={shareUrl}
        onStartVoting={handleStartVoting}
        onCopyPin={handleCopyPin}
        onCopyLink={handleCopyLink}
      />
    );
  }

  return <StatusStub status={phase.room.status} />;
}
```

Insert a new voting branch **between** the lobby branch's closing `}` and the `return <StatusStub ...>` line:

```ts
  if (phase.room.status === "lobby") {
    const members: LobbyMember[] = phase.memberships.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      avatarSeed: m.avatarSeed,
    }));
    const shareBase =
      process.env.NEXT_PUBLIC_APP_URL ??
      (typeof window !== "undefined" ? window.location.origin : "");
    const shareUrl = `${shareBase}/room/${phase.room.id}`;
    return (
      <LobbyView
        pin={phase.room.pin}
        ownerUserId={phase.room.ownerUserId}
        memberships={members}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        startVotingState={startVotingState}
        shareUrl={shareUrl}
        onStartVoting={handleStartVoting}
        onCopyPin={handleCopyPin}
        onCopyLink={handleCopyLink}
      />
    );
  }

  if (phase.room.status === "voting") {
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
      />
    );
  }

  return <StatusStub status={phase.room.status} />;
}
```

- [ ] **Step 3.3: Verify type-check**

Run: `npm run type-check`
Expected: zero errors. TypeScript will surface any typos in the `Phase.ready` additions.

- [ ] **Step 3.4: Verify tests**

Run: `npm test -- --run`
Expected: all tests green.

- [ ] **Step 3.5: Commit**

```bash
git add src/app/room/[id]/page.tsx
git commit -m "$(cat <<'EOF'
room/[id]: render VotingView when status is 'voting'

Adds a branch to the existing page parallel to the lobby branch.
Contestants flow from the existing GET /api/rooms/{id} response (already
includes them) into a new contestants field on Phase.ready. StatusStub
remains the fallback for scoring / announcing / done.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Final verification

**Files:**
- None modified.

- [ ] **Step 4.1: Full test suite**

Run: `npm test -- --run`
Expected: all tests green. Baseline before this branch = 480 passing (per the prior branch's final count). After this branch = **487 passing** (+7 from Task 1).

- [ ] **Step 4.2: Type-check**

Run: `npm run type-check`
Expected: zero errors.

- [ ] **Step 4.3: Lint**

Run: `npm run lint`
Expected: only the pre-existing `src/hooks/useRoomRealtime.ts:30` warning about ref cleanup. Any new warning attributable to this branch is a failure — fix before finishing.

- [ ] **Step 4.4: Manual visual check**

1. Start `npm run dev`.
2. Create a room via `/create` (any event, any template).
3. Join it on a second device / browser tab.
4. As admin, click "Start voting" in the lobby.
5. Confirm the lobby disappears and `VotingView` renders on both clients.
6. Click score buttons on a contestant; verify the status label flips to `✓ scored N` and the animation fires.
7. Tap the selected button again; verify it clears.
8. Navigate Prev (should be disabled on the first contestant) and Next.
9. Score every category for one contestant; verify the header progress bar fills by `1 / total` and the label reads "1 scored".
10. Reload the tab; confirm scores are NOT persisted (expected — this slice has no autosave).
11. In DevTools → Rendering, toggle `prefers-reduced-motion: reduce` and confirm the score-pop animation is suppressed.

- [ ] **Step 4.5: Verify branch state**

Run: `git log --oneline main..HEAD`
Expected: four entries — three task commits plus the earlier design-doc commit:

```
<sha> room/[id]: render VotingView when status is 'voting'
<sha> VotingView: voting screen skeleton
<sha> VotingView: scoredCount helper + tests
<sha> docs: design for voting screen skeleton
```

- [ ] **Step 4.6: Report back**

Summarize:
- `src/components/voting/VotingView.tsx` + `scoredCount.ts` landed
- 7 new unit tests
- `src/app/room/[id]/page.tsx` updated with voting branch + `contestants` threading
- Scores explicitly ephemeral — autosave is the next stacked PR
- Branch ready to push + PR

---

## Self-review

**Spec coverage (design doc §1–§12):**
- §3 architecture → Tasks 2 + 3.
- §4 props surface → Task 2 (`VotingViewProps` interface matches verbatim).
- §5 state shape → Task 2 (`idx`, `scoresByContestant`, the `useMemo` sort, sparse Record storage).
- §6.1 header → Task 2 (flag, country, song/artist, running-order, `<progress>`, `{count} scored` label).
- §6.2 global scale strip → Task 2 (pulls from `SCORE_ANCHORS`).
- §6.3 score rows → Task 2 (maps over `categories`, derives `weightMultiplier`).
- §6.4 footer → Task 2 (Prev/Next, `variant="secondary"`, `aria-label`, boundary-disabled).
- §7 `scoredCount` helper → Task 1.
- §8 accessibility → Task 2 (`<h2>`, `<progress aria-label>`, `aria-label` on nav buttons).
- §9 empty-state fallbacks → Task 2 (early returns for `categories.length === 0` and `sortedContestants.length === 0`).
- §10 page integration → Task 3 (import, `Phase.ready` extension, two `setPhase` updates, new render branch).
- §11 decisions — all embodied in the listed code (sparse storage, defensive sort, local state, no deep-link, English-only scale strip).
- §12 follow-ups — tracked for future PRs, not implemented here.

**Placeholder scan:** No TBDs / TODOs / vague steps. Every code block is complete and self-contained.

**Type consistency across tasks:**
- `Record<string, number | null>` used consistently as the per-contestant scores shape (Task 1 signature, Task 2 state declaration).
- `categoryNames: readonly string[]` in Task 1 matches `categories.map((c) => c.name)` in Task 2.
- `Contestant` imported from `@/types` in both Tasks 2 and 3.
- `Phase.ready` gains exactly one new field, `contestants: Contestant[]`, and both `setPhase` call sites in Task 3 set it.
