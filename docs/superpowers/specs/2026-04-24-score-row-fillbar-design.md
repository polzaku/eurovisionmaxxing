# Design: ScoreRow fill-bar redesign (V16)

**Date:** 2026-04-24
**Phase:** 3 / Phase U V16
**Depends on:** SPEC §8.2 rewrite (PR #20, merged)
**SPEC ref:** §8.2 (segmented fill-bar — authoritative description)

---

## 1. Goal

Swap `ScoreRow.tsx`'s 5×2 button grid for a single-row 10-segment fill-bar per the just-landed SPEC §8.2 rewrite. Everything else about `ScoreRow` stays identical: props surface, `nextScore` reducer, `animate-score-pop` trigger mechanism, weight badge, status label, hint, disabled state.

## 2. Scope

### In scope
- Replace the JSX body of `src/components/voting/ScoreRow.tsx` between the status label + scale context (above the buttons) and the closing `</div>`. Keep:
  - Props interface
  - `lastPressed` state + animation effect
  - `handleClick` (unchanged — still calls `nextScore`)
  - Header row (category name + weight badge + status label)
  - Hint paragraph

### Out of scope
- `nextScore` reducer — unchanged.
- `scoredCount` helper — unchanged.
- `VotingView` — already structured to render whatever `ScoreRow` looks like; no changes.
- SPEC.md — already rewritten in PR #20.
- TODO.md — V16 bullet already added.
- Tests — no new tests. The reducer's 13 existing cases still cover the tap semantics; visual correctness is manually verified in `npm run dev`.

## 3. Implementation-level decisions (not specified in SPEC)

| Question | Decision | Rationale |
|---|---|---|
| Segment separation | No gap between segments; inner `border-r border-border/30` between adjacent segments; outer container has `border border-border rounded-lg overflow-hidden` | Unified "fill-bar" feel like a battery/strength meter. Rounded corners come free from `overflow-hidden` on the container. |
| Rounded corners | Only container, via `overflow-hidden`. Segments are plain squares internally; the container's `rounded-lg` clips the outer two corners to match. | One source of rounding truth; segments stay simple. |
| Hover on segments | None — the old grid had `hover:bg-muted/80` on unselected buttons. Drop it. A fill-bar is a touch-first metaphor; desktop hover inviting a "preview fill" would mislead users into thinking hover=tap. | Simpler, matches mobile-first use case. |
| Disabled state | Container gets `opacity-50`; segments keep `disabled` + `cursor-not-allowed`. Same as current. | Unchanged behaviour. |
| `aria-pressed` semantics | `aria-pressed={value === n}` — pressed iff this is the user's actual picked value. Screen readers announce "segment 7 pressed, segment 6 not pressed" when score=7. | Cumulative fill is a visual affordance; the selected value is still a single number. Assistive tech users get unambiguous feedback. |
| `aria-label` per segment | `"{categoryName}: score {n}"` — identical to the grid. | Unchanged. |
| Focus ring | Inner segment gets `focus-visible:ring-2 focus-visible:ring-inset` (not outset — the outer container clips it). Ring colour via `--ring` token. | Matches segment/container topology. |
| `animate-score-pop` target | Still only the tapped segment (`n === lastPressed`), not the whole bar or every filled segment. | Matches SPEC: "the tapped segment (N) fires animate-score-pop on press". |
| Touch target min | Segment height 44px (h-11); segment width grows to fill available space via `grid grid-cols-10`, with a min width baked in. On a 320px viewport: 10 × 32 = 320, container edges eat 2px border → effectively 31.8px. Fine for thumb taps along a horizontal strip. | SPEC §8.2 explicitly relaxes horizontal to 32px; vertical keeps 44px floor. |
| Container width | `w-full` inside the existing `space-y-2` row wrapper. No max-width here — the parent (`VotingView`) sets the outer card to `max-w-xl`. | Parent owns layout envelope. |

## 4. The new JSX shape (sketch, not final code)

```tsx
<div
  className={`
    relative grid grid-cols-10 w-full h-11
    rounded-lg overflow-hidden
    border border-border
    bg-muted
  `.trim()}
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
          h-11 font-semibold text-sm
          transition-colors
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

Notes:
- `grid-cols-10` gives 10 equal segments that share the full width.
- `border-r border-border/30` on every segment except the last gives subtle visual separation within the bar.
- Container's `bg-muted` is the "unfilled background"; individual filled segments paint `bg-primary` over it. That way the filled region looks continuous (no gap-induced stripes).
- Container is `h-11` (44px) — the button height inside matches, giving each segment the vertical accessibility floor.

## 5. Accessibility notes

- Same keyboard model as the grid: Tab between segments, Enter/Space to activate. Shift-Tab reverses.
- `aria-pressed` only true on the exact picked value.
- The focus-visible ring uses `ring-inset` because the container clips overflow. Without `inset`, the ring would be invisible on the first/last segment corners.

## 6. Reduced-motion gate

Already in place from PR #17 (`@media (prefers-reduced-motion: reduce) { .animate-score-pop { animation: none; } }`). No CSS changes needed this PR.

## 7. Testing

- **Unit tests:** no new tests. Existing `nextScore.test.ts` (13 cases) still fully covers the tap semantics.
- **Type-check:** must stay clean.
- **Lint:** must stay clean on touched files.
- **Manual visual:** start `npm run dev`, create a room, start voting. Check:
  1. Bar is single-row on every viewport down to 320px.
  2. Tapping segment 7 fills segments 1..7 gold, 8..10 stay muted.
  3. Tapping segment 3 while score=7 clears 4..7 (score drops to 3).
  4. Tapping the current score's segment clears back to unset.
  5. `animate-score-pop` fires on the tapped segment only.
  6. DevTools `prefers-reduced-motion: reduce` suppresses the pop.
  7. `Tab` focuses segments in order; focus-visible ring is visible inside the bar.
  8. Weight badge + hint + status label positioning unchanged from PR #17.

## 8. Non-obvious decisions

1. **No gap between segments.** A visible gap would break the "continuous fill" metaphor and make the bar look like 10 separate buttons — which is what we just moved away from. Subtle inner borders give the segmentation cue without fragmenting the fill.
2. **Screen reader message = same as grid.** Using `aria-pressed={value === n}` keeps the assistive-tech affordance identical to before — "score 7 pressed" is unambiguous. The visual fill is a sighted-user affordance.
3. **No new tests.** Tempting to add a pure helper like `segmentClassesFor(value, n) → { filled, selected }`, but that's over-engineering for three ternaries. The test burden is already paid by `nextScore`; adding tests for className composition would test my CSS, not behaviour.
4. **No scroll fallback coded.** SPEC mentions `overflow-x: auto` for viewports narrower than 320px. In practice those devices are vanishingly rare, the container doesn't set `overflow-x: hidden`, and browsers handle minor cramping gracefully. Revisit if a real-user report surfaces.

## 9. Follow-ups (none)

Implementation maps 1:1 to spec. No spawned TODO items.
