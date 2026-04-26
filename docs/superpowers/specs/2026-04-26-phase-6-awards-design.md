# Phase 6 — Awards (computation + persistence + results-page rendering)

**Date:** 2026-04-26
**SPEC refs:** §11.1 (category awards), §11.2 (personality awards), §11.3 (awards screen) — render-only subset
**TODO refs:** Phase 6 items 1–4 (the bet-coupled awards 11.2a are deferred to Phase V2 along with R7 bets)

## 1. Goal

After scoring, compute every award per SPEC §11.1/§11.2, persist to `room_awards`, and surface them on `/results/[id]` so the announce → done landing finally has a payoff. The cinematic one-at-a-time reveal screen on `/room/[id]` lands later (Phase 6.2).

## 2. Scope

**In:**
1. `src/lib/awards/computeAwards.ts` — pure fn from `(categories, contestants, users, votes, results) → RoomAward[]`. No I/O, fully unit-testable.
2. Schema migration: `room_awards.winner_user_id_b UUID REFERENCES users(id)` (additive). Required by Neighbourhood voters + 2-way personality ties (§11.2).
3. `runScoring` extension: after the results UPSERT, compute awards and UPSERT them into `room_awards` (idempotent under retry).
4. `loadResults` and `RoomAward` domain type extended with `winnerUserIdB`.
5. `/results/[id]` page renders an Awards section when `data.awards.length > 0`. Card per award; pair awards use the existing dual-avatar layout pattern.
6. Locale keys for award names + stat labels (English only — non-`en` locales fall back via Phase 1.5 deep-merge).

**Out (deferred):**
- Bet-based awards (§11.2a — Oracle, Wishcaster) — gated on `rooms.bets_enabled` which doesn't exist yet (R7 → V2).
- Cinematic awards reveal screen on `/room/[id]` (Phase 6.2). For now `<DoneCard>` continues to send users to `/results`.
- The 3-CTA strip ("Copy share link" / "Copy text summary" / "Create another room") — already partly shipped in 5a (Copy text summary on results page); the others land with Phase 6.2.

## 3. Awards catalogue (8 personality + N category)

### 3.1 Category awards (one per `room.categories[*]`)
- **`award_key`**: `best_<categoryKey>` where `categoryKey = category.key ?? slugify(category.name)` to keep keys stable across i18n renames.
- **Winner**: contestant with highest mean score in that category, **across non-missed votes only**.
- **Tiebreak**: count of voters who gave > 8 in that category. Then alphabetical by `contestant.country` for full determinism.
- **Stat**: mean rounded to 1 decimal. `stat_value = mean`, `stat_label = "{country} {mean}/10"`.
- **Storage**: `winner_contestant_id` set; `winner_user_id` and `winner_user_id_b` null.

### 3.2 Personality awards

| `award_key` | Logic | Storage |
|---|---|---|
| `harshest_critic` | Lowest mean given across non-missed votes (per-user mean of all category scores) | user, statValue = mean |
| `biggest_stan` | Highest mean given (same compute as above) | user, statValue = mean |
| `hive_mind_master` | Lowest Spearman distance from group consensus ranking | user, statValue = 1 − corr |
| `most_contrarian` | Highest Spearman distance | user, statValue = 1 − corr |
| `neighbourhood_voters` | Pair with highest pairwise Pearson | user + userB, statValue = corr |
| `the_dark_horse` | Contestant with highest variance in total scores across users | contestant, statValue = variance |
| `fashion_stan` | User who gave the single highest score in the outfit-like category | user, statValue = max score |
| `the_enabler` | User whose 12-points (rank-1 results row) went to the overall group winner | user, statValue = null |

**"Group consensus ranking"** — for hive-mind / contrarian: sort contestants by their MEAN-of-means score (mean across users of each user's mean-across-categories for that contestant). Compare the user's own ranking from `results` (rank field) against this consensus rank.

**Spearman distance** = `1 − Spearman(userRanks, consensusRanks)` over the same set of contestants. Already implemented in `src/lib/scoring.ts::spearmanCorrelation`.

**Pearson** for Neighbourhood voters: across each contestant, take user A's mean-of-categories and user B's mean-of-categories. `pearsonCorrelation` already exists. Pair = `(A, B)` with maximum correlation. Store in alphabetical-by-display-name order.

**Outfit-like category match for Fashion stan**: case-insensitive substring search over `category.name` for any of `outfit`, `costume`, `fashion`, `look`. Pick the first match. **If no match, skip the award.**

**The enabler**: find the leaderboard winner (contestant with highest `Σ points_awarded`). Find the user(s) whose `points_awarded === 12` row went to that contestant. If exactly one user → award. Two users → joint (winner_user_id + winner_user_id_b, alphabetical). 3+ → top two alphabetical.

### 3.3 Tiebreaking (joint winners)

Per SPEC §11.2: "if two users tie on any personality metric, both are stored as joint winners (`winner_user_id` + `winner_user_id_b`) and rendered as a joint credit on the card. 3+ way ties resolve deterministically by display-name alphabetical order to pick the top two — a known MVP limitation."

Implementation: ranked list of candidates sorted by metric (and alphabetical secondary). Ties = floats within `EPS = 1e-9`. Top 2 with the same metric → joint. 1 winner → solo. 3+ tied → top 2 alphabetical.

### 3.4 Edge cases

- **Single user**: skip Neighbourhood voters (needs ≥2 users), skip Hive mind / Most contrarian (single user IS the consensus, trivially correlated). Single-user category awards still fire.
- **Zero non-missed votes for a user**: exclude from Harshest critic / Biggest stan / Fashion stan / Hive mind / Contrarian / Neighbourhood candidates.
- **Empty room (no users)**: returns `[]`. Defensive.
- **Variance computation**: for Dark horse, use `Σ((x - mean)²) / n` (population variance). Acceptable for MVP — the absolute value isn't shown to users, only relative ranking.

## 4. Module layout

```
src/lib/awards/computeAwards.ts          # pure fn (NEW)
src/lib/awards/computeAwards.test.ts     # NEW
src/lib/awards/awardKeys.ts              # constant keys + display names (NEW)

src/lib/rooms/runScoring.ts              # extend — call computeAwards, upsert room_awards
src/lib/rooms/runScoring.test.ts         # +cases for awards write

src/lib/results/loadResults.ts           # forward winnerUserIdB
src/lib/results/loadResults.test.ts      # +case

src/types/index.ts                       # RoomAward gains winnerUserIdB
src/types/database.ts                    # room_awards.winner_user_id_b on Row/Insert/Update
supabase/schema.sql                      # ALTER TABLE migration note inline

src/app/results/[id]/page.tsx            # render awards section (was empty)
src/components/results/AwardsSection.tsx # NEW — grouped awards card list
src/locales/en.json                      # awards.* keys
```

## 5. Award catalogue + i18n

`awardKeys.ts` exports a typed const array of personality keys + a `categoryAwardKey(category)` helper. Used by both compute (to set `award_key`) and the UI (to look up display names). Display names also live in `en.json` under `awards.<key>.name` and `awards.<key>.stat`.

For category awards, `award_name` is composed at compute time as `"Best {categoryName}"` since category names are user-defined.

## 6. Render plan (`/results/[id]`)

`AwardsSection` component, rendered when `data.awards.length > 0`. Layout:

```
[Heading: "Awards"]

[Category awards subhead]
  card: 🇸🇪 Sweden — Best Vocals — 8.4/10
  card: ...

[Personality awards subhead]
  card: avatar + name — Harshest critic — avg 4.2/10
  card: dual-avatar + names — Neighbourhood voters — voted most alike (Pearson 0.92)
  card: 🐎 (or generic) — The dark horse — Italy (variance 6.1)
  ...
```

Cards use existing token classes (`bg-card`, `border-border`). Pair-award card has two avatars side-by-side. Contestant-award card uses the country flag emoji as the visual anchor.

Order on the page (matches §11.3 except no cinematic reveal pacing):
1. Category awards (in `room.categories` order)
2. Personality awards in §11.3 order: Biggest stan, Harshest critic, Most contrarian, Hive mind master, Neighbourhood voters, Dark horse, Fashion stan, The enabler

## 7. Test plan

**Pure-fn unit tests** (`computeAwards.test.ts`):
- 3-user × 4-contestant fixture covering all 8 personality awards on canonical data
- Single-user room: only category + dark-horse-style awards fire (skip pair / consensus)
- All-missed votes for one user: that user excluded from Harshest/Biggest/Fashion candidates
- Outfit-like category match: name=`Outfit` matches; name=`Costume`; name=`Stage performance` (no match) skips Fashion stan
- 2-way tie on biggest_stan → joint winners
- 3-way tie → top 2 alphabetical
- Empty room → `[]`
- The enabler with multiple 12-pointers to the winner → joint

**Integration tests** (`runScoring.test.ts`):
- Happy path: awards UPSERTed after results UPSERT in the `live` flow
- Idempotent retry: second run UPSERTs same award rows without duplicates

**Loader tests** (`loadResults.test.ts`):
- `winnerUserIdB` flows through to the done payload

## 8. Schema migration

Single additive `ALTER TABLE` for `winner_user_id_b`. Inline as a comment in `supabase/schema.sql` (matches the pattern from `delegate_user_id` in 5b.1):

```sql
-- Existing-database migration (run via Supabase SQL Editor):
--   ALTER TABLE room_awards ADD COLUMN IF NOT EXISTS winner_user_id_b UUID REFERENCES users(id);
```

## 9. Risks & non-goals

- **Bet-based awards** are part of §11.2a and explicitly deferred (R7 → V2). The compute fn doesn't try to handle them; the catalogue type is open enough to extend later.
- **Cinematic awards reveal screen** is the second half of §11.3 (Phase 6.2). For 6.1, the room page transitions straight to `<DoneCard>` → `/results/{id}`.
- **The Enabler ambiguity**: spec is silent on what happens if zero users gave 12 to the winner (e.g. winner won by spread of 8s/10s). For 6.1, skip the award in that case. Logged as a known edge.
- **Locale coverage**: only `en.json` populated this phase. Non-en locales fall back via Phase 1.5 deep-merge.
- **Variance / correlation precision**: floats. Tiebreak via `EPS = 1e-9` — adequate for MVP fixture sizes.
