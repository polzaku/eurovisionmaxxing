# ScoreRow Fill-Bar Redesign Implementation Plan (V16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the 5×2 score button grid inside `src/components/voting/ScoreRow.tsx` for the SPEC §8.2 segmented fill-bar: single row, 10 segments, cumulative gold fill (1..N on score=N), visible numerals, same tap semantics as the grid.

**Architecture:** JSX-only change inside `ScoreRow.tsx`. `nextScore` reducer unchanged (it returns `null | N` based on tap ↔ current value; the cumulative fill is purely visual). `scoredCount` helper unchanged. No new tests — `nextScore.test.ts` (13 cases) still covers every tap transition.

**Tech Stack:** Next.js 14 App Router, React 18 (client components), TypeScript strict, Tailwind tokens, Vitest (node env).

Design: [docs/superpowers/specs/2026-04-24-score-row-fillbar-design.md](../specs/2026-04-24-score-row-fillbar-design.md). SPEC: [SPEC.md §8.2](../../../SPEC.md).

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/components/voting/ScoreRow.tsx` | modify | Replace the `<div className="grid grid-cols-5 sm:grid-cols-10 ...">` block and its children with the fill-bar container + cumulative-fill segment JSX |

**Not touched:** `nextScore.ts`, `nextScore.test.ts`, `scoredCount.ts`, `scoredCount.test.ts`, `VotingView.tsx`, `globals.css`, `tailwind.config.ts`.

---

## Task 1: Swap the grid JSX for the fill-bar

**Files:**
- Modify: `src/components/voting/ScoreRow.tsx`

- [ ] **Step 1.1: Locate the block to replace**

Open `src/components/voting/ScoreRow.tsx`. Find the current button grid block (the last major JSX node inside the component's return value, starting with `<div` and containing the `grid-cols-5 sm:grid-cols-10` wrapper and its mapped buttons):

```tsx
      <div
        className="grid grid-cols-5 sm:grid-cols-10 gap-2"
        role="group"
        aria-label={`${categoryName} — score from 1 to 10`}
      >
        {BUTTONS.map((n) => {
          const selected = value === n;
          const pop = lastPressed === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => handleClick(n)}
              disabled={disabled}
              aria-label={`${categoryName}: score ${n}`}
              aria-pressed={selected}
              aria-describedby={hint ? hintId : undefined}
              className={`
                min-w-[44px] min-h-[44px] aspect-square rounded-lg font-semibold
                transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                disabled:cursor-not-allowed
                ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
                }
                ${pop ? "animate-score-pop" : ""}
              `.trim()}
            >
              {n}
            </button>
          );
        })}
      </div>
```

- [ ] **Step 1.2: Replace the block**

Replace the entire block above with the fill-bar:

```tsx
      <div
        className="relative grid grid-cols-10 w-full h-11 rounded-lg overflow-hidden border border-border bg-muted"
        role="group"
        aria-label={`${categoryName} — score from 1 to 10`}
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
              aria-describedby={hint ? hintId : undefined}
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
```

Key differences from the grid version:
- Container switches to `grid-cols-10` (no `sm:` breakpoint, no `grid-cols-5`); `gap-2` removed; container gains `rounded-lg overflow-hidden border border-border bg-muted` so it reads as one continuous bar.
- Height fixed to `h-11` (44px) on both container and each segment — vertical accessibility floor.
- Horizontal dimensions come from `grid-cols-10` sharing the parent's width; no per-segment `min-w` or `aspect-square`.
- Segments drop `rounded-lg` (container's `overflow-hidden` handles outer corners); drop `border border-border` (container owns it); drop `bg-muted` (container's background shows through); drop `hover:bg-muted/80` (touch-first, hover-preview would mislead).
- Added `border-r border-border/30` on every segment except the last for subtle inner separation.
- `filled = value !== null && n <= value` replaces the old `selected`-only fill — this is the cumulative-fill logic per SPEC §8.2.
- `selected = value === n` still drives `aria-pressed` (so screen readers announce only the exact picked value as "pressed").
- Focus ring uses `focus-visible:ring-inset` because container's `overflow-hidden` would clip an outset ring on the first/last segments.

- [ ] **Step 1.3: Verify type-check**

Run: `npm run type-check`
Expected: zero errors. No type signatures changed.

- [ ] **Step 1.4: Verify test suite**

Run: `npm test -- --run`
Expected: all 516 tests still pass. `nextScore.test.ts` should be green (13 cases, tap semantics unchanged).

- [ ] **Step 1.5: Verify lint**

Run: `npm run lint`
Expected: only the pre-existing `src/hooks/useRoomRealtime.ts:30` warning. No new warnings from `ScoreRow.tsx`.

- [ ] **Step 1.6: Commit**

```bash
git add src/components/voting/ScoreRow.tsx
git commit -m "$(cat <<'EOF'
ScoreRow: swap 5×2 grid for segmented fill-bar (V16)

Replaces the SPEC §8.2 button grid with the fill-bar spec'd in the
2026-04-24 rewrite: single row of 10 segments, cumulative gold fill
from 1..N on score=N, numerals visible inside each segment, tap to
set + tap selected to clear.

nextScore reducer unchanged; cumulative fill is purely visual.
animate-score-pop still fires on the tapped segment only.
aria-pressed remains true only on the exact picked value so screen
readers announce the selection unambiguously.

Design: docs/superpowers/specs/2026-04-24-score-row-fillbar-design.md
SPEC: §8.2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Final verification

**Files:** None modified.

- [ ] **Step 2.1: Manual visual check (required per CLAUDE.md UI-change policy)**

1. Start `npm run dev`
2. Create a room and a second browser tab, join from the second tab
3. As admin, click "Start voting"
4. On the voting screen:
   - Bar is a **single row** on every viewport (resize Chrome window narrower than 640px to confirm no wrap)
   - Tap segment 7 → segments 1–7 gold, 8–10 muted, score label reads "✓ scored 7"
   - Tap segment 3 while score=7 → score drops to 3, segments 4–7 clear
   - Tap segment 3 again (the current score) → clears back to "Not scored"
   - `animate-score-pop` fires on the tapped segment only
   - `Tab` focuses segments left-to-right; focus-visible ring visible inside the bar
   - Weight badge (if any category has `weight > 1`) still renders left of status label
   - Hint text (if category has one) still renders below the name
5. DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce" → tap; pop suppressed, selection still works
6. Narrow the viewport to 320px (iPhone SE) in DevTools device toolbar → bar stays single row, no horizontal scroll

- [ ] **Step 2.2: Verify branch state**

Run: `git log --oneline main..HEAD`
Expected: two entries:
```
<sha> ScoreRow: swap 5×2 grid for segmented fill-bar (V16)
<sha> docs: design for ScoreRow fill-bar redesign (V16)
```

- [ ] **Step 2.3: Push + open PR**

```bash
git push -u origin feat/score-row-fillbar
gh pr create --title "Phase 3: ScoreRow fill-bar redesign (V16)" --body "<body>"
```

Body should reference the design doc, SPEC §8.2, note no test changes, and include the manual verification results.

---

## Self-review

**Spec coverage (SPEC §8.2 + design doc):**
- Single-row fill-bar — Task 1.2 (`grid-cols-10`, no `sm:` breakpoint).
- 10 segments with visible numerals — Task 1.2 (`{n}` inside each `<button>`).
- Cumulative gold fill from 1..N — Task 1.2 (`filled = value !== null && n <= value`).
- Min 32×44 touch target — Task 1.2 (`h-11` = 44px, width via `grid-cols-10` sharing container width).
- `animate-score-pop` on tapped segment only — Task 1.2 (`pop ? "animate-score-pop" : ""` gated on `n === lastPressed`).
- Tap semantics (set / overwrite / clear) — inherited unchanged from `nextScore` via existing `handleClick`.
- Weight badge, hint, status label, disabled state — untouched (outside the replaced block).
- No per-row anchors — untouched (the scale strip is in `VotingView`).

**Placeholder scan:** No TBDs / TODOs / hand-wavy steps.

**Type consistency:** `value: number | null`, `lastPressed: number | null`, `BUTTONS: readonly [1..10]` — all unchanged from PR #17. Only the JSX block changes.
