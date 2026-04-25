# "I missed this" — PR 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the missed-state UI: a footer "I missed this" button on the voting card, a `<MissedCard>` that replaces the score rows when the contestant is flagged missed, and the wiring through `VotingView` + `room/[id]/page.tsx` so the toggle persists across reloads.

**Architecture:** Adds one new component (`MissedCard`), one new pure helper (`seedMissedFromVotes`), and additive state on `VotingView`. The footer becomes a 3-column grid `[Prev] [I missed this] [Next]`. UI assertions are deferred to manual smoke since vitest runs in `node` (no `.test.tsx` files exist in the repo); pure helpers stay TDD-covered.

**Tech Stack:** TypeScript, React, Tailwind, `next-intl` (consistent with existing voting components — note that the *existing* voting components use bare strings, so adding `useTranslations` here is an enhancement rather than a violation; confirm with the rest of the file before going one way or the other in Task 3).

**Spec:** `docs/superpowers/specs/2026-04-25-i-missed-this-design.md`

**Predecessor:** `docs/superpowers/plans/2026-04-25-i-missed-this-pr1.md` — must be merged or applied before starting.

---

### Task 1: `seedMissedFromVotes` — pure helper with TDD

**Files:**
- Create: `src/lib/voting/seedMissedFromVotes.ts`
- Create: `src/lib/voting/seedMissedFromVotes.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/voting/seedMissedFromVotes.test.ts
import { describe, it, expect } from "vitest";
import { seedMissedFromVotes } from "@/lib/voting/seedMissedFromVotes";
import type { VoteView } from "@/lib/rooms/get";

function vote(partial: Partial<VoteView>): VoteView {
  return {
    contestantId: "2026-FR",
    scores: null,
    missed: false,
    hotTake: null,
    updatedAt: "2026-04-25T12:00:00Z",
    ...partial,
  };
}

describe("seedMissedFromVotes", () => {
  it("returns an empty map for no votes", () => {
    expect(seedMissedFromVotes([], ["2026-FR", "2026-DE"])).toEqual({});
  });

  it("includes only contestants with missed: true", () => {
    const votes: VoteView[] = [
      vote({ contestantId: "2026-FR", missed: true }),
      vote({ contestantId: "2026-DE", missed: false }),
      vote({ contestantId: "2026-IT", missed: true }),
    ];
    const result = seedMissedFromVotes(votes, ["2026-FR", "2026-DE", "2026-IT"]);
    expect(result).toEqual({ "2026-FR": true, "2026-IT": true });
  });

  it("filters out votes for contestants not in the room's roster", () => {
    const votes: VoteView[] = [
      vote({ contestantId: "2026-FR", missed: true }),
      vote({ contestantId: "2026-XX-stale", missed: true }),
    ];
    const result = seedMissedFromVotes(votes, ["2026-FR", "2026-DE"]);
    expect(result).toEqual({ "2026-FR": true });
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/lib/voting/seedMissedFromVotes.test.ts`
Expected: FAIL with "Cannot find module '@/lib/voting/seedMissedFromVotes'".

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/voting/seedMissedFromVotes.ts
import type { VoteView } from "@/lib/rooms/get";

/**
 * Build the missed-by-contestant map from the server's VoteView[].
 * Only contestants flagged missed are included; non-missed and unknown
 * contestants are omitted (callers treat absence as `false`).
 */
export function seedMissedFromVotes(
  votes: readonly VoteView[],
  contestantIds: readonly string[]
): Record<string, boolean> {
  const validContestants = new Set(contestantIds);
  const out: Record<string, boolean> = {};
  for (const v of votes) {
    if (!validContestants.has(v.contestantId)) continue;
    if (v.missed) out[v.contestantId] = true;
  }
  return out;
}
```

- [ ] **Step 4: Run, all pass**

Run: `npx vitest run src/lib/voting/seedMissedFromVotes.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voting/seedMissedFromVotes.ts src/lib/voting/seedMissedFromVotes.test.ts
git commit -m "$(cat <<'EOF'
voting: seedMissedFromVotes — sparse missed map from server votes

Mirrors seedScoresFromVotes shape. Only contestants flagged missed
are included; absence is treated as false by callers. Defensively
filters out stale/unknown contestant ids. Wires into VotingView in
the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add locale keys for the missed flow

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Insert the new namespace**

Edit `src/locales/en.json`. After the `"onboarding"` block, add a `"voting"` namespace. (Verify via Read first that no `"voting"` block exists — if one was added by a parallel session, merge under it.)

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

Place it before `"errors"` so the file stays alphabetically grouped. Watch for the trailing comma — it's a JSON file.

- [ ] **Step 2: Run locales test**

Run: `npx vitest run src/locales/locales.test.ts`
Expected: PASS (the test only checks non-en bundles for completeness; non-en bundles are empty per existing convention so they're skipped via `it.todo`).

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "$(cat <<'EOF'
voting: en.json keys for the "I missed this" missed-state card

Adds voting.missed.* keys covering footer button, missed-state card
label, estimated-score label, per-category label, and the rescore
CTA. Toast keys land with PR3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Build `<MissedCard>` component

**Files:**
- Create: `src/components/voting/MissedCard.tsx`

- [ ] **Step 1: Decide whether to use `useTranslations`**

Read `VotingView.tsx` and check whether the surrounding components use `useTranslations` from `next-intl`. As of branch HEAD, they do **not** — they use bare English strings (e.g. `"Not scored"`, `"Prev"`). Stay consistent with the file: use bare English strings in `MissedCard.tsx`, mirroring `ScoreRow.tsx`.

(Phase 1.5 T11 extracted onboarding strings; voting-surface extraction is queued under "Phase L L1 partial" per TODO.md. Adding `useTranslations` here would be a one-off divergence — defer.)

The locale keys from Task 2 still land — Phase L will pick them up when voting-surface extraction happens.

- [ ] **Step 2: Write the component**

```tsx
// src/components/voting/MissedCard.tsx
"use client";

import Button from "@/components/ui/Button";
import type { ProjectedAverage } from "@/lib/voting/computeProjectedAverage";

export interface MissedCardProps {
  projected: ProjectedAverage;
  categories: { name: string }[];
  onRescore: () => void;
}

export default function MissedCard({
  projected,
  categories,
  onRescore,
}: MissedCardProps) {
  return (
    <div
      className="space-y-6 rounded-xl border border-border bg-muted/30 p-6"
      data-testid="missed-card"
    >
      <p className="text-sm text-muted-foreground text-center">
        This one&rsquo;s marked as missed
      </p>

      <div className="text-center space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Estimated score
        </p>
        <p className="text-5xl font-bold italic text-muted-foreground tabular-nums">
          ~{projected.overall}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Per category (estimated)
        </p>
        <ul className="space-y-1.5">
          {categories.map((c) => (
            <li
              key={c.name}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <span className="text-foreground/80 truncate">{c.name}</span>
              <span className="text-muted-foreground italic font-medium tabular-nums flex-shrink-0">
                ~{projected.perCategory[c.name] ?? 5}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={onRescore}
      >
        Rescore this contestant
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: clean. The import of `ProjectedAverage` from PR1 ensures type alignment.

- [ ] **Step 4: Commit**

```bash
git add src/components/voting/MissedCard.tsx
git commit -m "$(cat <<'EOF'
voting: MissedCard component — missed-state replacement for score rows

Renders the projected overall (~7) prominently plus per-category
projected breakdown and a "Rescore this contestant" secondary
button. Bare English copy matches surrounding voting components;
locale keys from the prior commit will be picked up by Phase L
voting-surface extraction. No tests — vitest is node-env and there's
no RTL setup in the repo; manual smoke covers the render in PR2's
final task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire `<MissedCard>` into `VotingView`

**Files:**
- Modify: `src/components/voting/VotingView.tsx`

- [ ] **Step 1: Add props for missed state**

Open `src/components/voting/VotingView.tsx`. In the `VotingViewProps` interface, after `initialScores`, add:

```ts
  initialMissed?: Record<string, boolean>;
  onMissedChange?: (contestantId: string, missed: boolean) => void;
```

- [ ] **Step 2: Add state, callback, projected memo, and import the new pieces**

At the top of the file, add imports:

```tsx
import MissedCard from "@/components/voting/MissedCard";
import {
  computeProjectedAverage,
  type ProjectedAverage,
} from "@/lib/voting/computeProjectedAverage";
import { useMemo } from "react";
```

(The existing imports already cover `useState`, `useCallback`, `useEffect`. Keep the existing `useMemo` import alongside or merge — TS will tell you if there's a duplicate.)

Add to the destructured props (alongside `roomId, userId, …`):

```ts
  initialMissed,
  onMissedChange,
```

After the existing `scoresByContestant` state, add:

```ts
  const [missedByContestant, setMissedByContestant] = useState<
    Record<string, boolean>
  >(() => initialMissed ?? {});

  const setMissed = useCallback(
    (contestantId: string, missed: boolean) => {
      setMissedByContestant((prev) => {
        const next = { ...prev };
        if (missed) next[contestantId] = true;
        else delete next[contestantId];
        return next;
      });
      onMissedChange?.(contestantId, missed);
    },
    [onMissedChange]
  );
```

- [ ] **Step 3: Compute projected average**

Just before the `return`, after the existing derived values (`firstWeight`, `nonUniformWeights`, `canPrev`, `canNext`):

```ts
  const isMissed = !!missedByContestant[contestant.id];
  const projected: ProjectedAverage = useMemo(
    () =>
      computeProjectedAverage(
        scoresByContestant,
        missedByContestant,
        categories
      ),
    [scoresByContestant, missedByContestant, categories]
  );
```

- [ ] **Step 4: Branch the render**

Replace the existing `<div className="space-y-6">` block that renders score rows. The new shape — keep the surrounding structure intact, just swap the body:

```tsx
        {isMissed ? (
          <MissedCard
            projected={projected}
            categories={categories}
            onRescore={() => setMissed(contestant.id, false)}
          />
        ) : (
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
        )}
```

- [ ] **Step 5: Restructure the footer to a 3-column grid**

Replace the existing `<nav className="grid grid-cols-2 gap-4 pt-4">` block:

```tsx
        <nav className="grid grid-cols-3 gap-3 pt-4">
          <Button
            variant="secondary"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={!canPrev}
            aria-label="Previous contestant"
          >
            ← Prev
          </Button>
          <Button
            variant="ghost"
            onClick={() => setMissed(contestant.id, true)}
            disabled={isMissed}
            aria-label="Mark this contestant as missed"
          >
            I missed this
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
```

- [ ] **Step 6: Type-check + tests**

Run: `npm run type-check && npm test`
Expected: clean type-check, all 606+ tests pass (no new tests added at this layer; logic is in the pure helpers).

- [ ] **Step 7: Commit**

```bash
git add src/components/voting/VotingView.tsx
git commit -m "$(cat <<'EOF'
voting: wire MissedCard + footer "I missed this" button

VotingView now holds missedByContestant state seeded from
initialMissed. Footer becomes a 3-col grid; tap "I missed this" →
sets missed for the current contestant and renders MissedCard in
place of the score rows. Rescore button on the card flips the flag
back. computeProjectedAverage runs from local state per spec Q2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire `room/[id]/page.tsx` to seed missed + pass the autosave callback

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

- [ ] **Step 1: Import `seedMissedFromVotes`**

Add to the existing imports at the top:

```ts
import { seedMissedFromVotes } from "@/lib/voting/seedMissedFromVotes";
```

- [ ] **Step 2: Compute and pass `initialMissed` + `onMissedChange`**

Find the `if (phase.room.status === "voting") {` branch. The current shape is:

```tsx
    const initialScores = seedScoresFromVotes(
      phase.votes,
      (phase.room.categories ?? []).map((c) => c.name),
      phase.contestants.map((c) => c.id)
    );
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        onScoreChange={autosave.onScoreChange}
        saveStatus={autosave.status}
        initialScores={initialScores}
        roomId={phase.room.id}
        userId={getSession()?.userId ?? undefined}
        offlineBannerVisible={autosave.offlineBannerVisible}
        drainNotice={autosave.drainNotice}
        onDismissDrainNotice={autosave.dismissDrainNotice}
        queueOverflow={autosave.queueOverflow}
      />
    );
```

Add `initialMissed` computation and pass it + `onMissedChange`:

```tsx
    const initialScores = seedScoresFromVotes(
      phase.votes,
      (phase.room.categories ?? []).map((c) => c.name),
      phase.contestants.map((c) => c.id)
    );
    const initialMissed = seedMissedFromVotes(
      phase.votes,
      phase.contestants.map((c) => c.id)
    );
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        onScoreChange={autosave.onScoreChange}
        onMissedChange={autosave.onMissedChange}
        saveStatus={autosave.status}
        initialScores={initialScores}
        initialMissed={initialMissed}
        roomId={phase.room.id}
        userId={getSession()?.userId ?? undefined}
        offlineBannerVisible={autosave.offlineBannerVisible}
        drainNotice={autosave.drainNotice}
        onDismissDrainNotice={autosave.dismissDrainNotice}
        queueOverflow={autosave.queueOverflow}
      />
    );
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/room/[id]/page.tsx
git commit -m "$(cat <<'EOF'
voting: wire missed state from server vote rehydration

room/[id]/page.tsx now seeds initialMissed via seedMissedFromVotes
and passes autosave.onMissedChange to VotingView. Reloading mid-show
restores any prior missed flags from the server.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new warnings/errors. The `useRoomRealtime` warning is pre-existing.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all PASS, including the new `seedMissedFromVotes` (3) tests. Total ≥ 609 (606 prior + 3).

- [ ] **Step 4: Pre-push gate**

Run: `npm run pre-push`
Expected: clean.

- [ ] **Step 5: Manual smoke (required — no UI test coverage in repo)**

Run: `npm run dev`. In a browser:
1. Create a room (or open an existing one), start voting.
2. On the first contestant, tap **I missed this** in the footer.
3. Confirm: the score-row grid is replaced by `<MissedCard>` showing `~5` overall + per-category `~5`s (no votes yet).
4. Tap **Next →** to a different contestant. Score every category (e.g. all 8s).
5. Tap **Prev ←** back to the first contestant. The missed card should now show `~8` overall and `~8` per category — projection updated from your votes.
6. Tap **Rescore this contestant** on the missed card. Score-row grid returns; footer "I missed this" button is enabled again.
7. Reload the page mid-voting (after marking another contestant missed). After the lobby/voting state resolves, the contestant should still be in missed state — confirms `initialMissed` seeding works.
8. Open Network tab; confirm `POST /api/rooms/{id}/votes` payloads carry `missed: true` / `missed: false` correctly.

If anything in step 1–8 misbehaves, iterate before moving to PR3.

---

## Self-Review

**Spec coverage:**
- §3 step 2 "footer button" → Task 4 step 5
- §3 step 3 "card switches to missed-state" → Task 4 step 4 + MissedCard in Task 3
- §3 step 6 "Rescore button" → Task 3 component + Task 4 step 4
- §3 step 7 "500ms debounce" → already in Autosaver from PR1; respected via `onMissedChange`
- §4 PR2 "MissedCard" → Task 3
- §4 PR2 "VotingView state + branching" → Task 4
- §4 PR2 "page.tsx seeding" → Task 5
- §4 PR2 "seedMissedFromVotes" → Task 1
- §4 PR2 "locale keys" → Task 2
- §5 "stale scores under a missed flag" → handled implicitly by `setMissed` using `delete` rather than `set false` (so the next render of MissedCard sees a missing key, identical to "missed: false") + `computeProjectedAverage` filters by `missedByContestant[id]`
- §5 "navigation preserves missed flag" → `setIdx` doesn't touch `missedByContestant`; covered

**Placeholder scan:** none.

**Type consistency:**
- `ProjectedAverage` matches PR1 export.
- `seedMissedFromVotes(votes, contestantIds)` signature consistent across Tasks 1 + 5.
- `initialMissed?: Record<string, boolean>` matches between `VotingViewProps` (Task 4) and the call site (Task 5).
- `onMissedChange?: (contestantId, missed) => void` matches between `VotingViewProps` and the `useVoteAutosave` result type from PR1.

**Out of scope (deferred to PR3):** the bottom toast with 5s Undo (`<MissedToast>`, `useMissedUndo`), and the toast-related locale keys.
