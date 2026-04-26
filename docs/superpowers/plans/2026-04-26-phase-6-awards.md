# Phase 6 Awards — implementation plan

Spec: [`docs/superpowers/specs/2026-04-26-phase-6-awards-design.md`](../specs/2026-04-26-phase-6-awards-design.md)

Strict TDD throughout. Failing test → confirm failure reason → make it pass. Type-check + tests green before each commit.

## Step 1 — Schema + types

- `supabase/schema.sql`: add `winner_user_id_b UUID REFERENCES users(id)` column + inline `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` migration note.
- `src/types/database.ts`: `winner_user_id_b: string | null` on Row + Insert + Update.
- `src/types/index.ts`: `RoomAward.winnerUserIdB: string | null`.

No tests in this step (typing only).

## Step 2 — `awardKeys.ts` constant module

`src/lib/awards/awardKeys.ts`:
- `PERSONALITY_AWARD_KEYS` const array of the 8 keys.
- `personalityAwardName(key)` — returns the English display name.
- `categoryAwardKey(category)` — returns `best_<category.key ?? slugified(name)>`.
- `categoryAwardName(category)` — `"Best {category.name}"`.
- Tiny tests confirming key shape + slug fallback.

## Step 3 — `computeAwards` pure fn — TDD increments

Tests first, with a 3-user × 4-contestant fixture. Each award's logic added in its own test→impl pair.

3a. **Category awards** — one per category. Test: 2 categories, expected best-per-category winners. Impl: per-category mean across non-missed votes, tiebreak by `>8` count, then alphabetical by country.

3b. **Harshest critic** — lowest per-user mean of all non-missed scores.

3c. **Biggest stan** — highest per-user mean.

3d. **Hive mind / Most contrarian** — Spearman distance from group consensus ranking. Reuse existing `spearmanCorrelation`. Compute group consensus from each contestant's mean-of-user-means.

3e. **Neighbourhood voters** — highest pairwise Pearson; reuse existing `pearsonCorrelation`. Pair stored alphabetically.

3f. **The dark horse** — contestant with highest variance in per-user total scores.

3g. **Fashion stan** — outfit-like category match (substring on `outfit|costume|fashion|look`, case-insensitive). Skip if no match.

3h. **The enabler** — leaderboard winner contestant; users whose 12-points went there. Skip if no users gave 12 to the winner.

3i. **Tiebreaking** — joint winners (2-way), alphabetical top-2 (3+).

3j. **Edge cases** — single user, all-missed user, empty room.

## Step 4 — `runScoring` integration

Extend `runScoring.ts`:
- After the `results` UPSERT (step 8), call `computeAwards({...})`.
- `room_awards` UPSERT with `onConflict: 'room_id,award_key'` so retries are idempotent.
- New error code `INTERNAL_ERROR` reuse on awards write failure.

Tests: extend `runScoring.test.ts`:
- Happy path: awards UPSERTed alongside results
- Awards write failure → 500
- Awards skipped/empty → no upsert call

## Step 5 — `loadResults` forwards `winnerUserIdB`

`src/lib/results/loadResults.ts`:
- `RoomAward` mapping in the `done` branch picks up the new field.
- Test asserts the field flows through.

## Step 6 — `<AwardsSection>` UI component

`src/components/results/AwardsSection.tsx`:
- Server component (used by the `done` branch of the results page).
- Section heading "Awards"
- Category awards subhead + cards (flag + country + "Best {categoryName}" + stat)
- Personality awards subhead + cards in §11.3 order
- Pair awards: dual-avatar layout
- Contestant awards (Dark horse): flag-anchored card

`/results/[id]/page.tsx`:
- When `data.awards.length > 0`, render `<AwardsSection awards={data.awards} contestants={data.contestants} memberships={...} />`.

## Step 7 — Locale keys

`src/locales/en.json`:
- `awards.heading`
- `awards.categorySubhead`
- `awards.personalitySubhead`
- `awards.<key>.name` for each personality award (8)
- `awards.<key>.statTemplate` for each (templated string for stat label, e.g. `"avg {mean}/10"`)
- `awards.bestIn` — `"Best {category}"`
- `awards.jointCaption` — `"joint winners"`
- `awards.neighbourhoodCaption` — `"voted most alike"`

`locales.test.ts` already validates structural integrity; the new keys add to the `en` shape.

## Step 8 — Verification

- `npm run pre-push`: type-check + 743+ tests + new coverage all green
- `npm run build`: clean
- Local smoke on the year-9999 fixture: vote → end voting → run announce → land on `/results/{id}` with awards visible
- Schema migration applied via SQL Editor: `ALTER TABLE room_awards ADD COLUMN IF NOT EXISTS winner_user_id_b UUID REFERENCES users(id);`
- Tick TODO Phase 6 + relevant Phase U + Phase R5 items

## Out of scope (redundant with spec §2 — restated for plan reviewers)

- Bet-based awards (R7 → V2)
- Cinematic awards reveal on `/room/[id]` (Phase 6.2)
- Three-CTA awards-screen footer (Phase 6.2)
