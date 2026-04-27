# End-of-voting affordance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a contextual card on the last contestant card during voting that tells the user where they are in the flow — all-scored / missed-some / unscored-K — with quick-jump CTAs.

**Architecture:** One pure helper (`endOfVotingState`) + one presentational component (`<EndOfVotingCard>`) + a gated render in `VotingView` when `idx === total - 1`. Purely client-side; no API, no broadcast, no schema. Source-of-truth: SPEC §8.11.

**Tech Stack:** TypeScript, React, Next.js 14, vitest. Codebase convention: TDD on pure helpers; components are validated by manual dev-server smoke (no React testing lib installed). See [docs/superpowers/specs/2026-04-26-end-of-voting-affordance-design.md](docs/superpowers/specs/2026-04-26-end-of-voting-affordance-design.md).

---

## Task 1: Pure helper `endOfVotingState`

**Files:**
- Create: `src/lib/voting/endOfVotingState.ts`
- Test: `src/lib/voting/endOfVotingState.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/voting/endOfVotingState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Contestant } from "@/types";
import { endOfVotingState } from "./endOfVotingState";

const C = (id: string, country: string, runningOrder: number): Contestant => ({
  id,
  country,
  countryCode: id.slice(-2),
  flagEmoji: "🏳️",
  artist: "A",
  song: "S",
  runningOrder,
  event: "final",
  year: 2026,
});

const CATEGORIES = ["vocals", "outfit"];

function fullScores() {
  return { vocals: 7, outfit: 8 };
}

describe("endOfVotingState", () => {
  it("returns allScored when every contestant is fully scored and none missed", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {
        "2026-al": fullScores(),
        "2026-be": fullScores(),
      },
      missedByContestant: {},
    });
    expect(state).toEqual({ kind: "allScored", total: 2 });
  });

  it("returns missedSome when no unscored but at least one missed (filled scores irrelevant)", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {
        "2026-al": fullScores(),
        "2026-be": fullScores(),
      },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("missedSome");
    if (state.kind === "missedSome") {
      expect(state.missed.map((c) => c.id)).toEqual(["2026-be"]);
    }
  });

  it("returns missedSome when missed contestant has no scores at all", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": fullScores() },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("missedSome");
  });

  it("returns unscored when at least one contestant has no full scores and is not missed", () => {
    const contestants = [
      C("2026-al", "Albania", 1),
      C("2026-be", "Belgium", 2),
      C("2026-cy", "Cyprus", 3),
    ];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {
        "2026-al": fullScores(),
        "2026-be": { vocals: 5, outfit: null },
      },
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
    if (state.kind === "unscored") {
      expect(state.unscored.map((c) => c.id)).toEqual(["2026-be", "2026-cy"]);
    }
  });

  it("prefers unscored over missedSome when both apply", () => {
    const contestants = [C("2026-al", "Albania", 1), C("2026-be", "Belgium", 2)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": fullScores() },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("missedSome");
  });

  it("prefers unscored when one unscored AND one missed coexist", () => {
    const contestants = [
      C("2026-al", "Albania", 1),
      C("2026-be", "Belgium", 2),
      C("2026-cy", "Cyprus", 3),
    ];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": fullScores() },
      missedByContestant: { "2026-be": true },
    });
    expect(state.kind).toBe("unscored");
    if (state.kind === "unscored") {
      expect(state.unscored.map((c) => c.id)).toEqual(["2026-cy"]);
    }
  });

  it("treats null category values as not-scored", () => {
    const contestants = [C("2026-al", "Albania", 1)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: { "2026-al": { vocals: 5, outfit: null } },
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
  });

  it("treats undefined contestant scores as not-scored", () => {
    const contestants = [C("2026-al", "Albania", 1)];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {},
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
  });

  it("returns allScored with total 0 for empty contestants", () => {
    const state = endOfVotingState({
      contestants: [],
      categoryNames: CATEGORIES,
      scoresByContestant: {},
      missedByContestant: {},
    });
    expect(state).toEqual({ kind: "allScored", total: 0 });
  });

  it("preserves running-order for unscored list", () => {
    const contestants = [
      C("2026-cy", "Cyprus", 3),
      C("2026-al", "Albania", 1),
      C("2026-be", "Belgium", 2),
    ];
    const state = endOfVotingState({
      contestants,
      categoryNames: CATEGORIES,
      scoresByContestant: {},
      missedByContestant: {},
    });
    expect(state.kind).toBe("unscored");
    if (state.kind === "unscored") {
      expect(state.unscored.map((c) => c.runningOrder)).toEqual([3, 1, 2]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/voting/endOfVotingState.test.ts`
Expected: FAIL — `Cannot find module './endOfVotingState'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/voting/endOfVotingState.ts`:

```ts
import type { Contestant } from "@/types";
import { scoredCount } from "@/components/voting/scoredCount";

export type EndOfVotingState =
  | { kind: "allScored"; total: number }
  | { kind: "missedSome"; missed: Contestant[] }
  | { kind: "unscored"; unscored: Contestant[] };

export interface EndOfVotingStateInput {
  contestants: readonly Contestant[];
  categoryNames: readonly string[];
  scoresByContestant: Record<
    string,
    Record<string, number | null> | undefined
  >;
  missedByContestant: Record<string, boolean>;
}

export function endOfVotingState(
  input: EndOfVotingStateInput
): EndOfVotingState {
  const { contestants, categoryNames, scoresByContestant, missedByContestant } =
    input;

  const missed: Contestant[] = [];
  const unscored: Contestant[] = [];

  for (const c of contestants) {
    if (missedByContestant[c.id]) {
      missed.push(c);
      continue;
    }
    const filled = scoredCount(scoresByContestant[c.id], categoryNames);
    if (filled !== categoryNames.length) {
      unscored.push(c);
    }
  }

  if (unscored.length > 0) return { kind: "unscored", unscored };
  if (missed.length > 0) return { kind: "missedSome", missed };
  return { kind: "allScored", total: contestants.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/voting/endOfVotingState.test.ts`
Expected: PASS — 10 tests, 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voting/endOfVotingState.ts src/lib/voting/endOfVotingState.test.ts
git commit -m "feat(voting): endOfVotingState pure helper

Classifies the user's vote state into one of three end-of-voting variants
(allScored / missedSome / unscored). Reuses scoredCount as the
fully-scored definition. Source: SPEC §8.11."
```

---

## Task 2: Locale keys

**Files:**
- Modify: `src/locales/en.json` — add `voting.endOfVoting.*` block

- [ ] **Step 1: Add the keys**

Edit `src/locales/en.json`. After the existing `voting.jumpTo` block (just before the closing `}` of `voting`), insert a new sibling block. The final `voting` object should look like:

```json
"voting": {
    "missed": { ... existing ... },
    "hotTake": { ... existing ... },
    "jumpTo": { ... existing ... },
    "endOfVoting": {
      "allScored": "✅ All {count} scored — waiting for {admin} to end voting.",
      "allScoredFallback": "✅ All {count} scored — waiting for the host to end voting.",
      "missedSome": "⚠️ You marked {count} as missed — they'll be filled with your average. Tap to rescore any.",
      "unscoredCount": "⚠️ {count} still unscored",
      "rescoreCta": "Rescore",
      "jumpToCta": "Score now"
    }
  }
```

- [ ] **Step 2: Run locales test to verify it still passes**

Run: `npx vitest run src/locales/locales.test.ts`
Expected: PASS — non-en bundles are empty `{}`, so they hit the `it.todo` branch.

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "feat(voting): en.endOfVoting keys for SPEC §8.11

Adds 6 keys: 5 from SPEC + allScoredFallback for the race-safe path
when adminDisplayName is not yet available in memberships."
```

---

## Task 3: Component `<EndOfVotingCard>`

**Files:**
- Create: `src/components/voting/EndOfVotingCard.tsx`

No test file — voting components in this codebase are validated via dev-server smoke (see `MissedCard.tsx`, `HotTakeField.tsx`, `JumpToDrawer.tsx` — none have unit tests). Pure logic is in `endOfVotingState.ts` and is fully covered.

- [ ] **Step 1: Implement the component**

Create `src/components/voting/EndOfVotingCard.tsx`:

```tsx
"use client";

import type { EndOfVotingState } from "@/lib/voting/endOfVotingState";
import Button from "@/components/ui/Button";

export interface EndOfVotingCardProps {
  state: EndOfVotingState;
  adminDisplayName?: string;
  onJumpTo: (contestantId: string) => void;
}

export default function EndOfVotingCard({
  state,
  adminDisplayName,
  onJumpTo,
}: EndOfVotingCardProps) {
  if (state.kind === "allScored") {
    const message = adminDisplayName
      ? `✅ All ${state.total} scored — waiting for ${adminDisplayName} to end voting.`
      : `✅ All ${state.total} scored — waiting for the host to end voting.`;
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="all-scored"
        className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
      >
        {message}
      </div>
    );
  }

  if (state.kind === "missedSome") {
    return (
      <div
        role="status"
        data-testid="end-of-voting-card"
        data-variant="missed-some"
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
      >
        <p>
          ⚠️ You marked {state.missed.length} as missed — they&rsquo;ll be filled
          with your average. Tap to rescore any.
        </p>
        <ul className="space-y-2">
          {state.missed.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span aria-hidden="true">{c.flagEmoji}</span>
                <span className="truncate">{c.country}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onJumpTo(c.id)}
                aria-label={`Rescore ${c.country}`}
              >
                Rescore
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="end-of-voting-card"
      data-variant="unscored"
      className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground space-y-3"
    >
      <p>⚠️ {state.unscored.length} still unscored</p>
      <ul className="space-y-2">
        {state.unscored.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span aria-hidden="true">{c.flagEmoji}</span>
              <span className="truncate">{c.country}</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onJumpTo(c.id)}
              aria-label={`Score ${c.country} now`}
            >
              Score now
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component type-checks**

Run: `npm run type-check`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/voting/EndOfVotingCard.tsx
git commit -m "feat(voting): EndOfVotingCard component (SPEC §8.11)

Renders the three end-of-voting states: green-tinted allScored card,
amber missedSome list with Rescore CTAs, amber unscored list with
Score-now CTAs. Pure presentation; logic lives in endOfVotingState."
```

---

## Task 4: Wire into `VotingView`

**Files:**
- Modify: `src/components/voting/VotingView.tsx`

- [ ] **Step 1: Add import + prop**

Add to the import block at the top:

```tsx
import EndOfVotingCard from "@/components/voting/EndOfVotingCard";
import { endOfVotingState } from "@/lib/voting/endOfVotingState";
```

Extend `VotingViewProps` (between `userId?` and `offlineBannerVisible?`):

```ts
adminDisplayName?: string;
```

Destructure `adminDisplayName` from props in the component signature next to `userId`.

- [ ] **Step 2: Compute end-of-voting state and render**

Inside the component body, after the existing `projected` `useMemo`, add:

```ts
const endState = useMemo(
  () =>
    endOfVotingState({
      contestants: sortedContestants,
      categoryNames,
      scoresByContestant,
      missedByContestant,
    }),
  [sortedContestants, categoryNames, scoresByContestant, missedByContestant]
);

const isLastContestant = idx === sortedContestants.length - 1;
```

Note: `categoryNames` is already declared further down (line 259 in the current file) as `categories.map(c => c.name)`. **Move that declaration up** to before this `useMemo` so `endState` can use it. Alternatively, recompute inline — but moving is cleaner. The existing usage in `fullyScoredCount` / `<JumpToDrawer>` continues to work.

In the JSX, between the `<HotTakeField>` and `<nav>` blocks, insert:

```tsx
{isLastContestant && (
  <EndOfVotingCard
    state={endState}
    adminDisplayName={adminDisplayName}
    onJumpTo={(id) => {
      const target = sortedContestants.findIndex((c) => c.id === id);
      if (target >= 0) setIdx(target);
    }}
  />
)}
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — including the existing voting suite. The new helper tests are still green.

- [ ] **Step 5: Commit**

```bash
git add src/components/voting/VotingView.tsx
git commit -m "feat(voting): render EndOfVotingCard on last contestant

Gated on idx === total - 1; reuses setIdx for jump CTAs (same path
as JumpToDrawer.onSelect). adminDisplayName is wired through as an
optional prop."
```

---

## Task 5: Wire into `room/[id]/page.tsx`

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

- [ ] **Step 1: Derive `adminDisplayName` and pass it down**

Inside the function that renders the voting branch (look for the `<VotingView` JSX call around line 362), just before the `<VotingView` block, add:

```tsx
const adminDisplayName = phase.memberships.find(
  (m) => m.userId === phase.room.ownerUserId
)?.displayName;
```

Then add the prop to the `<VotingView>` element:

```tsx
adminDisplayName={adminDisplayName}
```

Place it next to `isAdmin={isAdmin}` for grouping.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/room/[id]/page.tsx
git commit -m "feat(voting): pass adminDisplayName into VotingView

Derived from memberships by ownerUserId. Falls back to undefined
when membership data is racing — EndOfVotingCard handles the
fallback locally."
```

---

## Task 6: Verification

- [ ] **Step 1: Final type-check + tests**

Run: `npm run type-check && npm test`
Expected: PASS for both.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS, or fix any new warnings introduced by this slice.

- [ ] **Step 3: Manual dev-server smoke**

```bash
npm run dev
```

Open a room as a guest. Vote on every contestant except the last. Swipe to the last:
- Confirm the **unscored** card appears with one row per remaining unscored contestant. Tap "Score now" → the screen jumps to that contestant. Confirm the card disappears (we're no longer on the last contestant).
- Swipe back to the last. Score every category. Confirm the card reflects the new state.
- Mark one contestant as missed. Confirm the **missedSome** card appears. Tap "Rescore" → jumps. Confirm.
- Score everything (none missed). Confirm the **allScored** card appears with the host's display name.
- On any non-last contestant, confirm no card is rendered.

If anything is off, fix and re-commit before moving on.

- [ ] **Step 4: Update TODO.md**

Tick the line in `TODO.md` under Phase U:

```
- [x] **End-of-voting affordance** for guests when they reach the last contestant. ...
```

Append a parenthetical implementation note:

```
_(landed in feat/end-of-voting-affordance: <commit-hash>; pure helper + presentational component, no broadcast. SPEC §8.11.)_
```

Commit:

```bash
git add TODO.md
git commit -m "todo: tick end-of-voting affordance (Phase U)"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin claude/strange-khayyam-c38dfa
gh pr create --title "feat(voting): end-of-voting affordance (SPEC §8.11)" --body "$(cat <<'EOF'
## Summary
- New pure helper `endOfVotingState` classifies the user's last-contestant state
- New `<EndOfVotingCard>` component renders the three SPEC §8.11 variants
- Wired into `VotingView` (gated on `idx === total - 1`) and `room/[id]/page.tsx`
- 6 new `voting.endOfVoting.*` keys in `en.json`

Closes the smoke-tested 2026-04-26 gap where the voting flow felt
unfinished after scoring the last country.

## Test plan
- [ ] `npm run type-check` clean
- [ ] `npm test` — 10 new helper tests + existing suite green
- [ ] Smoke: lobby → vote all-but-last → swipe to last → see unscored variant → tap Score-now → jumps
- [ ] Smoke: vote everything → see allScored with host name
- [ ] Smoke: mark one missed → see missedSome → tap Rescore → jumps
- [ ] Smoke: any non-last contestant shows no card

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

- **Spec coverage:** Every requirement in [the design doc](docs/superpowers/specs/2026-04-26-end-of-voting-affordance-design.md) is mapped:
  - Helper signature + classification rules → Task 1
  - Component renders three variants with right copy → Task 3
  - Wire-in gated on last contestant → Task 4
  - `adminDisplayName` derivation → Task 5
  - Six locale keys → Task 2
  - Verification + TODO.md tick → Task 6
- **Placeholder scan:** No TBDs, all code blocks fully populated.
- **Type consistency:** `EndOfVotingState` discriminator + `kind` values match between helper, tests, and component. Prop names (`state`, `adminDisplayName`, `onJumpTo`) are stable across Tasks 3 and 4.
- **Risks:** moving the `categoryNames = categories.map(...)` declaration up in `VotingView` (Task 4 step 2) — confirm no other code below depends on its current position. (It's used only by `fullyScoredCount` and `<JumpToDrawer>`, both rendered after where it would move.)
