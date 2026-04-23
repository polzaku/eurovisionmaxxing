# Phase 5a — Results read-path implementation plan

Spec: [`docs/superpowers/specs/2026-04-21-phase-5a-results-read-path-design.md`](../specs/2026-04-21-phase-5a-results-read-path-design.md)

TDD: failing test → verify failure reason → make it pass. Incremental commits; `npm run type-check` + `npm test` green before each commit.

## Step 1 — Pure fn `formatRoomSummary`

Tests first (`src/lib/results/formatRoomSummary.test.ts`):
- Exact-string match vs §12.2 fixture (10-row leaderboard, no bets).
- Short list (3 contestants) — no truncation, no extra rows.
- 12-row leaderboard truncates to 10.
- `bets` block renders when supplied; absent when not.
- Unknown `contestantId` falls back to `?` flag + raw id.

Impl (`src/lib/results/formatRoomSummary.ts`): pure string concatenation. No IO.

## Step 2 — `fetchContestantsMeta` helper

Tiny addition to `src/lib/contestants.ts` — new exported fn `fetchContestantsMeta(year, event) → { broadcastStartUtc: string | null }` that reads the same JSON file and returns only the top-level meta fields. Tests alongside existing `contestants.test.ts`:
- Reads `broadcastStartUtc` when present in the JSON.
- Returns `null` when the file has no `broadcastStartUtc` (e.g. bare-array format of 2025 data).
- Propagates `ContestDataError` for missing files.

Note: existing `data/contestants/{year}/{event}.json` files are bare arrays. The helper tolerates both formats: `Array<T>` (old) → meta is `null`, `{ broadcastStartUtc, contestants: [...] }` (new) → meta read out. `fetchContestants` itself needs a tiny tweak to accept both shapes OR the helper can parse independently. **Decision:** keep `fetchContestants` untouched by normalising at parse time inside the new helper — it re-reads the file.

## Step 3 — `loadResults` orchestrator

Tests (`src/lib/results/loadResults.test.ts`). Cases per §9 of the spec.

Impl (`src/lib/results/loadResults.ts`):
- Input validation (`roomId` UUID).
- Supabase SELECT `rooms` by id → 404 on miss.
- Switch on `rooms.status`:
  - `lobby` → call `fetchContestantsMeta` → return `{ status: 'lobby', pin, broadcastStartUtc }`.
  - `voting` / `voting_ending` → return `{ status: 'voting' | 'voting_ending', pin }`.
  - `scoring` → return `{ status: 'scoring' }`.
  - `announcing` → SELECT `results` where `announced = true` → group+rank → return `{ status, year, event, pin, leaderboard, contestants }`.
  - `done` → SELECT `results` (all) + SELECT with user join for breakdowns + SELECT `votes` for hot takes + SELECT `room_awards` → assemble → return.

Deps shape:
```ts
interface LoadResultsDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (year, event) => Promise<Contestant[]>;
  fetchContestantsMeta: (year, event) => Promise<{ broadcastStartUtc: string | null }>;
}
```

Return type is the discriminated union from the spec; failures mirror `{ ok: true, data } | { ok: false, status, error: { code, message, field? } }`.

## Step 4 — Route adapters

Replace the two 501 stubs:
- `src/app/api/results/[id]/route.ts`
- `src/app/api/rooms/[id]/results/route.ts`

Both adapters call the same `loadResults(params.id, deps)` with `createServiceClient()`, `fetchContestants`, `fetchContestantsMeta`. Success → 200 JSON body (spread the discriminated shape). Failure → `apiError(code, message, status, field)`.

Adapter tests (`route.test.ts`) mock the loader; confirm param-forwarding + body-passthrough + failure mapping.

## Step 5 — Page + client components

`src/app/results/[id]/page.tsx` — server component:
- Guard: reject non-UUID params with the "room-not-found" card (no 404).
- Call `loadResults` directly (not via HTTP).
- Render the state-specific tree.
- `await getTranslations({ namespace: 'results' })` for strings.
- `<title>` uses PIN for `done` / `announcing`, generic "Results" otherwise.

`src/app/results/[id]/ScoringPoller.tsx` — client component:
- `useEffect` setInterval 2000ms → `fetch('/api/results/' + id)` → if the returned `status !== 'scoring'`, call `router.refresh()` and clear interval.

`src/app/results/[id]/CopySummaryButton.tsx` — client component:
- Receives the preformatted summary string as a prop.
- On click: `await navigator.clipboard.writeText(...)`, toggle label to "Copied!" for 2 s.

## Step 6 — Locale keys

Edit `src/locales/en.json`:
- Add `results.*` namespace per §7 of the spec.
- Extend `errors.*` with `ROOM_NOT_FOUND` and `INVALID_ROOM_ID`.

`locales.test.ts` key-completeness already validates the file structure; extending `en.json` is additive.

## Step 7 — Verification

- `npm run pre-push` → 0 type errors, all tests green.
- Manual browser smoke for the mandatory cases listed in the spec §10.
- Tick TODO Phase 5 items.

## Out of scope / explicit non-goals (redundant with spec §2 but restated here for plan reviewers)

- No announce state machine (5b).
- No export endpoints (R5).
- No bets data path (R7).
- No awards rendering (Phase 6).
- No test runner changes.
