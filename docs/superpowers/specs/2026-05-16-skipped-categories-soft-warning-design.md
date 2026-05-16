# Skipped-categories soft warning — design

**TODO #3** — "how do we handle missing category (i.e. user rates 4/5 categories)?"

## Decision summary

Keep the existing scoring logic unchanged. Surface a **soft warning** in the
voting UI so users know they have unfilled categories and that those gaps
won't be counted in their weighted score.

No blocking, no submission gate, no scoring-engine change.

## Why no scoring change

The current `computeWeightedScore` (`src/lib/scoring.ts`) silently
renormalises: weighted score = Σ(givenScore × weight) ÷ Σ(givenWeight).
This means skipping low-confidence categories can inflate a contestant's
score, but in practice the fix space is fraught:

- Treating missing as `0` over-penalises legitimate "I genuinely couldn't
  decide" cases and ruins the live UX on show night.
- Imputing missing as the user's per-cat average matches the
  "missed contestant" logic but is harder for users to predict —
  they might give a low score that auto-fills high.
- Blocking submission until all categories are filled punishes the
  fast-paced "score-as-you-watch" flow this app is built for.

The lightest-touch fix is to make the gap **visible**: users see they've
skipped a category, decide whether to fix it, and accept the trade-off
explicitly. Same scoring math; better-informed users.

## Scope note (added at implementation time)

The aggregate end-of-voting note is **deferred to a follow-up**.
`EndOfVotingCard` has multiple variants and shoehorning a global
"skipped categories on N contestants" footer touches every variant
plus the underlying `endOfVotingCardVariant` reducer. Per-contestant
pill alone covers the user complaint ("how do we handle missing
category") and ships safely tonight.

## Surfaces

### Per-contestant pill

Where: contestant card header (in the active voting view) AND the
corresponding jump-to drawer row.

When: rendered only when `scoresByContestant[contestantId]` contains
**at least one** truthy category score AND **at least one** category
left unset (i.e. partial). Not rendered for fully-empty rows
("unscored") or fully-scored rows.

Copy (en): `Skipped {skipped} of {total}`.
- skipped = `categories.length − Object.keys(scores).filter(v => v != null).length`
- total = `categories.length`

Locale keys:
- `voting.skipped.pill` — `"Skipped {skipped} of {total}"`
- Other 4 locales updated for parity (translator-review noted).

Visual: muted-foreground pill, smaller than the existing scored-by chip.
Not a status, just informational. No icon.

### Aggregate end-of-voting note

Where: existing `<EndOfVotingCard>` (or the equivalent footer on the
voting view when the user is "done" with all contestants but some have
partial-category scores).

When: rendered when the user has finished voting (all contestants either
scored or missed) AND the count of contestants with partial-category
scores > 0.

Copy (en):
- `voting.skipped.aggregate` — `"You skipped categories on {count} {count, plural, one {contestant} other {contestants}} — those gaps won't be counted."`

Visual: small muted-foreground line below the existing CTAs. Not a
warning colour — informational.

## Out of scope

- Scoring engine changes.
- Forcing complete-vote submission.
- Per-category retroactive validation on the server.
- Translator review of non-English locales (deferred to a separate pass).

## Test plan

**Unit (RTL)**:
- New `<SkippedCategoriesPill>` component:
  - Renders nothing when scores object is empty.
  - Renders nothing when every category has a non-null score.
  - Renders `Skipped {n} of {total}` when partial.
- Integration: `<VotingView>` includes the pill on the contestant
  card header for the current contestant when partial; does not when
  full or empty.
- Integration: `<JumpToDrawer>` shows the pill on rows with partial
  scores.
- Integration: `<EndOfVotingCard>` (or the aggregate slot) shows the
  aggregate copy when count > 0; hides when count = 0.

**No Playwright**: this is a pure UI surface change; RTL exercises every
branch. Same scoping rationale as #4 (`scoredChip` disambiguation).

## File touch-list

- `src/components/voting/SkippedCategoriesPill.tsx` (new)
- `src/components/voting/SkippedCategoriesPill.test.tsx` (new)
- `src/components/voting/VotingView.tsx` — wire the per-contestant pill
- `src/components/voting/JumpToDrawer.tsx` — wire the row pill
- `src/components/voting/EndOfVotingCard.tsx` (or wherever the
  end-of-voting aggregate copy belongs) — wire the aggregate note
- `src/locales/{en,de,es,fr,uk}.json` — new keys
- `src/locales/voting.copy.test.ts` — regression guards for the new
  copy keys (extend existing file)

## Risk

Low. Pure additive UI; no schema, no API, no scoring change. Worst case
on show night: pill copy renders awkwardly in a non-EN locale — easy
to hot-fix.
