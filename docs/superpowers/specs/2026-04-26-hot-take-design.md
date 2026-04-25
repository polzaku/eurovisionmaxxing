# Hot-take field — design

**Date:** 2026-04-26
**Spec sections:** SPEC §8.7 (hot takes), §8.5 (autosave), §13 (`votes.hot_take` column)
**Phase:** 3 — Voting

---

## 1. Goal

Let a guest write a 140-char emoji-aware hot-take per contestant, autosaved through the existing offline-resilient pipeline. Backend already accepts `hotTake` on `POST /api/rooms/{id}/votes`. The work is entirely client-side: a pure char-counting helper, an additive Autosaver method, and a `<HotTakeField>` component that toggles between a pill and an inline textarea + counter.

## 2. Non-goals (deferred to Phase R3)

- §8.7.1 *"edited"* tag — needs `votes.hot_take_edited_at` column from Phase R0 schema migration. Not yet applied.
- §8.7.2 author-delete UI affordance (trash icon + confirmation modal). Out of scope. **Clearing the textarea contents to empty is the MVP delete path** — autosave sends `hotTake: null` and the row's `hot_take` column goes back to NULL.
- §8.7.2 admin-delete from results screen / hot-takes drawer — needs `hot_take_deleted_*` columns + new endpoint.
- Showing hot-takes on the announce / results screens — those screens consume `votes.hot_take` directly when they're built; this design only writes the value.

## 3. Architecture

Mirrors the "I missed this" three-layer split:

- **Local state (React).** `VotingView` adds `hotTakesByContestant: Record<string, string>` — sparse map, only contestants with a non-empty hot-take populated. Seeded from `seedHotTakesFromVotes(votes, contestantIds)` at mount.
- **Autosave path.** `Autosaver.scheduleHotTake(contestantId, hotTake)` — additive method that shares the per-contestant 500ms debounce and merges with any pending scores / missed flag into a single `POST /votes` payload. `useVoteAutosave.onHotTakeChange` is the hook-level pass-through. Empty input maps to `hotTake: null` at the call site so the DB column goes back to NULL.
- **UI.** A single `<HotTakeField>` component owns its pill ↔ input state. Props: `{ value: string, onChange: (next: string) => void, maxChars?: number }`. Internal state: `isExpanded: boolean`. Visible when `value !== "" || isExpanded`.
- **Pure helper.** `countHotTakeChars(text)` — `Intl.Segmenter` grapheme split + `\p{Extended_Pictographic}` regex per grapheme. Emoji = 2, else = 1.

## 4. Two-PR split

### PR1 — Pure helpers + Autosaver extension

**New file:** `src/lib/voting/countHotTakeChars.ts`

```ts
export function countHotTakeChars(text: string): number;
```

Algorithm:
- Empty string → 0.
- Construct `new Intl.Segmenter(undefined, { granularity: 'grapheme' })`.
- For each grapheme: if `/\p{Extended_Pictographic}/u.test(grapheme)` → add 2; else add 1.

Tested cases:
- Empty → 0.
- ASCII `"hello"` → 5.
- Single emoji `"👋"` → 2.
- ZWJ family `"👨‍👩‍👧‍👦"` → 2 (single grapheme).
- Flag `"🇺🇦"` → 2 (regional-indicator pair = single grapheme).
- Mixed `"hi 👋"` → 5 (`h` + `i` + space + emoji×2).
- Whitespace at boundaries → counted normally.

**New file:** `src/lib/voting/seedHotTakesFromVotes.ts`

```ts
import type { VoteView } from "@/lib/rooms/get";

export function seedHotTakesFromVotes(
  votes: readonly VoteView[],
  contestantIds: readonly string[]
): Record<string, string>;
```

Mirrors `seedMissedFromVotes`. Only contestants with `hotTake !== null && hotTake !== ""` populated. Filters out unknown contestant ids.

Tested cases:
- Empty votes → `{}`.
- Mixed (some hot-takes, some null, some empty) → only non-empty included.
- Stale contestant id → filtered out.

**Modified:** `src/lib/voting/Autosaver.ts`

`PendingEntry` shape becomes:
```ts
interface PendingEntry {
  timerId: ReturnType<typeof globalThis.setTimeout>;
  scores: Record<string, number | null>;
  missed?: boolean;
  hotTake?: string | null;
}
```

New method:
```ts
scheduleHotTake(contestantId: string, hotTake: string | null): void
```

- Identical structure to `scheduleMissed`: clears any pending timer for that contestant, merges with existing pending `scores` / `missed`, re-arms the 500ms timer, sets `hotTake` on the pending entry.
- `flushContestant` includes `hotTake` in the payload only when `entry.hotTake !== undefined` (so `null` is faithfully sent for clear, but the field is omitted from missed-only / score-only writes).

New tests:
- `scheduleHotTake` flushes hotTake-only payload after debounce.
- Coalesces with `schedule` + `scheduleMissed` for the same contestant into one POST.
- `null` is faithfully transmitted (`hotTake: null` in payload, not omitted).
- Last-write-wins for two `scheduleHotTake` calls in the same window.
- Different contestants produce independent posts.

**Modified:** `src/components/voting/useVoteAutosave.ts`

Adds:
```ts
onHotTakeChange: (contestantId: string, hotTake: string | null) => void;
```
to `UseVoteAutosaveResult`. Internally calls `saver.scheduleHotTake(contestantId, hotTake)`.

### PR2 — `<HotTakeField>` + VotingView wire-in

**New file:** `src/components/voting/HotTakeField.tsx`

Props:
```ts
interface HotTakeFieldProps {
  value: string;
  onChange: (next: string) => void;
  maxChars?: number;  // default 140
}
```

Render:
- **Pill state** (`value === "" && !isExpanded`): `<button>+ Add a hot take</button>`. Tap → `setIsExpanded(true)`.
- **Expanded state** (else): `<textarea>` with `placeholder="Your one-liner"`, `rows={2}`, `aria-label="Hot take"`. Counter `{count} / {maxChars}` below — `text-accent` when `count >= maxChars - 10`. **No `maxLength` HTML attribute** (it counts UTF-16 code units, not graphemes — would lie about emoji budget).

Behaviour:
- `handleChange` rejects keystrokes that push `countHotTakeChars(nextValue) > maxChars` (input visibly clamps).
- `handleBlur` collapses back to pill iff `value === ""` AND `!== focused`.
- Auto-focus the textarea only when transitioning pill → expanded (i.e., `isExpanded && value === ""`); not on rehydration of an already-saved hot-take.

**Modified:** `src/components/voting/VotingView.tsx`

- Add `hotTakesByContestant: Record<string, string>` state (sparse), seeded from new `initialHotTakes` prop.
- Add `onHotTakeChange?: (contestantId: string, hotTake: string | null) => void` prop.
- `setHotTake(contestantId, next: string)` — updates local state (deletes the key when `next === ""`), then calls `onHotTakeChange?.(contestantId, next === "" ? null : next)`.
- Renders `<HotTakeField value={hotTakesByContestant[contestant.id] ?? ""} onChange={(next) => setHotTake(contestant.id, next)} />` below the score rows / MissedCard. Visible regardless of missed state — users can still write a hot-take for a contestant they marked missed (matches §8.7's "optional per-contestant" framing).

**Modified:** `src/app/room/[id]/page.tsx`

- Compute `initialHotTakes = seedHotTakesFromVotes(phase.votes, phase.contestants.map(c => c.id))`.
- Pass `initialHotTakes` and `autosave.onHotTakeChange` to `<VotingView>`.

**Modified:** `src/locales/en.json`

```json
"voting": {
  "missed": { ... existing },
  "hotTake": {
    "addPill": "+ Add a hot take",
    "addPillAria": "Add a hot take",
    "fieldAria": "Hot take",
    "placeholder": "Your one-liner",
    "counter": "{count} / {max}"
  }
}
```

Component uses bare English strings (mirrors the rest of the voting surface). Locale keys land for Phase L L1 voting-surface extraction.

## 5. Edge cases

- **Type → tap blur immediately, before 500ms autosave.** The pending entry's `hotTake` is set. On flush at 500ms, sends the latest value. Standard debounce; same as scores.
- **Type, save, then clear.** First flush sends `hotTake: "some text"`. User empties input → `setHotTake(id, "")` → `onHotTakeChange(id, null)` → next flush sends `hotTake: null`. Server stores NULL. Two round-trips.
- **Reload with saved hot-take.** `seedHotTakesFromVotes` populates the map. `<HotTakeField>` mounts with `value !== ""`, so it renders expanded with the saved text — no auto-focus, no pill.
- **User pastes a 200-char string.** First `onChange` fires with the full pasted value; `countHotTakeChars(pasted) > 140` → reject, value stays at whatever it was. The textarea visibly snaps back to the prior value. (Standard React controlled-input behaviour: rejection by simply not calling `onChange` causes the DOM to reflect the stale `value` prop on next render.)
- **User pastes a 130-char + 11-emoji string** (would push over the limit): same — reject the whole paste. Acceptable for MVP; partial-paste handling is overkill.
- **Marked missed → write hot-take.** Both states coexist. `<MissedCard>` renders above; `<HotTakeField>` renders below. Both autosave through the same `Autosaver` flush.
- **Offline.** All writes go through the existing `OfflineAdapter` queue — hot-take edits are queued, drained, and conflict-checked exactly like score writes. No new offline-handling code.
- **Two devices, same userId.** Same caveat as missed flag (degenerate for MVP). The second device's hot-take only refreshes when the room re-fetches.
- **Adding `hotTake` to the autosave payload triggers the existing conflict-check?** Yes — the Autosaver hands the payload to `OfflineAdapter` which performs the `(roomId, userId, contestantId)`-keyed reconciliation. A hot-take edit while offline that conflicts with a server-newer write is reported on the consolidated drain toast (§8.5.1).

## 6. Out-of-scope follow-ons

- §8.7.1 *"edited"* tag — depends on Phase R0 `hot_take_edited_at` migration.
- §8.7.2 author-trash icon + confirmation modal — depends on the same migration + the new `DELETE /api/rooms/{id}/votes/{contestantId}/hot-take` endpoint (Phase R3).
- §8.7.2 admin-delete from results / hot-takes drawer — Phase R3.
- Hot-take rendering on results / announce screens — those screens are separate Phase 5/6 work.

## 7. Verification checklist

- `npm run test` — all green, including new tests for `countHotTakeChars`, `seedHotTakesFromVotes`, and `Autosaver.scheduleHotTake`.
- `npm run type-check` — clean.
- `npm run lint` — clean (only pre-existing `useRoomRealtime` warning).
- Manual smoke in `npm run dev`:
  1. Tap pill → input expands and focuses; type some chars; counter increments; type emoji; counter jumps by 2.
  2. Type 140 chars total; further keystrokes are rejected.
  3. Within 10 of limit, counter turns hot-pink.
  4. Tap away from empty pill → returns to pill (no autosave).
  5. Type → wait 500ms → Saved chip; reload page → hot-take rehydrated.
  6. Clear input → 500ms → Saved; reload → pill returns (DB row's `hot_take` is NULL).
  7. Mark contestant missed: missed card renders + hot-take field still present below.
  8. Network tab: `POST /votes` payloads carry `hotTake` correctly (`null` on clear, string otherwise).
