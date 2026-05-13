## R5 §12.3 — Standalone HTML export — design

**Date:** 2026-05-13
**TODO refs:** [TODO.md:280](../../../TODO.md#L280) (R5 §12.3 — `GET /api/results/{id}/export.html`), [TODO.md:393](../../../TODO.md#L393) (S4 payload extension — partial — folded in)
**SPEC refs:** §12.3 (HTML export), §12.6.1 / §12.6.2 / §12.6.3 (drill-downs inline), §12.6.4 (export implementation notes)
**Slice:** First V1.1 shipper after the 2026-05-14 MVP cut. Ships the HTML export endpoint plus the `loadResults` payload extension that unlocks SPEC §12.6 drill-downs inline. The drill-down *UI* on `/results/[id]` (modals/sheets) remains a separate slice; this slice ships the data + the static rendering only.

## Problem

A Eurovision watch party is a one-night artifact. Once the show ends, the room sits at `done` on `/results/[id]` — viewable in-app, but not naturally shareable. Users want to chat-paste, email, archive, or print the result. The existing `formatRoomSummary` ([formatRoomSummary.ts](../../../src/lib/results/formatRoomSummary.ts)) covers the 200-character chat-paste case. The richer "here's our scorecard, everything inline" artifact is unmet.

SPEC §12.3 specifies this artifact as a single self-contained HTML file: no JS, no external assets, all CSS inlined, ≤300 KB. §12.6.4 adds that the file embeds the SPEC §12.6 drill-downs (contestant, participant, category) inline — since the static artifact has no interactivity, every "tap to expand" becomes a flattened section.

## Goals

- `GET /api/results/{id}/export.html` returns a self-contained HTML document when `rooms.status = 'done'`.
- 409 `{ code: "results_not_ready" }` for any earlier status.
- Filename `emx-{year}-{event}-{pin}.html` via `Content-Disposition: attachment`.
- All content inlined: leaderboard, per-user breakdowns, awards, hot takes, drill-downs (§12.6.1 + §12.6.2 + §12.6.3 expanded inline), bet results when `bets_enabled` (V2 forward-compat; suppressed today).
- Print-first minimalist aesthetic (system fonts, black-on-white + gold accent, tabular leaderboard) per Q2 of brainstorming.
- Locale resolves from `NEXT_LOCALE` cookie; falls back to `en`. Same source as `/results/[id]`.
- Fits in 300 KB for the canonical 15-user / 26-contestant Grand Final fixture; enforced by a CI test, not a runtime 409.
- Drill-downs expanded inline as `<details>` blocks (collapsed by default in-browser, fully rendered in static text).

## Non-goals

- **Drill-down UI on `/results/[id]`.** SPEC §12.6.1/§12.6.2/§12.6.3 also specify *interactive* modals/sheets on the live page. Those remain a separate slice. This slice ships the *data* (payload extension) and the *static* rendering (HTML export); the interactive modals come later. Country drill-down stage 1 (`<details>` expansion under each leaderboard row on `/results/[id]`) already shipped in `feat/u-country-drill-down`; that surface stays as-is.
- **PDF export (§12.4).** Same data path, different renderer (`@react-pdf/renderer`). Separate slice.
- **Bets section (R7 / V2).** Renderer suppresses the section when `rooms.bets_enabled === false`. Forward-compat path is documented in §22.6 of SPEC but not wired here.
- **Live-locale translations beyond `en`.** New `export.*` keys land in `en.json` only. Phase L L3 follow-on covers `es/uk/fr/de` translation via the established workflow (same as every other namespace).
- **Bundle-size enforcement at runtime.** A vitest fixture asserts ≤300 KB at build time. Runtime emits `X-Content-Bytes` for observability but never 409s on size.
- **Caching beyond `Cache-Control` + `ETag`.** No CDN-specific configuration. Vercel's edge cache picks up the standard headers automatically.
- **Avatar regeneration / new visual style.** Reuses existing `@dicebear` library inlined server-side.

## Architecture

Four new modules plus one extension to `loadResults`.

```
src/lib/results/loadResults.ts                  [extend: add voteDetails to `done` payload]
src/lib/export/buildResultsHtml.ts              [new: pure renderer]
src/lib/export/dicebearInline.ts                [new: server-side SVG memoization]
src/lib/export/exportStylesheet.ts              [new: CSS constant]
src/app/api/results/[id]/export.html/route.ts   [new: route adapter]
src/locales/en.json                             [extend: export.* namespace]
```

### 1. `loadResults` extension

Add one field to the `done` payload shape:

```ts
voteDetails: Array<{
  userId: string;
  contestantId: string;
  scores: Record<string, number>;   // raw per-category 1-10 scores
  missed: boolean;
  pointsAwarded: number;            // joined from `results` for the (user, contestant) pair; 0 for ranks 11+
  hotTake: string | null;
  hotTakeEditedAt: string | null;
}>;
```

Sourced from a left-join between the existing `voteRows` (`votes` SELECT — already running for `buildPersonalNeighbours`) and `resultRows` (`results` SELECT — already running for the leaderboard). Zero new database round-trips. Gated to the `done` branch only — §12.5 `announcing` payloads must not leak per-category breakdowns (SPEC §12.6.4 explicitly forbids).

Weighted score is re-derived in `buildResultsHtml` via the existing `computeWeightedScore` ([scoring.ts](../../../src/lib/scoring.ts)) consuming `scores` + the room's `categories`. `pointsAwarded` is plumbed directly to keep the renderer free of scoring-engine knowledge.

### 2. `buildResultsHtml(data, deps): { html, filename, bytes }`

Pure function. Inputs:

- `data: Extract<ResultsData, { status: "done" }>` — the loaded payload.
- `deps.t: (key: string, params?: Record<string, unknown>) => string` — locale-resolved translator (caller passes a server-side `getTranslations` instance scoped to the `export.*` namespace).
- `deps.now: () => Date` — injected for deterministic timestamp in tests.
- `deps.appHostname: string` — for the footer "Generated at ... from <hostname>/results/{id}" string. Read from `process.env.NEXT_PUBLIC_APP_HOSTNAME` with a default of `eurovisionmaxxing.com`.

Output:

- `html: string` — full document starting with `<!DOCTYPE html>`.
- `filename: string` — `emx-{year}-{event}-{pin}.html`, sanitised for `Content-Disposition` (no quotes, no slashes).
- `bytes: number` — `Buffer.byteLength(html, 'utf8')`; used by the route to set `X-Content-Bytes` and `Content-Length`.

Document structure:

```
<!DOCTYPE html>
<html lang="{locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{t('export.title', { year, event, pin })}</title>
    <style>{minified CSS from exportStylesheet.ts}</style>
  </head>
  <body>
    <header>                       <!-- room title, PIN, generated-at -->
    <main>
      <section class="leaderboard">  <!-- 26 rows, 12 / 10 / 8 / ... / 0 -->
        <table>
          <thead> ... </thead>
          <tbody>
            <tr>
              <td>1</td><td>🇸🇪 Sweden</td><td>Song · Artist</td><td>142 pts</td>
            </tr>
            ...
            <tr><td colspan="4"><details><summary>{t('export.contestantDrillDown.heading')}</summary>
              <!-- §12.6.1 inline: 15 user rows for this contestant -->
              <table>...</table>
            </details></td></tr>
            ...
          </tbody>
        </table>
      </section>

      <section class="awards">
        <!-- one block per award: category awards, then personality awards -->
        <article class="award">
          <h3>Best Vocals — 🇸🇪 Sweden</h3>
          <details><summary>{t('export.categoryDrillDown.heading')}</summary>
            <!-- §12.6.3 inline: every contestant ranked by Vocals mean -->
            <table>...</table>
          </details>
        </article>
        ...
      </section>

      <section class="breakdowns">
        <!-- one block per user, sorted by displayName -->
        <article class="breakdown">
          <h3>{avatar svg} Alice's 12 points went to 🇸🇪 Sweden</h3>
          <ol class="picks">
            <li>12 — 🇸🇪 Sweden</li>
            ...
          </ol>
          <details><summary>{t('export.participantDrillDown.heading')}</summary>
            <!-- §12.6.2 inline: every contestant Alice voted on -->
            <table>...</table>
          </details>
        </article>
      </section>

      <section class="hot-takes">
        <!-- non-empty hot takes, sorted by user then contestant -->
      </section>

      <!-- bets section omitted entirely while bets_enabled === false -->
    </main>
    <footer>{t('export.footer', { generatedAt, hostname, roomId })}</footer>
  </body>
</html>
```

Rendering details:

- All strings HTML-escaped through a small `escapeHtml` helper (covers `&<>"'`). Hot-takes are user-generated content — must escape; no markdown, no inline HTML allowed.
- `<details>` collapsed by default in-browser; fully rendered in raw HTML for grep / archive scenarios.
- Per-category score chips render as inline `<span>` with class `chip`. Missed entries use class `chip chip--missed` (CSS dims + adds `~` prefix per §8.4 convention).
- Tied awards render both winners; `winnerUserIdB` non-null → "Joint winners: Alice & Bob" with two avatars.
- Empty sections render as a single muted paragraph instead of being silently omitted (e.g. "No hot takes saved this round." reads better than a missing section).

### 3. `dicebearInline.ts`

Wraps `@dicebear/core` (already a dep) to render an `avatarSeed` to inline SVG string. Memoization cache keyed by seed lives in module scope — for a single render pass the cache is process-local and bounded by the room's member count (typ. <20 seeds). Server-side rendering returns plain SVG (no `<script>`, no `xmlns:xlink`, no fonts) — verified by snapshot test.

Style variant: `funEmoji` (matches the live app's choice — `src/lib/avatars.ts` resolves `https://api.dicebear.com/7.x/fun-emoji/svg?seed={seed}` via `<img>`). Background suppressed (transparent) for clean inlining inside `<h3>` headings.

### 4. `exportStylesheet.ts`

Single exported constant `EXPORT_STYLESHEET` — a hand-minified CSS string. Hosted in its own module so it can be unit-tested for size + parseability without bringing in a CSS toolchain.

Aesthetic (Q2 — print-first minimalist):

- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- Background `#fff`, body text `#1a1a1a`, muted `#666`, gold accent `#d4a017` (used only on the 12-pointer row + the "winner" badge on each award).
- Tabular leaderboard: 100% width, alternating row backgrounds `#fafafa` / `#fff`, `border-collapse: collapse`.
- `@media print` rule strips the gold accent (replaces with bold), tightens spacing, sets A4 margins, page-break-inside avoid on award cards.
- No CSS custom properties (older email clients choke on them), no flexbox-only layouts (use `table` for the leaderboard; flex for award cards is fine).

Target size: ≤4 KB minified. Asserted by a unit test.

### 5. Route adapter

`src/app/api/results/[id]/export.html/route.ts`:

```ts
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const result = await loadResults({ roomId: params.id }, { supabase, fetchContestants, fetchContestantsMeta });
  if (!result.ok) return apiError(result.error.code, result.error.message, result.status);
  if (result.data.status !== "done") return apiError("results_not_ready", "Results not ready.", 409);

  const t = await getTranslations({ locale: await resolveLocale(req), namespace: "export" });
  const { html, filename, bytes } = buildResultsHtml(result.data, { t, now: () => new Date(), appHostname: APP_HOSTNAME });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Bytes": String(bytes),
    },
  });
}
```

Errors:

- 400 `INVALID_ROOM_ID` — non-UUID `params.id`.
- 404 `ROOM_NOT_FOUND` — no such room.
- 409 `results_not_ready` — status is not `done`.
- 500 `INTERNAL_ERROR` — DB failure or contestant-fetch failure (same paths `loadResults` already covers).

### 6. Locale keys

New namespace `export.*` in `en.json`:

```json
{
  "export": {
    "title": "Eurovision {year} {event} — Room {pin}",
    "header": { "generatedAt": "Generated {timestamp}" },
    "leaderboard": { "heading": "Leaderboard", "rank": "#", "country": "Country", "song": "Song · Artist", "points": "Points", "pts": "{count, plural, one {# pt} other {# pts}}" },
    "contestantDrillDown": { "heading": "Who voted for {country}?", "weightedScore": "Weighted {value}", "missed": "Missed", "edited": "(edited)" },
    "participantDrillDown": { "heading": "{name}'s full vote", "weightedScore": "Weighted {value}", "missed": "Missed" },
    "categoryDrillDown": { "heading": "Full {category} ranking", "mean": "Mean {value}", "voters": "{voted}/{total} voted" },
    "breakdowns": { "heading": "Per-voter breakdowns", "topPick": "{name}'s 12 points went to {country}" },
    "awards": { "heading": "Awards", "winner": "Winner", "jointWinners": "Joint winners" },
    "hotTakes": { "heading": "Hot takes", "empty": "No hot takes saved this round.", "edited": "(edited)" },
    "footer": "Generated {timestamp} · {hostname}/results/{roomId}"
  }
}
```

L3 translation for `es/uk/fr/de` is a Phase L follow-on slice, not part of this PR. `locales.test.ts` will fail until the four other locales have the keys — landing this PR includes either (a) empty stubs in the four other locales with a code comment "T6 follow-on" or (b) full translations bundled in. Default is (a) — keeps the PR scoped.

## Data flow

```
GET /api/results/{id}/export.html
        │
        ▼
[route adapter]
        │   ┌── resolveLocale(req) → "en" | "es" | "uk" | "fr" | "de"
        │   ├── loadResults({ roomId }) ──── status === "done" ────────────────────────┐
        │   │                                                                          │
        │   │   ┌── voteRows query (already running) ──── voteDetails[]                │
        │   │   │                                                                      │
        │   │   ▼                                                                      ▼
        │   └── ResultsData (done)                                            no, return 409
        │   │
        │   └── getTranslations({ namespace: "export", locale })
        │
        ▼
buildResultsHtml(data, { t, now, appHostname })
        │
        ├── escapeHtml hot takes / display names / contestant fields
        ├── dicebearInline(avatarSeed) per unique member (cached)
        ├── compose <html> using EXPORT_STYLESHEET + escaped substitutions
        └── compute byteLength(html, 'utf8')
        │
        ▼
Response(html, headers)
```

## Test plan

Unit (vitest):

- `buildResultsHtml.test.ts`
  - Canonical fixture: 15-user / 26-contestant `done` payload.
  - Asserts `bytes <= 300 * 1024` (§12.3 budget).
  - Snapshot of the rendered HTML against a frozen fixture (catches accidental layout drift).
  - Renders all five locale variants — assert no English leaks when `t` returns Spanish.
  - HTML escaping — fixture includes a hot-take with `<script>alert(1)</script>` and a display name with `&`/`<`. Assert literal escapes in output.
  - Empty drill-down sections (member with no votes) — assert "No hot takes saved this round." copy fires, no broken markup.
  - Missed entries — assert `chip--missed` class + `~` prefix.
  - Joint winners — assert two avatars + "Joint winners" copy.
- `dicebearInline.test.ts`
  - Same seed twice returns identical SVG (memoization).
  - Output is well-formed SVG (parseable by a regex sanity check).
  - No `<script>` or external URL refs in the SVG body.
- `exportStylesheet.test.ts`
  - `EXPORT_STYLESHEET.length <= 4 * 1024` (4 KB cap).
  - Contains `@media print { ... }` block.
  - No `url(...)` references (no external assets).

Route (vitest):

- `route.test.ts`
  - Happy path — 200, correct headers (`Content-Type`, `Content-Disposition`, `Cache-Control`, `X-Content-Bytes`), body starts with `<!DOCTYPE html>`.
  - Non-done status — 409 `{ code: "results_not_ready" }`.
  - Invalid UUID — 400.
  - Room not found — 404.
  - DB failure path — 500.

E2E (Playwright, optional follow-on):

- Live `/api/results/{id}/export.html` against a seeded `done` room. Download the file, open it in a new tab, assert the leaderboard table renders + the 12-point row is gold-accented. Defer unless straightforward.

## Risks

- **DiceBear SSR.** `@dicebear/core` is used client-side today (`src/components/Avatar.tsx`). Need to verify it renders without a DOM in Node — early TODO in the plan is a smoke check. Fallback: text initials (Q3 option A) — same accessibility, smaller payload, ~30 lines of code to write. Acceptable graceful degradation if DiceBear SSR is a rabbit hole.
- **`Cache-Control: immutable` on `done` rooms.** Edge cases: room owner backfills a hot-take post-`done` (currently allowed — `upsertVote` doesn't gate on room status). If that surface stays, the immutable cache header lies. Mitigation: include `ETag` derived from a hash of `room.updated_at + max(votes.updated_at)`; or simply drop `immutable` and use `max-age=300` (5-min) until we audit which writes are still possible after `done`. Default to the conservative `max-age=300, public` to avoid surprise stale exports.
- **Locale fallback when `export.*` keys missing.** `next-intl` throws by default on missing keys. The brand-new `export.*` namespace will be missing from `es/uk/fr/de` until L3 ships. Mitigation: launch with stubs (`null` values that resolve via fallback) and assert in `locales.test.ts`.
- **Payload size regression.** A future room with 50 members on a custom 8-category template could blow past 300 KB. The test fixture is sized for SPEC's typical case (15×26); larger rooms get the `X-Content-Bytes` header but no 409. Mitigation: monitor `X-Content-Bytes` in Vercel logs after first real export; tighten the test if outliers exceed 600 KB.
- **Bet section forward-compat.** The renderer needs a `if (data.betsEnabled) renderBets(data)` branch today even though the LHS is always `false`. Keeps the call site honest for when R7 lands — but the branch goes uncovered by tests. Mitigation: unit test asserts that when a fixture has `betsEnabled: true` + a `bets: []` array (even empty), the section renders an empty-state copy rather than throwing. Locks the contract early.

## Rollout

Single PR. No schema migration. No env-var changes. Safe to merge any time after MVP ships.

Follow-on slices (separate PRs, not in scope):

1. **PDF export (§12.4).** Reuse `buildResultsHtml` or share the lower-level structure (likely a parallel `ResultsDocument.tsx` for `@react-pdf/renderer`). Same data path.
2. **§12.6 drill-down UI.** Modals/sheets on `/results/[id]` consuming the same `voteDetails` payload extension this slice ships. ~1.5 days per the audit.
3. **L3 translation pass** for `export.*` keys across `es/uk/fr/de`. Same workflow as every prior namespace.
4. **"Download export" CTA** on `/results/[id]` and on `<EndOfShowCtas>` — wire a button that hits the endpoint. Today the URL is shareable but not surfaced.

## Open questions

None blocking. The `Cache-Control` choice is the only judgment call (immutable vs. 5-min) and is resolved conservatively above; revisit after first production exports.
