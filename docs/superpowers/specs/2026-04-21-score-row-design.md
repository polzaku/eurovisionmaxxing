# Design: `ScoreRow` (10-button score component)

**Date:** 2026-04-21
**Phase:** 3 (voting UI — first sub-slice)
**Depends on:** PR #15 (votes upsert endpoint, on `main`)
**SPEC refs:** §8.1 (global scale strip), §8.2 (score buttons), §7.2 (hints), §3.2 (animations), §3.3 (reduced motion)
**Phase U refs:** U.V1/V2/V3/V4 (superseded by 10-button grid), U §3.3 (reduced-motion gating), U.V15 (per-row weight badge)

---

## 1. Goal

Deliver the leaf UI primitive that replaces `src/components/ui/Slider.tsx` in the voting experience: a row of 10 tappable score buttons per category, with a weight badge, a hint line, and a status label.

This slice ships the component in isolation. Wiring it into `/room/[id]` (fetch, autosave, navigation) lives in subsequent stacked PRs.

## 2. Scope

### In scope
- `src/components/voting/ScoreRow.tsx` — the controlled React component.
- `src/components/voting/nextScore.ts` — the pure value-reducer (`(current, clicked) → next`).
- `src/components/voting/nextScore.test.ts` — vitest unit tests for the reducer.
- A `@media (prefers-reduced-motion: reduce)` override in `src/app/globals.css` that zeroes `animate-score-pop` (SPEC §3.3 + Phase U cross-cutting).

### Out of scope (tracked separately)
- Wiring into the voting screen; fetch / autosave / offline queue.
- The global 1/5/10 anchor strip (SPEC §8.1) — belongs to the parent voting-screen component, rendered once per card.
- The "I missed this" button and missed-state visuals (SPEC §8.3).
- Hot-take input (SPEC §8.7).
- Removal of `src/components/ui/Slider.tsx` — legacy component stays until the voting screen is rewritten to use `ScoreRow`; deletion happens in the wiring PR, keeping this PR additive.
- Other Phase U animations (`rank-shift`, `shimmer`, `fade-in`) getting reduced-motion gates — out of scope here; can piggyback on the CSS pattern established by this PR.

## 3. Component API

```ts
export interface ScoreRowProps {
  /** Displayed as the left-side label; also feeds the buttons' aria-label. */
  categoryName: string;
  /** Inline muted text below the category name (SPEC §7.2). */
  hint?: string;
  /** Controlled value. `null` = unset; otherwise an integer 1–10. */
  value: number | null;
  /** When >= 2, renders "counts {n}×" badge next to the name (SPEC §8.2). */
  weightMultiplier?: number;
  /** Called on every user action. `null` means "cleared". */
  onChange: (next: number | null) => void;
  /** Greys out the row and disables every button. */
  disabled?: boolean;
}
```

Parent owns the value. Component holds only the transient "which button was just pressed" flag used to drive `animate-score-pop`.

## 4. Visual states

SPEC §8.2 semantics — rendered with Tailwind tokens, never hardcoded hex (CLAUDE.md §3.2).

| State | Button classes | Status label |
|---|---|---|
| Unset | `bg-muted text-muted-foreground border border-border` | `Not scored` in `text-muted-foreground` |
| Selected (N) | `bg-primary text-primary-foreground` + transient `animate-score-pop` | `✓ scored {N}` in `text-primary` |
| Disabled | `opacity-50 cursor-not-allowed` on the whole row | — |

Weight badge (renders only when `weightMultiplier >= 2`):
```
<span class="inline-flex ml-2 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
  counts {n}×
</span>
```

## 5. Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Category name   [counts 2×]            [ ✓ scored 7 ]      │
│  hint text, muted, inline below name                         │
│  ┌───┬───┬───┬───┬───┐                                      │
│  │ 1 │ 2 │ 3 │ 4 │ 5 │  ← narrow viewports: grid-cols-5     │
│  ├───┼───┼───┼───┼───┤                                      │
│  │ 6 │ 7 │ 8 │ 9 │10 │                                      │
│  └───┴───┴───┴───┴───┘                                      │
│  (or a single row of 10 on sm+ via sm:grid-cols-10)         │
└─────────────────────────────────────────────────────────────┘
```

Container: `grid grid-cols-5 sm:grid-cols-10 gap-2`.
Each button: `min-w-[44px] min-h-[44px] aspect-square rounded-lg font-semibold` — the aspect ratio keeps each button a square across viewports (SPEC §8.2 "min 44×44 CSS px per button").

Note: the 1/5/10 anchor strip lives **once per card** in the parent voting screen (SPEC §8.1). This component does **not** render anchors.

## 6. Interaction — the reducer

```ts
export function nextScore(current: number | null, clicked: number): number | null {
  return current === clicked ? null : clicked;
}
```

One function, one line, covers every SPEC §8.2 transition:
- Tap N from unset → N
- Tap M from N (M ≠ N) → M
- Tap N from N (same button) → `null` (cleared)

Extracted from the component so tests can cover it without DOM infrastructure.

## 7. Animation

The `animate-score-pop` Tailwind keyframe already exists (`tailwind.config.ts:43`, scale 1 → 1.3 → 1 over 0.3s). It is designed to fire on each press of a button, not only on mount.

**Mechanism.** State holds `lastPressed: number | null`. When a user clicks button N:
1. Call `onChange(nextScore(value, N))`.
2. `setLastPressed(N)`.
3. A `useEffect([lastPressed])` with a `setTimeout(() => setLastPressed(null), 320)` clears the marker slightly after the 300ms animation completes. Cleanup clears the pending timer on re-press or unmount.

Only the button with `n === lastPressed` gets `animate-score-pop`. Because React reuses the same DOM node, we trigger re-animation by including the class inside the render output and leveraging the keyframe's natural one-shot nature — setting then clearing `lastPressed` causes a class change that restarts the animation.

**Reduced-motion gate.** Add to `src/app/globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-score-pop {
    animation: none;
  }
}
```

Component still sets `lastPressed`, the animation simply doesn't render. No JS feature-check needed.

## 8. Accessibility

- `<button type="button">` for every score slot (not `<input type="radio">` — the "tap to clear" affordance fits button semantics better than radio).
- Per button: `aria-label={\`\${categoryName}: score \${n}\`}`, `aria-pressed={value === n}`.
- Category name rendered in a `<span>`, not a `<label>` (the row is not a single form control).
- Focus ring: Tailwind `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` — re-uses existing `--ring` token.
- Hint rendered as a plain `<span>` under the name, with `aria-describedby` pointing from the row's buttons to an ID on the hint (one shared description for all 10 buttons).
- Disabled state: native `disabled` attribute — screen readers announce "dimmed" / "unavailable"; `aria-pressed` still reflects the current value.

Keyboard: Tab moves focus between buttons, Space/Enter activates them. Arrow-key navigation between buttons of the same row is **not added** — adds complexity that SPEC §8.2 doesn't require, and the tap-to-clear interaction doesn't map cleanly onto arrow-driven radio-group semantics.

## 9. Testing

### Reducer tests (in scope)
`src/components/voting/nextScore.test.ts` — one `describe` block, three behaviours:
1. `(null, N)` → `N` for every N in 1..10.
2. `(N, N)` → `null` (clear).
3. `(N, M)` where `N !== M` → `M` (overwrite).

Pure-function tests run under the existing vitest `node` environment; no new dependencies.

### Component / DOM tests (explicitly deferred)
The component file itself gets no test in this PR. Rationale:
- The vitest config is `environment: "node"` with no jsdom/happy-dom.
- There's no `@testing-library/react` dependency yet.
- The component's branching behaviour lives in the reducer; everything else in the component is conditional className + ARIA attributes.
- Visual correctness gets verified in `npm run dev` once `ScoreRow` is wired into the voting screen.
- Setting up DOM testing infra to cover one tiny component is premature — do it when multiple components benefit (likely the autosave chip + offline banner slice, whose behaviour is harder to verify by eye).

### Manual verification before merge
`npm run dev`, throw a `ScoreRow` into a scratch page (or the lobby view), click every state transition by eye — including with `prefers-reduced-motion: reduce` set via DevTools rendering emulation.

## 10. Non-obvious decisions (flagged)

1. **Reducer extraction.** The 1-line `nextScore` feels trivial, but extracting it means the tested code has zero coupling to React and the component file becomes mostly markup. Matches this repo's pattern (pure `src/lib/**` primitives are the tested layer; adapters glue them).
2. **No RTL/jsdom this PR.** Option consciously chosen (see §9). When a later component genuinely needs DOM tests, add the infra in its own PR.
3. **CSS-level reduced-motion gate.** One `@media` rule in `globals.css` is cheaper than per-component JS feature detection and composes with the other Phase U animations as they land.
4. **Weight badge as `weightMultiplier: number`, not a prerendered string.** Caller passes the raw number; component computes the display. Keeps the badge's formatting (and any future i18n) in one place.
5. **Legacy `Slider.tsx` stays.** This PR is additive only — no deletions. `ScoreRow` and `Slider` coexist until the wiring PR replaces every `Slider` caller with `ScoreRow` (currently zero callers in production code; `Slider` is imported nowhere but a stub scaffold).

## 11. Follow-ups spawned by this design

- Voting screen skeleton: render a contestant card with `ScoreRow` per category (next stacked PR).
- Delete `src/components/ui/Slider.tsx` once no caller references it.
- Extend the reduced-motion CSS override to `rank-shift`, `shimmer`, `fade-in` (Phase U cross-cutting).
- Optional: add `@testing-library/react` + happy-dom if a future component's behaviour is hard to verify without render tests.
