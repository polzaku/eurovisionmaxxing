# Phase 5a — Results read-path

**Date:** 2026-04-21
**SPEC refs:** §10 (reveal flow context), §12.1 / §12.2 / §12.5 (shareable results, text summary, pre-`done` placeholders)
**TODO refs:** Phase 5 items "GET /api/rooms/{id}/results", "GET /api/results/{id}", "/results/[id]". Phase R5 items "§12.5 placeholders", "2-s polling during scoring", "partial live leaderboard", "§12.2 `formatRoomSummary`", "Copy text summary button on results page".

## 1. Goal

Ship the public-facing read path for a room's results so share links work as soon as voting ends, without touching the announce state machine.

## 2. Scope

**In:**
1. `src/lib/results/loadResults.ts` — deps-injected orchestrator returning a discriminated union keyed by `rooms.status`.
2. `src/lib/results/formatRoomSummary.ts` — pure function rendering the §12.2 emoji text block.
3. `GET /api/results/{id}` — public route adapter (no auth).
4. `GET /api/rooms/{id}/results` — route adapter; shares the same loader (kept as a separate path so future in-room views can diverge — e.g. announcer-specific data — without breaking the public share URL).
5. `src/app/results/[id]/page.tsx` — server component that calls `loadResults` directly (no round-trip via fetch) and renders all five §12.5 states.
6. Client child components:
   - `<ScoringPoller />` — polls `/api/results/{id}` every 2 s while `status === 'scoring'`, calls `router.refresh()` when the server's status changes.
   - `<CopySummaryButton />` — clipboard write + 2-s "Copied!" confirmation, shown only when `status === 'done'`.
7. Locale keys under `results.*` in `en.json` (English-only — non-`en` locales stay `{}` per Phase 1.5 deep-merge fallback).

**Out (deferred):**
- Awards rendering — Phase 6; `room_awards` table will be empty. Results page simply omits the section when the array is empty.
- Bets section — `rooms.bets_enabled` column doesn't exist yet (R0 migration). `formatRoomSummary` accepts an optional `bets` arg but callers in this phase never supply it.
- HTML / PDF export endpoints — Phase R5.
- "Copy text summary" button on the awards screen — Phase 6.
- Polling during `announcing` — the state machine that progresses announcements is Phase 5b; this phase shows a static snapshot (refreshes on user pull-to-refresh).

## 3. Response contract

`loadResults` returns one of five discriminated shapes. Both route adapters return the same JSON bodies.

```ts
type LoadResultsData =
  | { status: "lobby"; pin: string; broadcastStartUtc: string | null }
  | { status: "voting" | "voting_ending"; pin: string }
  | { status: "scoring" }
  | {
      status: "announcing";
      year: number;
      event: EventType;
      pin: string;
      leaderboard: LeaderboardEntry[]; // SUM of points_awarded where announced=true
    }
  | {
      status: "done";
      year: number;
      event: EventType;
      pin: string;
      leaderboard: LeaderboardEntry[]; // SUM over all results rows
      contestants: Contestant[];
      breakdowns: UserBreakdown[];
      hotTakes: HotTakeEntry[];
      awards: RoomAward[]; // empty until Phase 6
    };

interface LeaderboardEntry {
  contestantId: string;
  totalPoints: number;
  rank: number; // 1-indexed, dense ranking (ties share rank)
}

interface UserBreakdown {
  userId: string;
  displayName: string;
  avatarSeed: string;
  picks: Array<{ contestantId: string; pointsAwarded: number }>; // sorted desc, top 10 excluded
}

interface HotTakeEntry {
  userId: string;
  displayName: string;
  avatarSeed: string;
  contestantId: string;
  hotTake: string;
}
```

HTTP codes:
- `200` — success, shape per `status`.
- `400 INVALID_ROOM_ID` — non-UUID path param.
- `404 ROOM_NOT_FOUND` — unknown room.
- `500 INTERNAL_ERROR` — DB failure; `ContestDataError` during `done` contestant load.

`voting_ending` is included in the union for forward-compat with the R0 migration; current schema's CHECK constraint means it never appears in practice, and both the API and page treat it identically to `voting`.

## 4. Response construction details

**All states:** SELECT `rooms` by id, validate UUID, 404 on miss.

**`lobby`:** read `broadcastStartUtc` from the contestants JSON (`data/contestants/{year}/{event}.json`); missing → `null`. The contestant data layer exposes this via an extended `fetchContestantsMeta(year, event)` helper (new — tiny wrapper that reads the same file and returns `{ broadcastStartUtc }`; keeps `fetchContestants` unchanged).

**`voting` / `voting_ending`:** no extra data; the `pin` lets the page deep-link "Join this room" to `/join?pin=…`.

**`scoring`:** no data. Page polls.

**`announcing`:**
1. SELECT `results` where `room_id = :id AND announced = true`.
2. Group by `contestant_id`, SUM `points_awarded`.
3. Rank descending; tie-break deterministically by `contestant_id` asc.
4. Include `room.year`, `room.event`, `room.pin`. Contestants list NOT included (names resolved client-side by `contestantId` lookup against a cached `fetchContestants` on the page — same helper already used in `getRoom`). Actually simpler: include the full `contestants` array in the payload so the page has no extra fetch. Decision: **include `contestants` in both `announcing` and `done`.**

**`done`:**
1. Same leaderboard SUM but across all rows (ignore `announced` flag — once the room is `done` all points are public).
2. `contestants` via `fetchContestants(room.year, room.event)`.
3. `breakdowns`: SELECT `results` + join `users` (`display_name`, `avatar_seed`). For each user, emit their `points_awarded > 0` picks sorted desc. Rows with `points_awarded = 0` (rank 11+) are dropped from the breakdown to keep it compact — matches the SPEC §10 reveal semantics (only ranks 1–10 receive points).
4. `hotTakes`: SELECT `votes` where `room_id = :id AND hot_take IS NOT NULL AND hot_take <> ''` + join `users`.
5. `awards`: SELECT `room_awards` where `room_id = :id` (empty until Phase 6).

Memberships are only loaded when needed (breakdowns / hot takes share the user join); this keeps `lobby` / `voting` / `scoring` cheap.

## 5. `formatRoomSummary`

```ts
export interface RoomSummaryInput {
  year: number;
  event: EventType;
  leaderboard: LeaderboardEntry[];
  contestants: Contestant[];
  shareUrl: string;
  labels: {
    eventTitle: (year: number, event: EventType) => string; // "Eurovision 2026 — Grand Final"
    topLine: string;                                        // "Our room's top 10:"
    fullResults: string;                                    // "Full results"
  };
  // Deferred — when Phase R7 bets land, caller supplies this and the fn emits the bets block.
  bets?: {
    headerLine: string; // e.g. "Bet results (2 / 3 won):"
    rows: Array<{ symbol: "✅" | "❌" | "⚪"; question: string }>;
  };
}

export function formatRoomSummary(input: RoomSummaryInput): string;
```

Behaviour — pure, no side effects:
- First line: `🇪🇺 {labels.eventTitle(year, event)}`.
- Second line: `{labels.topLine}`.
- Top 10 rows (or fewer if leaderboard is shorter). Format:
  - Ranks 1/2/3 → `🥇 `, `🥈 `, `🥉 `.
  - Ranks 4–10 → `{rank}  ` (two-digit aligned: `4 `, `5 `, … `10`).
  - Followed by `{flagEmoji} {country} — {totalPoints} pts`.
- If `bets` present: blank line, header line, rows as `{symbol} {question}`.
- Final line: `{labels.fullResults}: {shareUrl}`.

Country names resolved from the `contestants` list by `contestantId`. If a `contestantId` in the leaderboard has no matching contestant (shouldn't happen in practice), render `?` for the flag and the raw id in place of the country — defensive against missing data, but never throws.

Tests pin the exact formatting against a fixture mirroring the SPEC §12.2 example.

## 6. Page structure (`/results/[id]/page.tsx`)

Server component at the top. Calls `loadResults(params.id, { supabase: createServiceClient(), fetchContestants, fetchContestantsMeta })` directly. Branches on `data.status`:

| `status` | Render |
|---|---|
| `lobby` | Large placeholder copy, countdown clock to `broadcastStartUtc` if set. |
| `voting` / `voting_ending` | Placeholder + "Join this room" deep-link `(/join?pin=${pin})`. |
| `scoring` | `animate-shimmer` hero block, "Tallying results…" label, mounts `<ScoringPoller interval={2000} />`. |
| `announcing` | "Live — announcements in progress" banner, leaderboard list (flag + country + total). Per-user/award/hot-takes hidden. No copy-summary button yet. |
| `done` | Full layout: leaderboard, breakdowns (collapsible cards per user), hot takes list (grouped by country), awards (empty for now), `<CopySummaryButton>`. |

All five states share a common header (wordmark + "Results" subtitle). The §3.3 `prefers-reduced-motion` gate is respected by using Tailwind `motion-safe:animate-*` classes.

`/results/[id]` NEVER 404s: an unknown room still renders a friendly "Room not found" card (the loader's 404 branch maps to a neutral page state, not a Next.js 404) — matches §12.5's "the page must not 404".

## 7. Locale keys (English only, Phase 1.5 deep-merge handles the rest)

New `results.*` namespace in `en.json`:
- `results.title` — "Results"
- `results.placeholders.lobby` — "This room hasn't started voting yet. Check back after the show."
- `results.placeholders.lobbyCountdown` — "Show starts in {countdown}"
- `results.placeholders.voting` — "Voting is still in progress. Results will be available once the admin ends voting."
- `results.placeholders.votingCta` — "Join this room"
- `results.placeholders.scoring` — "Tallying results…"
- `results.placeholders.roomNotFound` — "We couldn't find that room. Double-check the link?"
- `results.announcing.banner` — "Live — announcements in progress"
- `results.headings.leaderboard` — "Leaderboard"
- `results.headings.breakdowns` — "Who gave what"
- `results.headings.hotTakes` — "Hot takes"
- `results.copySummary.idle` — "Copy text summary"
- `results.copySummary.done` — "Copied!"
- `results.eventTitle.final` — "Eurovision {year} — Grand Final"
- `results.eventTitle.semi1` — "Eurovision {year} — Semi-final 1"
- `results.eventTitle.semi2` — "Eurovision {year} — Semi-final 2"
- `results.summary.topLine` — "Our room's top 10:"
- `results.summary.fullResults` — "Full results"

New `errors.*` keys: `ROOM_NOT_FOUND`, `INVALID_ROOM_ID`. (Already emitted as `code` by auth routes; adding them here gives the results API toast a rendered string via `t('errors.' + code)`.)

## 8. Module layout

```
src/lib/results/
  loadResults.ts
  loadResults.test.ts
  formatRoomSummary.ts
  formatRoomSummary.test.ts

src/lib/contestants.ts              # add fetchContestantsMeta(year, event)
src/app/api/results/[id]/route.ts   # REPLACE 501 stub
src/app/api/rooms/[id]/results/route.ts  # REPLACE 501 stub
src/app/api/results/[id]/route.test.ts   # ADD
src/app/api/rooms/[id]/results/route.test.ts  # ADD

src/app/results/[id]/page.tsx               # REPLACE scaffold
src/app/results/[id]/ScoringPoller.tsx      # client component
src/app/results/[id]/CopySummaryButton.tsx  # client component

src/locales/en.json  # + results.* namespace
```

No schema changes. No new packages.

## 9. Test plan

**Unit (vitest):**

- `formatRoomSummary.test.ts` — exact-string snapshot of the §12.2 example, empty-bets variant, top-10 truncation for long lists, short-list (<10) no-truncation, missing-contestant fallback.
- `loadResults.test.ts` — each status branch; missing room → 404; invalid uuid → 400; `ContestDataError` during `done` → 500; `done` breakdowns exclude 0-point rows; `announcing` leaderboard filters `announced=true`.
- Route tests for both endpoints: success proxies data through; failure maps to `apiError`.

**Manual browser QA (see §10).**

## 10. Browser test cases (manual)

Run `npm run dev`. Reach a populated room via Supabase (a dev helper seed not in scope — re-use an existing room created by the dev flow or manually insert a row).

| # | Setup | URL | Expected |
|---|---|---|---|
| 1 | Room in `lobby` status, no `broadcastStartUtc` in contestants JSON | `/results/{roomId}` | Placeholder card with "This room hasn't started voting yet." — no countdown, no crashes. |
| 2 | Room in `lobby`, `broadcastStartUtc` = 10 minutes in the future | `/results/{roomId}` | Placeholder + live countdown that ticks down each second. |
| 3 | Room in `voting` | `/results/{roomId}` | "Voting is still in progress." + "Join this room" button that deep-links to `/join?pin={pin}` (pin visible). |
| 4 | Room in `scoring` (trigger `POST /api/rooms/{id}/score` with a small fixture room) | `/results/{roomId}` | Shimmer hero + "Tallying results…". Network tab shows a `GET /api/results/{id}` hit every 2 s. Flipping `rooms.status` manually to `announcing` in Supabase causes the page to re-render within 2 s. |
| 5 | Room in `announcing`, **no** `results.announced = true` rows yet | `/results/{roomId}` | "Live — announcements in progress" banner + leaderboard showing every contestant at 0 pts (no crash on empty totals). |
| 6 | Room in `announcing`, manually SET one result row `announced = true` | `/results/{roomId}` | Leaderboard shows that contestant's total. No breakdowns, no hot takes, no awards. |
| 7 | Room in `done` | `/results/{roomId}` | Full leaderboard + per-user breakdowns (collapsed/expanded OK) + hot takes grouped by country + copy-summary button visible. Awards section absent (empty). |
| 8 | Same `done` room | Click "Copy text summary" | Button → "Copied!" for 2 s. Paste into a text editor shows the §12.2 format: emoji flags, medal emojis for top 3, share URL at the bottom. |
| 9 | Unknown room id | `/results/00000000-0000-4000-8000-000000000000` | Friendly "We couldn't find that room." card — not a Next.js 404 page. |
| 10 | Non-UUID path | `/results/abc` | Same "Room not found" friendly page (the loader 400s internally; page treats both as "no data"). |
| 11 | `done` room, `prefers-reduced-motion: reduce` | `/results/{roomId}` | No shimmer / fade-in animations; layout identical. |
| 12 | `announcing` room, share URL in browser tab — tab title | `/results/{roomId}` | Document title contains the room PIN for recognisability (`Results – <PIN>`). |

Cases 1/2/5/7/8/9/10/11/12 are mandatory before merge. 3/4/6 require minor Supabase manipulation and are nice-to-have.

## 11. Risks & non-goals

- **Concurrent data drift during `announcing`:** the partial leaderboard is a single snapshot — a human-timeline race with `announce_next` could briefly show stale totals. Mitigation: none in 5a; 5b introduces realtime subscription. The 2-s poll is intentionally NOT used during `announcing` (would spam `/api/`) — users pull-to-refresh or rely on 5b's realtime once it lands.
- **Awards/bets empty in `done` until Phase 6 / R7:** renderer collapses empty sections gracefully. No placeholder copy is shown for absent sections (no "Awards are coming soon" — just omit the block).
- **Locale coverage:** only `en.json` populated. Non-`en` locales fall back via Phase 1.5's deep-merge path. No translation work in this phase.
- **No server-rendered flash-of-incorrect-status:** the page is SSR-rendered with the loaded data. `<ScoringPoller />` only mounts when initial status was `scoring`.
