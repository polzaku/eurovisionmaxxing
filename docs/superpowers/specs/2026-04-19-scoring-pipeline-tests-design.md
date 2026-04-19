# Scoring Pipeline Tests + `scoreRoom()` — Design

- **Date:** 2026-04-19
- **TODO items:** Phase 0 — "First unit test around `src/lib/scoring.ts`"; partial pull-forward of Phase 4 — "Cover the scoring engine with tests … full pipeline on a small fixture room"; Phase 4 — extract the pure `scoreRoom()` function the API route will wrap.
- **Status:** Approved, awaiting implementation plan
- **Predecessor:** [2026-04-18-vitest-harness-design.md](./2026-04-18-vitest-harness-design.md)

## Context

`src/lib/scoring.ts` ships six pure functions (`computeWeightedScore`, `rankToPoints`, `tiebreak`, `computeMissedFill`, `spearmanCorrelation`, `pearsonCorrelation`) but has only a one-assertion smoke test. `CLAUDE.md` §2.2 flags the scoring engine as one of two places "where a missed edge case is user-visible during a live event" — it needs real coverage before any downstream phase builds on it.

The Phase 4 API route (`POST /api/rooms/{id}/score`) doesn't exist yet. Testing an inline re-implementation of the pipeline inside the test file risks drift: the test could keep passing while the real route disagrees with the spec. Instead, we extract the composition into a pure function `scoreRoom()` now, test that function, and let Phase 4's API route become a thin wrapper around it.

## Goals

1. Every primitive in `src/lib/scoring.ts` has happy-path + key-edge-case coverage.
2. A new pure function `scoreRoom()` composes the four scoring primitives per SPEC §9.1–9.5 and is covered by fixture-based tests that pin the full end-to-end behaviour.
3. Breaking any primitive produces an obvious failure in at least one `scoreRoom` test — the pipeline tests are the integration safety net the live Eurovision event relies on.

## Non-goals (explicit YAGNI)

- No API route. `POST /api/rooms/{id}/score` lands in Phase 4 and wraps `scoreRoom()`.
- No DB persistence. `scoreRoom` is pure; the caller handles reads/writes.
- No input validation inside `scoreRoom`. Preconditions are a contract the caller must honour (see §3 below).
- No exhaustive / fuzz testing. Branch-coverage of documented edges only.
- No tests for a "user with zero votes" or other states outside the `scoreRoom` contract.

## Design

### 1. `scoreRoom()` — signature and pipeline

Placed in `src/lib/scoring.ts` alongside the primitives. No new file — `scoreRoom` is the module's point of highest leverage, not a separate concern.

```ts
export interface ScoreRoomInput {
  categories: VotingCategory[];
  contestants: { id: string; country: string }[]; // country needed for tiebreak()
  userIds: string[];
  votes: Vote[]; // all votes in the room
}

export interface UserResult {
  userId: string;
  contestantId: string;
  weightedScore: number;
  rank: number;          // 1-indexed per user
  pointsAwarded: number; // 0..12 per EUROVISION_POINTS
}

export interface LeaderboardEntry {
  contestantId: string;
  totalPoints: number;
}

export interface ScoreRoomOutput {
  filledVotes: Vote[];                 // missed votes with scores filled in; missed=true retained
  results: UserResult[];               // one per (user × contestant) present in input votes
  leaderboard: LeaderboardEntry[];     // sorted by totalPoints desc; ties resolved by contestantId ascending (deterministic)
}

export function scoreRoom(input: ScoreRoomInput): ScoreRoomOutput;
```

Pipeline order (mirrors SPEC §9):

1. **Missed-fill (§9.1).** For each user, compute `fillValues = computeMissedFill(userVotes, categories)`. For each of that user's votes where `missed === true`, replace the `scores` object with `fillValues`. Keep `missed === true`. Non-missed votes pass through unchanged. Produces `filledVotes`.
2. **Weighted score (§9.2).** For each (user, contestant) pair whose vote row exists, compute `weightedScore = computeWeightedScore(filledScores, categories)`.
3. **Per-user ranking (§9.3 + §9.4).** For each user, sort their contestants by `weightedScore` descending, breaking ties with `tiebreak()`. Assign ranks 1..N (1-indexed).
4. **Points (§9.3).** `pointsAwarded = rankToPoints(rank)` per `UserResult`.
5. **Leaderboard (§9.5).** Sum `pointsAwarded` per contestant across all users. Sort descending; within ties, order by `contestantId` ascending for determinism.

### 2. Determinism

- `results` order is not part of the contract; tests sort before asserting.
- `leaderboard` order IS part of the contract: `totalPoints` desc, then `contestantId` asc.
- `scoreRoom` does not mutate its inputs. `filledVotes` is a new array of new `Vote` objects (new `scores` objects for the filled ones). This is a test-pinned invariant.

### 3. Preconditions (caller's contract — NOT validated inside `scoreRoom`)

- Every `vote.userId` appears in `userIds`.
- Every `vote.contestantId` appears in `contestants.id`.
- Every user in `userIds` has at least one vote row.
- Category names referenced in vote `scores` objects match names in `categories`.

Option **α** is in force for sparse votes: **if a user has a vote row for contestant X but no row for contestant Y, the user contributes no `UserResult` and no points for Y.** Missing rows are treated as "user didn't interact with that contestant," matching the DB's sparse layout (one `votes` row per user-contestant interaction). No row is synthesised.

Behavioural consequence: each user's ranking is computed over the contestants they actually have a row for — which may be fewer than the full contestant list. `rankToPoints` still maps those ranks 1..N normally.

### 4. Test plan

Single file, `src/lib/scoring.test.ts`, replacing the current smoke test. One `describe` per function. The smoke-test assertion `rankToPoints(1) === 12` survives as one case inside `describe("rankToPoints")`, keeping the harness/alias proof.

#### Primitives (~18 cases)

**`computeWeightedScore`** (5 cases):
1. Equal weights → simple average (e.g. `{a:6, b:8}` with weights `1,1` → `7`).
2. Custom weights → exact float (e.g. `{a:8, b:4}` with weights `2,1` → `20/3`).
3. Score object missing a category → category excluded from numerator AND denominator (not treated as 0).
4. Empty scores object → `0` (short-circuit `totalWeight === 0`).
5. **Pinned behaviour:** a category with `weight: 0` gets coerced to `1` via `cat.weight || 1`. SPEC §9.2 says blank defaults to 1; the code's current "0 counts as blank" quirk is pinned so any future fix is deliberate.

**`rankToPoints`** (4 cases):
1. Table-driven for ranks 1..10 → `[12,10,8,7,6,5,4,3,2,1]`.
2. Rank 11 → 0.
3. Rank 100 → 0.
4. Rank 0 → 0 (not in map, pins `?? 0` fallback).

**`tiebreak`** (4 cases):
1. Different peak scores → higher peak ranks first (negative return).
2. Equal peaks, different above-7 counts → higher count wins.
3. Equal peaks + equal counts → alphabetical country.
4. Sign-symmetry on a concrete pair: `Math.sign(tiebreak(a,b)) === -Math.sign(tiebreak(b,a))`.

**`computeMissedFill`** (5 cases):
1. User with some non-missed votes → `round(mean)` per category.
2. User with no non-missed votes (all missed) → every category filled with `5`.
3. Mix of missed + non-missed votes → missed rows excluded from the source of the mean.
4. Per-category isolation → category A's mean unaffected by category B's scores.
5. Rounding pinned: mean `6.5` rounds to `7` (JS `Math.round` behaviour).

#### Statistical (~6 cases)

**`spearmanCorrelation`** (3 cases):
1. Identical ranks → `1`.
2. Reverse ranks → `-1`.
3. `n < 2` (single element) → `0`.

**`pearsonCorrelation`** (3 cases):
1. Identical values → `1`.
2. Perfect negative (e.g. `[1,2,3]` vs `[3,2,1]`) → `-1`.
3. Constant series (zero variance) → `0`.

(Small known-fixture exact-value tests for these two were cut; identical/reverse/constant already exercise the math and Phase 6 awards can add more when there's a concrete consumer.)

#### Pipeline (3 cases)

Fixture factories kept in the test file; no external fixture directory yet.

1. **Canonical happy path.** 3 users, 4 contestants, 2 categories (equal weights, default weight 1). All votes present, none missed. Assert the full `results` set (one entry per user × contestant) and `leaderboard` against hand-calculated values.
2. **Missed-fill integration.** 2 users, 3 contestants, 1 category. User A's vote on contestant 2 has `missed: true`; user B has all scored. Assert user A's contestant-2 score equals the mean of their other non-missed votes, rounded. Assert the resulting ranking + points reflect the fill.
3. **Tiebreak cascade inside pipeline.** 1 user, 2 contestants whose weighted scores tie; peak-category score differs. Assert the higher-peak contestant receives 12 pts and the other receives 10 pts.

Total: ~27 test cases.

## Verification plan

1. `npm test` → all ~27 tests pass, exit 0.
2. Temporarily flip `rankToPoints` to return `rank * 2` (or similar wrong-but-syntactically-valid change). At least one `scoreRoom` fixture test MUST fail with a readable message. Revert.
3. `npm run type-check` → clean.
4. `npm run pre-push` → type-check then test, both green.

All four must pass before the TODO item is ticked.

## Trade-offs

- **Pulling `scoreRoom` forward from Phase 4.** This PR ships a piece of production code beyond "tests only". Accepted because the alternative (inline pipeline re-implementation in the test) has a real drift risk — the test would pin the test's idea of the pipeline, not the real one. The extra ~40–60 lines of production code pay for themselves in Phase 4's reduced scope.
- **Contract preconditions not validated.** `scoreRoom` trusts its input. This is intentional for a pure function; validation belongs at the API boundary. The test suite covers only in-contract inputs; out-of-contract behaviour is explicitly undefined.
- **`leaderboard` tie order is `contestantId` ascending.** Chosen for determinism because contestant IDs are the stable key format `"{year}-{countryCode}"`. An alternative would have been alphabetical-by-country, but that duplicates `tiebreak()`'s third tier without a SPEC reason. Stick with ID-sort.
- **Statistical tests are minimal.** Spearman/Pearson get 3 cases each, not more. Their real workout arrives in Phase 6 awards where they'll have concrete consumers (`hive_mind_master`, `most_contrarian`); more tests without consumers is YAGNI.

## Follow-ups (out of scope, tracked separately)

- **Phase 4:** build `POST /api/rooms/{roomId}/score`. It reads room + votes from DB, calls `scoreRoom()`, persists `filledVotes` back to `votes`, writes `results` rows, updates `rooms.status`, and broadcasts `status_changed`.
- **Phase 4:** larger fixture suite (multi-category, varied weights, many users) if a bug surfaces.
- **Phase 6:** exercise `spearmanCorrelation` / `pearsonCorrelation` via the awards logic; add tests driven by real award consumers.
