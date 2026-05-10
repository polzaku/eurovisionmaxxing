# PR A — Short live reveal foundation (server + schema) — Implementation Design

**Slice:** PR A of 3 (foundation + server orchestrator). No UI surfaces in this PR — admin chooser ships in PR C, announcer / present / guest splash ship in PR B.

**Product spec of record:** [SPEC.md §10.2.2](../../SPEC.md#L987) (Short reveal style — Eurovision 2025-faithful) plus §13 schema and §6.1 wizard surface description. This doc covers **implementation tactics only** — what files change, what data structures look like, how the orchestrator branches.

**Scope:** schema + types + server orchestrator + tests. Settable only via direct DB UPDATE for now; UI in subsequent PRs.

## SPEC §10.2.2 corrections (commit 1)

Two typos in the locked spec that need fixing before code matches text:

1. Line 989: *"ranks 1–8 + 10"* → *"points 1–8 + 10"*. In this codebase, `results.rank` is the user's personal ranking position (rank 1 = their #1 pick = 12 points). The spec author meant **point values**, not personal ranks. The Eurovision 2025 broadcast keeps the 12-point reveal live and auto-reveals the other point values (1, 2, 3, 4, 5, 6, 7, 8, 10).
2. Line 996 and surface table: *"all eight contestants"* / *"(8 rows shifting)"* → **"all nine contestants"** / **"(9 rows shifting)"**. Point values 1, 2, 3, 4, 5, 6, 7, 8, 10 = nine distinct values.

Fix as the first commit of this PR so the spec matches code.

## Glossary

| Term | Meaning in this codebase |
|---|---|
| `results.rank` | User's personal ranking (1 = best, 10 = worst-of-top-10) |
| `results.points_awarded` | Points the user awards to that contestant (1, 2, 3, 4, 5, 6, 7, 8, 10, 12) |
| `current_announce_idx` | Position in the announcer's reveal queue. Queue is sorted `rank DESC`, so idx 0 = 1pt reveal, idx 9 = 12pt reveal |
| "auto-batch" | The 9 lower-points rows (everything except the 12-point pick = rank 1) that the server auto-reveals at turn-start under `announcement_style = 'short'` |
| `announcement_style` | New column. `'full'` (default, today's 10-step reveal) or `'short'` (auto-batch + single 12pt tap) |

## Files touched in this PR

| File | Action | Notes |
|---|---|---|
| `SPEC.md` | edit | typo fix (commit 1) |
| `supabase/schema.sql` | edit | add `announcement_style` column to `rooms` |
| `supabase/migrations/2026-05-11-add-announcement-style.sql` | create | operator-applied migration |
| `src/types/database.ts` | edit | add `announcement_style` to `rooms` Row/Insert/Update |
| `src/types/index.ts` | edit | (a) extend `Room` type with `announcementStyle: 'full' \| 'short'`; (b) extend `RoomEvent` union with `score_batch_revealed` variant |
| `src/lib/rooms/get.ts` | edit | SELECT and map `announcement_style` into `Room` |
| `src/lib/rooms/create.ts` | edit | accept optional `announcementStyle` in create input (defaults to `'full'`); INSERT it |
| `src/lib/rooms/autoBatchShortStyle.ts` | create | pure helper: given a user's results rows, return the 9 contestant IDs to auto-batch (rank ≠ 1) |
| `src/lib/rooms/autoBatchShortStyle.test.ts` | create | unit tests for the pure helper |
| `src/lib/rooms/runScoring.ts` | edit | when `live` + `short` + first announcer chosen, fire the auto-batch for that announcer |
| `src/lib/rooms/runScoring.test.ts` | edit | new cases for short-style first turn |
| `src/lib/rooms/advanceAnnouncement.ts` | edit | on rotation, fire next-user auto-batch when `style=short`; batch-reveal-mode interaction |
| `src/lib/rooms/advanceAnnouncement.test.ts` | edit | new cases for short style: rotation auto-batch, batch-reveal interaction, cascade |
| `src/lib/rooms/updateAnnouncementMode.ts` | edit | extend to also accept `announcementStyle` patch (lobby-edit will use this in PR C) — **only field validation in PR A**, no UI yet |

`finishTheShow.ts` is **NOT** touched in PR A because batch-reveal interaction is handled inside `advanceAnnouncement` (see "Batch reveal under short style" below).

## Schema

```sql
ALTER TABLE rooms
  ADD COLUMN announcement_style VARCHAR(5) NOT NULL DEFAULT 'full'
    CHECK (announcement_style IN ('full', 'short'));

COMMENT ON COLUMN rooms.announcement_style IS
  'SPEC §10.2.2 — short compresses live reveal to a single 12-point tap per user; ignored when announcement_mode = instant';
```

Already documented in SPEC §13 lines 1297–1298. Operator runs the migration between PR A merge and PR B start (same workflow as R4 #2 `batch_reveal_mode`).

## Type changes

### `Room`

```ts
export interface Room {
  // ...existing fields
  announcementMode: 'live' | 'instant';
  announcementStyle: 'full' | 'short';   // NEW
}
```

### `RoomEvent` union — new variant

```ts
| {
    type: "score_batch_revealed";
    announcingUserId: string;
    contestants: Array<{
      contestantId: string;
      points: number;
      newTotal: number;
      newRank: number;
    }>;
  }
```

**Why a new variant (not extending `score_update`):** The single-row `score_update` event is used by instant-mode reveal animations and the existing full-style reveal. A multi-row payload would force every subscriber to handle both shapes. A discriminated new variant is cleaner — subscribers that don't care about the batch (e.g., instant-mode pages) ignore it via the `switch (event.type)` exhaustiveness check.

## Auto-batch helper (`autoBatchShortStyle.ts`)

Pure helper, no I/O:

```ts
import type { AnnouncerResultRow } from "./advanceAnnouncement";  // share type

/**
 * Given a user's full reveal queue (sorted rank DESC — idx 0 = 1pt,
 * idx 9 = 12pt), return the rows to auto-batch under short style:
 * everything except rank = 1 (the 12-point pick).
 */
export function selectShortBatchRows(
  announcerRows: AnnouncerResultRow[],
): AnnouncerResultRow[] {
  return announcerRows.filter((r) => r.rank !== 1);
}

/**
 * Index of the 12-point reveal row inside the queue. The orchestrator
 * sets current_announce_idx to this value after the auto-batch so the
 * next advance call reveals only the 12-point row.
 *
 * Returns null if the user has no rank-1 row (degenerate; shouldn't
 * happen for eligible announcers but the orchestrator handles it
 * defensively).
 */
export function twelvePointIdx(
  announcerRows: AnnouncerResultRow[],
): number | null {
  const idx = announcerRows.findIndex((r) => r.rank === 1);
  return idx === -1 ? null : idx;
}
```

The mark-announced + broadcast logic stays in the orchestrators (`runScoring`, `advanceAnnouncement`) so the helper remains pure-testable.

## Orchestrator changes

### `runScoring.ts` — first-turn auto-batch

After the existing `firstPresentIdx < order.length` branch sets `announcing_user_id = order[firstPresentIdx]` and the `toAnnouncing` UPDATE commits, **if `style === 'short'` and the first announcer is non-null**:

1. Load the first announcer's results rows ordered `rank DESC`.
2. Pass through `selectShortBatchRows` to get the 9 auto-batch rows.
3. UPDATE all 9 rows with `announced = true` in one query (`.in("contestant_id", ids)`).
4. Set `current_announce_idx` to `twelvePointIdx(rows)` — the 12-point row's position in the queue.
5. Build the per-contestant `{ newTotal, newRank }` payload from the post-batch leaderboard query.
6. Broadcast one `score_batch_revealed` event.

Step 4 happens via a follow-up UPDATE on `rooms` (the initial transition UPDATE already happened in the existing code path). Keep this idempotent: re-running the orchestrator after a partial failure must not double-mark rows (`announced = true` is already idempotent; `current_announce_idx` overwrite is fine).

### `advanceAnnouncement.ts` — rotation auto-batch

In the existing "rotate to next user" branch (`isLastForAnnouncer && !batch_reveal_mode`), after the cascade lands on `nextAnnouncingUserId` and BEFORE the conditional room UPDATE:

If `style === 'short'` AND `nextAnnouncingUserId !== null`:

1. Load the next announcer's results rows.
2. Compute auto-batch via `selectShortBatchRows` and `twelvePointIdx`.
3. Mark all auto-batch rows `announced = true` (single UPDATE).
4. Set `nextIdx = twelvePointIdx(rows)` instead of `0`.
5. Capture the batch-revealed contestant payload (for broadcast after room UPDATE).

After the room UPDATE commits, in addition to the existing `announce_next` + `score_update` broadcasts for the just-revealed 12-point row, fire `score_batch_revealed` for the rotation auto-batch.

**Ordering of broadcasts:**
1. `announce_skip` for cascaded users (existing)
2. `announce_next` for the current user's 12-point row that just revealed (existing)
3. `score_update` for that 12-point row (existing)
4. `score_batch_revealed` for the next user's auto-batch (NEW, short-style only)

### Batch reveal under short style

Per SPEC §10.2.2 line 1019: when `batch_reveal_mode = true` AND `style = 'short'`, **one admin tap reveals BOTH the auto-batch AND the 12-point row for the current user**, then rotates.

Implementation: in `advanceAnnouncement.ts`, when entering the `batch_reveal_mode` branch:
- If `style === 'short'` AND the current announcer still has un-announced rank-2-through-10 rows (auto-batch hasn't fired yet for this user), this advance call fires the auto-batch for the current user first, then reveals the 12-point row (the existing single-row reveal), then rotates.
- The "auto-batch already fired" case (e.g., user was the current announcer before batch mode engaged): proceed with the normal single-row reveal of the 12-point row.

Detection: count the current user's announced=false rows. If there are 10, no auto-batch fired yet. If there's 1 (just the 12-point), auto-batch already fired.

A single response payload covers both reveals; broadcasts fire in order (auto-batch then 12-point).

### Cascade exhaust under short style

Same as full style — `cascadeExhausted = true`, `nextAnnouncingUserId = null`, no batch fires for a null user. The "Finish the show" CTA path remains the same and is handled by the existing `finishTheShow.ts` (toggles `batch_reveal_mode = true`; subsequent advance calls hit the batch-reveal branch above).

## Authorization unchanged

`advanceAnnouncement` already checks announcer / delegate / owner. No change for short style.

## Test plan

- **`autoBatchShortStyle.test.ts`** (new): pure-helper tests — full 10-row queue → 9 batch rows + 12-point idx; short queue (< 10 rows) → batches everything except rank 1; degenerate queue with no rank-1 row → empty batch + null idx.
- **`runScoring.test.ts`** — new cases:
  - `live` + `short` + first announcer present → 9 rows marked announced=true on that user; `current_announce_idx` set to 12-point idx; `score_batch_revealed` broadcast fired with 9 contestants
  - `live` + `short` + all absent (cascade exhausts) → no auto-batch fires (no announcer)
  - `live` + `full` (control) → existing behaviour unchanged (no batch fires)
  - `instant` + `short` → `style` is ignored per spec; no auto-batch fires
- **`advanceAnnouncement.test.ts`** — new cases:
  - `short` + rotation to present user → next user's 9 rows marked announced; `nextIdx` = 12-point row; `score_batch_revealed` broadcast fires
  - `short` + rotation with cascade → cascade skips absent users; auto-batch fires for the first present one
  - `short` + cascade exhausts → no batch fires, `cascadeExhausted: true`
  - `short` + batch-reveal-mode + current user has un-announced auto-batch → single advance call marks 10 rows announced, broadcasts auto-batch + 12-point, rotates
  - `short` + batch-reveal-mode + current user already has auto-batch done (1 row pending) → single advance reveals only 12-point, rotates
  - `full` (control) → existing behaviour unchanged

## Out of scope for PR A

- Wizard sub-radio, lobby-edit sub-radio (PR C)
- Announcer "Reveal 12 points" CTA (PR B)
- Present TV splash, guest toast, present overlay (PR B)
- Host-facing copy: tooltip, lobby info card, overlay banner (PR C)
- Locale keys (none in PR A — UI ships with strings in PR B/C)
- E2E Playwright spec (deferred — orchestrator tests are sufficient; a smoke can land in PR B/C)

## Rollout

1. Merge PR A.
2. Operator runs `supabase/migrations/2026-05-11-add-announcement-style.sql` in the Supabase SQL Editor (1 ALTER TABLE).
3. (Optional) Operator UPDATEs an existing test room to `announcement_style = 'short'` and exercises a turn to QA the server before PR B exposes the UI.
4. PR B + PR C proceed.

Backwards compatibility: `DEFAULT 'full'` means every existing room and every newly-created room behaves identically until PR C lands and the admin opts in.

## Risk

The risky path is the orchestrator double-fire. Two failure modes guarded:
- Auto-batch fires twice on the same user (e.g., partial commit / retry): row UPDATEs are idempotent (`announced = true` → `announced = true`). `current_announce_idx` overwrite to the same value is a no-op.
- Auto-batch fires under wrong style (e.g., a `full`-mode room): guarded by the `style === 'short'` check at every call site. No fallback.

Mitigation: every new code path has at least one unit test for its happy path AND one for the "style is full, do nothing" control.
