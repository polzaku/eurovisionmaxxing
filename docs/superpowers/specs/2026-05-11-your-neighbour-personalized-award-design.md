# Design — `your_neighbour` personalized award

**Status:** Draft · 2026-05-11
**Scope:** V1.1 (post-MVP). Not part of the 2026-05-14 ship.
**Author:** brainstormed with the user 2026-05-11; design captures decisions Q1–Q3 + Approach A from that session.
**SPEC sections touched:** §11.0 (implementation status), §11.2 (personality awards table), §11.3 (reveal sequence), §12.5 (`done` payload), §17a.5 (RTL coverage).

---

## 1. Problem

The existing `neighbourhood_voters` award (SPEC §11.2) names a single room-wide pair: the two users with the highest pairwise Pearson correlation. Everyone in the room sees the same dual-avatar card — *"Alice & Bob voted most alike."* That moment is intentionally crowd-pleasing.

What it doesn't answer is *"who am I closest to?"* For most users in a room of >2, the answer is some pair they're not part of. We want a second, personalized award that surfaces — for every viewer — *their own* nearest neighbour in the room.

Constraints set during brainstorming:

- **Coexist, don't replace** (Q1 → B). The room-wide pair stays; the new award adds a personalized layer.
- **Members-only** (Q2 → A). Non-members opening `/results/{id}` via a share link don't see this award. The shareable headline already belongs to `neighbourhood_voters`; `your_neighbour` is intimate by design.
- **Dual-avatar with reciprocity flair** (Q3 → C). Viewer + neighbour side by side. A small badge appears only on mutual top-1 pairs ("you picked each other").

---

## 2. Naming

| Slot | Value |
|---|---|
| `award_key` | `your_neighbour` |
| Display name | *"Your closest neighbour"* |
| Caption | *"voted most like you"* |
| Reciprocity badge | *"you picked each other"* |
| Explainer | *"Of everyone in the room, this person's votes lined up most closely with yours."* |

Locale keys live under `awards.your_neighbour.*` (see §8).

---

## 3. Reveal-sequence position (SPEC §11.3)

New personality-award order:

1. Biggest stan
2. Harshest critic
3. Most contrarian
4. Hive mind master
5. **Neighbourhood voters** *(room-wide pair, unchanged)*
6. **Your closest neighbour** ← new
7. Dark horse
8. Fashion stan
9. *(bets, V2 only)*
10. The enabler *(always last)*

Rationale: both pairing awards stay adjacent. Room-wide pair lands first as the celebrity moment; the personalized one immediately follows as the intimate reflection. Bringing `your_neighbour` later (after Fashion stan) would make viewers forget the pairing motif; placing it before `neighbourhood_voters` would steal the celebrity-pair payoff.

`<AwardsCeremony>` reads the viewer's session at mount; if the viewer has a `personalNeighbours` entry, the synthetic card is spliced into the sequence at this position. If they don't, the slot is silently omitted and the viewer goes straight from card 5 to card 7.

---

## 4. Compute (`src/lib/awards/`)

### 4.1 Shared helper

Extract from `buildNeighbourhoodVoters` into a new exported helper:

```ts
// src/lib/awards/userVectors.ts
export function buildUserVectors(
  input: ComputeAwardsInput,
): Map<string, number[]>;
```

Identical semantics to the inline block today:
- For each user, build a vector of per-contestant mean scores (mean of category values for that user × contestant pair).
- Substitute `0` for missing contestants.
- **Drop** any user whose vector is all zeros (zero-signal voter).

Both `buildNeighbourhoodVoters` and the new `buildPersonalNeighbours` consume this map.

### 4.2 New compute

```ts
// src/lib/awards/buildPersonalNeighbours.ts
export interface PersonalNeighbour {
  userId: string;          // viewer (alphabetically-keyed by their own id is irrelevant; key is just their id)
  neighbourUserId: string;
  pearson: number;         // 3-decimal precision: Number(corr.toFixed(3))
  isReciprocal: boolean;
}

export function buildPersonalNeighbours(
  input: ComputeAwardsInput,
): PersonalNeighbour[];
```

**Algorithm:**

1. `vectors = buildUserVectors(input)`. If `vectors.size < 3` → return `[]` (in a 2-user room the only candidate is the same other user, which duplicates the room-wide pair for both viewers; no new information).
2. For each user *u* in `vectors`:
   - For every other user *v* in `vectors`, compute `pearsonCorrelation(vectors[u], vectors[v])`.
   - Pick the *v* with the highest Pearson. Ties broken by `v.displayName.localeCompare(otherCandidate.displayName)` — alphabetical neighbour wins. Matches the determinism of the existing `buildNeighbourhoodVoters`.
   - Record `{ userId: u, neighbourUserId: v, pearson, isReciprocal: false }`.
3. Reciprocity pass: for every entry `(a, b)`, if there exists an entry `(b, a)`, set `isReciprocal = true` on both.

**Cost:** O(N² · C) where N = users with signal, C = contestants. N ≤ 30 in practice, C ≤ 40 ⇒ ≤ 36k floating-point ops. Negligible compared to a Supabase round-trip.

**Determinism:** with ties broken alphabetically and reciprocity computed symmetrically, the output is a pure function of the votes — same room, same result.

### 4.3 Wiring

`buildPersonalNeighbours` is **not** called from `computeAwards` (which writes `room_awards` rows during scoring). It runs on the *read* side:

- New call site in `src/lib/results/loadResults.ts`, gated on `room.status === 'done'`.
- Reuses the same `votes` + `users` + `contestants` data already loaded for the existing `done` payload — no extra DB round-trips.
- Result attached to the payload (see §5).

---

## 5. API surface

### 5.1 Payload shape

The `done` discriminant of `LoadResultsPayload` (SPEC §12.5) gains:

```ts
personalNeighbours: Array<{
  userId: string;
  neighbourUserId: string;
  pearson: number;
  isReciprocal: boolean;
}>;
```

- Empty array when the room has <3 signal-bearing voters.
- Absent on `lobby` / `voting` / `voting_ending` / `scoring` / `announcing` discriminants. (The TypeScript discriminated union already enforces this — the new field lives only on the `done` arm.)

### 5.2 Endpoints

Both endpoints return the new field:

- `GET /api/rooms/{id}/results` (member-authenticated; SPEC §12.5)
- `GET /api/results/{id}` (public; SPEC §12.1)

**No new auth.** The payload exposes the full per-user mapping. The client renderer (§6, §7) decides what to surface to the viewer based on their session. This matches how `contestantBreakdowns` already works — the data is in the payload; rendering is the gate.

This is a deliberate trade. We could filter server-side based on the caller's session, but:
- `/api/results/{id}` is public — there's no caller identity to filter against.
- Filtering server-side means two payload shapes for the same `done` room (one for members, one for strangers), which complicates caching, share-link semantics, and the existing `loadResults` single-payload contract.
- The pairings aren't sensitive — they're a derived statistic from publicly-readable votes (RLS already exposes `votes` once room is `announcing`/`done`). The privacy choice is purely UX: we choose not to *render* them to non-members, but the data exists in any case.

If this turns out to be wrong, the server-side filter is a one-line addition later.

---

## 6. Cinematic reveal (`<AwardsCeremony>`)

### 6.1 `awardCeremonySequence` extension

Current signature (rough):

```ts
function awardCeremonySequence(
  awards: ComputedAward[],
  ctx: { users, contestants },
): CeremonyCard[];
```

Extended:

```ts
function awardCeremonySequence(
  awards: ComputedAward[],
  ctx: {
    users,
    contestants,
    personalNeighbours?: PersonalNeighbour[];
    viewerUserId?: string | null;
  },
): CeremonyCard[];
```

When both `personalNeighbours` and `viewerUserId` are present, find the entry where `userId === viewerUserId`. If found, splice a synthetic `CeremonyCard` of `kind: "personal-neighbour"` directly after the `neighbourhood_voters` card (or, if no `neighbourhood_voters` card exists in this room, at the same index it *would* have occupied — between `hive_mind_master` and `the_dark_horse`).

Synthetic card shape:

```ts
{
  kind: "personal-neighbour",
  viewerUser: UserView,
  neighbourUser: UserView,
  pearson: number,
  isReciprocal: boolean,
}
```

No `room_awards` row, no `winnerUserId` plumbing — the renderer reads directly off the card.

### 6.2 `<AwardCeremonyCard>` new branch

Add a third branch alongside `"contestant"` and the existing default (winner+partner). Layout:

- Header strip: `awards.your_neighbour.name`
- Dual avatars side by side (viewer left, neighbour right) — same `flex -space-x-3` overlap as the existing `neighbourhood_voters` card
- Names line: *"You & {neighbour.displayName}"*
- Caption (italic, muted): *"voted most like you"*
- Reciprocity badge (only when `isReciprocal`): small pill below caption, *"you picked each other"*, accent color
- Explainer paragraph (always shown inline for ceremony, matching existing pattern)
- Stat line: *"Pearson {value.toFixed(2)}"*

Animations: reuse `motion-safe:animate-fade-in` (matches existing branches).

### 6.3 Reveal driver wiring

`<DoneCeremony>` already passes `awards` and `ctx` to `<AwardsCeremony>`. It additionally passes `personalNeighbours` and the viewer's session `userId` (already in scope — used elsewhere for ready/skip plumbing). No new prop drilling beyond that.

---

## 7. `/results/{id}` static surface (`<AwardsSection>`)

A new `<YourNeighbourCard>` renders inline inside `<AwardsSection>`, slotted between the `neighbourhood_voters` card and the next personality award. It mirrors the ceremony card's content but with the static-card sizing already used by `<AwardsSection>`.

**Visibility gate:**
- Resolve the viewer's session `userId` from the existing client-side session hook.
- If `viewerUserId` matches an entry in `personalNeighbours`, render the card.
- Otherwise (stranger with no session, member of a different room, zero-signal member of this room) — render nothing for this award.

The existing `neighbourhood_voters` card is unaffected — it renders for everyone regardless of session, same as today.

---

## 8. Locale keys (`en.json`)

```json
{
  "awards": {
    "your_neighbour": {
      "name": "Your closest neighbour",
      "caption": "voted most like you",
      "reciprocalBadge": "you picked each other",
      "explainer": "Of everyone in the room, this person's votes lined up most closely with yours."
    }
  }
}
```

- Added to `awardExplainers.ts` registry so both the ceremony card and the static card reuse the same explainer string.
- `locales.test.ts` updated to expect the new keys in `en.json`.
- Non-`en` locales (`es`, `uk`, `fr`, `de`) leave the keys empty per the existing Phase L skip-empty rule. Translation lands when Phase L L3 ships.

---

## 9. Tests

### 9.1 Unit — `buildPersonalNeighbours.test.ts`

- Happy path: 3 users with distinct vectors → 3 entries, each pointing at correct argmax, no reciprocity.
- Mutual top-1: Alice's best is Bob, Bob's best is Alice → both rows `isReciprocal: true`.
- Tie: Alice equidistant from Bob and Carol → neighbour is alphabetically earlier `displayName`.
- Zero-signal exclusion: 4 users where 1 has all-zero votes → returns 3 entries, no row pointing at the zero-signal user, no row for them as viewer.
- Skip <3 users: 2-user room → `[]`. 1-user → `[]`. 0-user → `[]`.
- Determinism: shuffle the input `users` array, expect identical output (sorted-then-asserted).
- Sanity perf: 30 users × 40 contestants → completes under 10 ms.

### 9.2 Integration — `loadResults.test.ts`

- `done` payload includes `personalNeighbours` array; shape matches contract.
- `announcing` / `scoring` / `voting` payloads do **not** include the field (TypeScript discriminant enforces this).
- `done` room with 2 voters → `personalNeighbours: []`.
- `done` room with 4 voters where 1 has zero signal → array of length 3.

### 9.3 Sequence — `awardCeremonySequence.test.ts`

- Viewer with a `personalNeighbours` entry → synthetic card spliced immediately after `neighbourhood_voters`.
- Viewer with no entry → no synthetic card; existing sequence length preserved.
- Stranger `viewerUserId === null` → no synthetic card.
- Room lacks `neighbourhood_voters` (e.g. <2 users for that one) but has `personalNeighbours` — impossible by construction (`personalNeighbours` requires ≥3 users which is stricter than `neighbourhood_voters`' ≥2); document the invariant and add a test asserting it.

### 9.4 RTL — `<AwardCeremonyCard>` (extend existing test file)

- `kind: "personal-neighbour"` renders both avatars + both names + caption.
- Reciprocity badge rendered when `isReciprocal: true`; absent when `false`.
- Stat line shows Pearson to 2 decimals.

### 9.5 RTL — `<YourNeighbourCard>` (new test file)

- Renders when viewer has a matching entry in `personalNeighbours`.
- Renders nothing when viewer's session resolves to a non-member or to a member with no entry.
- Reciprocity badge gating mirrors the ceremony card.

---

## 10. Out of scope (explicit non-goals)

| Item | Why deferred |
|---|---|
| `formatRoomSummary` / HTML / PDF export updates | These are public, viewer-less surfaces. The room-wide `neighbourhood_voters` line in the summary stays as-is. Adding a per-viewer line would need a viewer-aware summary generator — a separate feature. |
| Persistence in `room_awards` | Compute is cheap; storing N rows per room would require either a PK migration on `room_awards` or a new `room_personal_awards` table (Approach B in brainstorming). Promote to that only if a second personalized award lands. |
| Server-side per-caller filtering of the payload | See §5.2 trade. Single payload shape is simpler; UX gate is purely client-side rendering. |
| Public listing of all pairings on `/results/{id}` | Explicitly rejected in Q2 — privacy/intimacy trade is net-negative. |
| New realtime event | The data is only relevant during `status='done'`. No live broadcast hook needed. |
| Contestant-coupled personalized award ("your favourite") | Different feature; separate spec if/when it surfaces. |

---

## 11. Rollout

- **No schema migration.** No new table, no PK change, no RLS update.
- **No new endpoint.** The new field rides on the existing `loadResults` payload.
- **No new realtime event.** No subscriber update.
- **No feature flag needed.** Existing rooms in `done` status get the new card retroactively on next page load. Pre-deploy `loadResults` returns `personalNeighbours: undefined`; the client renderer treats `undefined` the same as `[]` (no card).
- **Reversible.** Deleting the new compute, new card branch, new locale keys, and the field from the payload is mechanical. No data migration required because nothing was persisted.

---

## 12. SPEC edits required (separate commit, lands before implementation plan)

- §11.0 implementation status: add line for `your_neighbour` under V1.1.
- §11.2 personality-awards table: new row with metric definition.
- §11.2 storage note: clarify that `your_neighbour` is the one personality award **not** persisted in `room_awards` — it's read-side compute.
- §11.3 reveal sequence: insert step 6 between `neighbourhood_voters` and `the_dark_horse`. Note that this step's card content is viewer-dependent; viewers without an entry skip the step silently.
- §12.5 done payload: append `personalNeighbours` to the `done` discriminant.
- §17a.5 RTL coverage: list the two new test files as required RTL coverage for the V1.1 slice.
