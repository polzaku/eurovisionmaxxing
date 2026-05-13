# R5 §12.3 HTML Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /api/results/{id}/export.html` returning a self-contained HTML scorecard for `done` rooms (leaderboard + per-user breakdowns + awards + hot takes + §12.6.1/§12.6.2/§12.6.3 drill-downs inline), under a 300 KB budget, plus the `loadResults` `voteDetails` payload extension that unlocks future §12.6 modal/sheet UIs on `/results/[id]`.

**Architecture:** Pure renderer `buildResultsHtml` consumes the `done` payload (extended with `voteDetails`) and a `t` function, returns `{ html, filename, bytes }`. CSS lives in a unit-tested constant module. DiceBear avatars inline as SVG via a memoized server-side renderer. Route adapter is a thin wrapper around `loadResults` + the renderer + `getTranslations`.

**Tech Stack:** Next.js 14 App Router route handler, next-intl `getTranslations` (server-side), `@dicebear/core` + `@dicebear/collection` (new runtime deps for SSR avatars), vitest for unit + route tests.

**Spec:** [docs/superpowers/specs/2026-05-13-r5-html-export-design.md](../specs/2026-05-13-r5-html-export-design.md)

**Branch:** `feat/r5-html-export` (already created)

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `package.json` | modify | Add `@dicebear/core` + `@dicebear/collection` to `dependencies` |
| `src/lib/results/loadResults.ts` | modify | Add `voteDetails` field to the `done` payload (joined from existing `votes` + `results` queries — zero new round-trips) |
| `src/lib/results/loadResults.test.ts` | modify | Cover `voteDetails` shape on the `done` branch |
| `src/lib/export/escapeHtml.ts` | create | Pure `escapeHtml(s: string): string` helper (& < > " ') |
| `src/lib/export/escapeHtml.test.ts` | create | Table-driven tests |
| `src/lib/export/exportStylesheet.ts` | create | `EXPORT_STYLESHEET` minified CSS constant + `@media print` rules |
| `src/lib/export/exportStylesheet.test.ts` | create | Size cap (≤4 KB), `@media print` block present, no `url(...)` refs |
| `src/lib/export/dicebearInline.ts` | create | `renderAvatarSvg(seed: string): string` — memoized fun-emoji SVG (no `<script>`, no external refs) |
| `src/lib/export/dicebearInline.test.ts` | create | Deterministic output (same seed → same SVG), no scripts, no external URLs, memoization |
| `src/lib/export/buildResultsHtml.ts` | create | Pure renderer — takes done payload + `{ t, now, appHostname }`, returns `{ html, filename, bytes }` |
| `src/lib/export/buildResultsHtml.test.ts` | create | Fixture-driven: 15×26 fixture under 300 KB, locale leak check, HTML escaping, drill-downs present, missed/edited rendering, joint winners, bets suppressed when `betsEnabled` is false |
| `src/lib/export/__fixtures__/done-15x26.ts` | create | Canonical 15-user / 26-contestant fixture used by buildResultsHtml.test.ts |
| `src/app/api/results/[id]/export.html/route.ts` | create | Route adapter — `loadResults` + locale resolution + renderer + headers |
| `src/app/api/results/[id]/export.html/route.test.ts` | create | Happy path, 409 non-done, 400 invalid UUID, 404 not found, 500 DB failure |
| `src/locales/en.json` | modify | Add `export.*` namespace |
| `src/locales/es.json`, `uk.json`, `fr.json`, `de.json` | modify | Stub `export.*` namespace (English copy as placeholder; L3 translates later) |
| `src/locales/locales.test.ts` | already enforces parity — no changes needed |

---

## Task 1: Install `@dicebear/core` + `@dicebear/collection` + SSR smoke check

**Files:**
- Modify: `package.json`
- Create: `src/lib/export/dicebear-ssr-smoke.test.ts` (deleted after passing — a one-off proof the deps work in Node)

- [ ] **Step 1: Install the deps**

```bash
npm install @dicebear/core@^9 @dicebear/collection@^9
```

Expected: two new entries under `dependencies` in `package.json`. Commit `package.json` + `package-lock.json` together.

- [ ] **Step 2: Write a smoke test proving SSR works**

Create `src/lib/export/dicebear-ssr-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createAvatar } from "@dicebear/core";
import { funEmoji } from "@dicebear/collection";

describe("DiceBear SSR smoke", () => {
  it("renders fun-emoji to a complete SVG string in pure Node", () => {
    const svg = createAvatar(funEmoji, { seed: "alice", size: 48 }).toString();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/https?:\/\//);
  });

  it("is deterministic for the same seed", () => {
    const a = createAvatar(funEmoji, { seed: "bob" }).toString();
    const b = createAvatar(funEmoji, { seed: "bob" }).toString();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 3: Run the smoke test**

Run: `npm run test -- src/lib/export/dicebear-ssr-smoke.test.ts`
Expected: 2 tests pass. If they fail (cannot resolve modules, references browser-only APIs, or output contains `<script>` / external URLs), **stop and switch to text-initials fallback** for Task 5 (`dicebearInline.ts` becomes a small initials-circle renderer instead). Document the fallback decision in the commit message.

- [ ] **Step 4: Delete the smoke test file (it's served its purpose)**

```bash
rm src/lib/export/dicebear-ssr-smoke.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(deps): add @dicebear/core + collection for server-side avatar SVG

Verified DiceBear fun-emoji renders to a script-free, self-contained SVG
string under Node — required for the R5 §12.3 HTML export to inline
avatars without runtime fetches to api.dicebear.com.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extend `loadResults` `done` payload with `voteDetails`

**Files:**
- Modify: `src/lib/results/loadResults.ts`
- Modify: `src/lib/results/loadResults.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/results/loadResults.test.ts` inside the `done` describe block (locate near the existing "returns done payload with hot takes" test):

```ts
it("attaches voteDetails to the done payload joining votes.scores with results.points_awarded", async () => {
  const sb = makeSupabaseMock({
    roomSelect: {
      data: {
        id: VALID_ROOM_ID,
        status: "done",
        pin: "AAAAAA",
        year: 2026,
        event: "final",
        owner_user_id: "owner-1",
        categories: [{ name: "Vocals", weight: 1, key: "vocals" }],
        announcement_order: null,
        announcing_user_id: null,
        current_announce_idx: null,
        delegate_user_id: null,
        announce_skipped_user_ids: null,
      },
      error: null,
    },
    resultsSelect: {
      data: [
        { user_id: "u1", contestant_id: "2026-al", points_awarded: 12, announced: true },
        { user_id: "u1", contestant_id: "2026-be", points_awarded: 0, announced: true },
      ],
      error: null,
    },
    membershipsSelect: {
      data: [{ user_id: "u1", users: { display_name: "Alice", avatar_seed: "alice" } }],
      error: null,
    },
    hotTakesSelect: {
      data: [
        { user_id: "u1", contestant_id: "2026-al", hot_take: "Yes!", hot_take_edited_at: null },
      ],
      error: null,
    },
    votesSelect: {
      data: [
        { user_id: "u1", contestant_id: "2026-al", scores: { vocals: 10 }, missed: false },
        { user_id: "u1", contestant_id: "2026-be", scores: { vocals: 4 }, missed: false },
      ],
      error: null,
    },
  });

  const result = await loadResults({ roomId: VALID_ROOM_ID }, makeDeps(sb));
  expect(result.ok).toBe(true);
  if (!result.ok || result.data.status !== "done") throw new Error("expected done");

  expect(result.data.categories).toEqual([{ name: "Vocals", weight: 1, key: "vocals" }]);

  expect(result.data.voteDetails).toEqual([
    {
      userId: "u1",
      contestantId: "2026-al",
      scores: { vocals: 10 },
      missed: false,
      pointsAwarded: 12,
      hotTake: "Yes!",
      hotTakeEditedAt: null,
    },
    {
      userId: "u1",
      contestantId: "2026-be",
      scores: { vocals: 4 },
      missed: false,
      pointsAwarded: 0,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/results/loadResults.test.ts -t "attaches voteDetails"`
Expected: FAIL — `voteDetails` is undefined on the `done` payload.

- [ ] **Step 3: Extend the `ResultsData` `done` shape**

Edit `src/lib/results/loadResults.ts` — inside the `ResultsData` union, add `voteDetails` AND `categories` to the `done` branch (after `personalNeighbours`):

```ts
categories: Array<{ name: string; weight: number; key?: string }>;
voteDetails: Array<{
  userId: string;
  contestantId: string;
  scores: Record<string, number>;
  missed: boolean;
  pointsAwarded: number;
  hotTake: string | null;
  hotTakeEditedAt: string | null;
}>;
```

The `categories` extension is needed alongside `voteDetails` so the HTML export renderer can compute weighted scores for the drill-down rows per SPEC §12.6.1/§12.6.2 (without it, the export silently downgrades to unweighted means).

- [ ] **Step 4: Build `voteDetails` in `loadDone`**

In the `loadDone` function, between the `personalNeighbours` computation and the `return` statement, add:

```ts
// Build voteDetails: left-join voteRows (per-category scores + missed) with
// resultRows (pointsAwarded) and hotTakeRows (hot_take + edited_at), keyed
// by (user_id, contestant_id). Used by R5 §12.3 HTML export and future
// §12.6 drill-down UIs. Only contestants the user actually voted on appear
// (voteRows is the driver); contestants with no vote are absent.
const pointsByPair = new Map<string, number>();
for (const r of resultRows) {
  pointsByPair.set(`${r.user_id}::${r.contestant_id}`, r.points_awarded);
}
const hotTakeByPair = new Map<
  string,
  { hotTake: string; hotTakeEditedAt: string | null }
>();
for (const h of hotTakeRows) {
  if (!h.hot_take || h.hot_take.trim() === "") continue;
  hotTakeByPair.set(`${h.user_id}::${h.contestant_id}`, {
    hotTake: h.hot_take,
    hotTakeEditedAt: h.hot_take_edited_at,
  });
}
const voteDetails = voteRows.map((v) => {
  const key = `${v.user_id}::${v.contestant_id}`;
  const ht = hotTakeByPair.get(key);
  return {
    userId: v.user_id,
    contestantId: v.contestant_id,
    scores: (v.scores ?? {}) as Record<string, number>,
    missed: v.missed,
    pointsAwarded: pointsByPair.get(key) ?? 0,
    hotTake: ht?.hotTake ?? null,
    hotTakeEditedAt: ht?.hotTakeEditedAt ?? null,
  };
});
```

Then add both `categories,` and `voteDetails,` to the `return` payload alongside `personalNeighbours,`. The `categories` value is just the already-destructured local variable from earlier in `loadDone` (the same `const categories = Array.isArray(room.categories) ? ... : []` block that feeds `buildPersonalNeighbours`).

- [ ] **Step 5: Run test to verify it passes + the existing suite stays green**

Run: `npm run test -- src/lib/results/loadResults.test.ts`
Expected: All tests pass including the new one.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/results/loadResults.ts src/lib/results/loadResults.test.ts
git commit -m "feat(results): add voteDetails to loadResults done payload

Per-user per-contestant scores blob joined with points_awarded and
hot-take. Zero new DB round-trips — derived from the votes/results/
hot_takes SELECTs already running. Gated to status='done' so live
announcing payloads don't leak category breakdowns (SPEC §12.6.4).

Unlocks R5 §12.3 HTML export drill-down rendering and future §12.6.1/
§12.6.2 modal/sheet UIs on /results/[id].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `escapeHtml` helper

**Files:**
- Create: `src/lib/export/escapeHtml.ts`
- Create: `src/lib/export/escapeHtml.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/export/escapeHtml.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { escapeHtml } from "@/lib/export/escapeHtml";

describe("escapeHtml", () => {
  it.each([
    ["<script>", "&lt;script&gt;"],
    ["A & B", "A &amp; B"],
    ['He said "hi"', "He said &quot;hi&quot;"],
    ["it's fine", "it&#39;s fine"],
    ["", ""],
    ["plain text", "plain text"],
    [
      "<img src=x onerror=alert(1)>",
      "&lt;img src=x onerror=alert(1)&gt;",
    ],
  ])("escapes %j → %j", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it("preserves emoji", () => {
    expect(escapeHtml("🇸🇪 Sweden")).toBe("🇸🇪 Sweden");
  });

  it("escapes & before other entities (no double-encoding)", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/export/escapeHtml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/export/escapeHtml.ts`:

```ts
/**
 * HTML-escape arbitrary text for safe inclusion in `<body>` content or
 * attribute values. Order matters: `&` must be replaced first so the
 * subsequent ampersand-replacements aren't double-encoded.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/lib/export/escapeHtml.test.ts`
Expected: all 9 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/escapeHtml.ts src/lib/export/escapeHtml.test.ts
git commit -m "feat(export): escapeHtml helper for user-generated content

Escapes & < > \" ' in arbitrary text. Used by the R5 §12.3 export
renderer for display names, hot takes, and any other field that may
contain HTML metacharacters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `exportStylesheet.ts` minified CSS constant

**Files:**
- Create: `src/lib/export/exportStylesheet.ts`
- Create: `src/lib/export/exportStylesheet.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/export/exportStylesheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EXPORT_STYLESHEET } from "@/lib/export/exportStylesheet";

describe("EXPORT_STYLESHEET", () => {
  it("fits within the 4 KB budget", () => {
    expect(Buffer.byteLength(EXPORT_STYLESHEET, "utf8")).toBeLessThanOrEqual(
      4 * 1024,
    );
  });

  it("contains a @media print block", () => {
    expect(EXPORT_STYLESHEET).toMatch(/@media\s+print/);
  });

  it("uses no external url() references", () => {
    expect(EXPORT_STYLESHEET).not.toMatch(/url\(/);
  });

  it("uses no http(s) references", () => {
    expect(EXPORT_STYLESHEET).not.toMatch(/https?:\/\//);
  });

  it("declares the chip and chip--missed classes", () => {
    expect(EXPORT_STYLESHEET).toContain(".chip");
    expect(EXPORT_STYLESHEET).toContain(".chip--missed");
  });

  it("declares the leaderboard table styling", () => {
    expect(EXPORT_STYLESHEET).toMatch(/\.leaderboard\s+table/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/lib/export/exportStylesheet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/export/exportStylesheet.ts`:

```ts
/**
 * Hand-minified stylesheet for the R5 §12.3 HTML export.
 *
 * Aesthetic (per design Q2 — print-first minimalist):
 * - System font stack, no @font-face declarations.
 * - Black-on-white with a single gold accent (#d4a017) for 12-pointer rows
 *   and "Winner" badges.
 * - Tabular leaderboard via <table>; flex for award cards.
 * - @media print strips colour, tightens A4 margins, page-break controls.
 *
 * Edited inline rather than auto-minified so it can be reviewed as a unit.
 * Size budget: ≤4 KB. Asserted by exportStylesheet.test.ts.
 */
export const EXPORT_STYLESHEET = `*,*::before,*::after{box-sizing:border-box}html{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.5;color:#1a1a1a;background:#fff}body{max-width:880px;margin:0 auto;padding:24px 16px}header{border-bottom:1px solid #ddd;padding-bottom:12px;margin-bottom:24px}header h1{font-size:1.5rem;margin:0 0 4px}header .meta{color:#666;font-size:0.875rem}section{margin:32px 0}section h2{font-size:1.25rem;border-bottom:1px solid #eee;padding-bottom:6px;margin:0 0 12px}.leaderboard table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.leaderboard th,.leaderboard td{padding:8px 10px;text-align:left;border-bottom:1px solid #eee}.leaderboard th{background:#fafafa;font-weight:600;font-size:0.875rem}.leaderboard td.points{text-align:right;font-weight:600}.leaderboard tr.twelve td{background:#fff8e1}.leaderboard tr.twelve td.points{color:#d4a017}.awards{display:flex;flex-direction:column;gap:16px}.award{border:1px solid #eee;border-radius:6px;padding:12px}.award h3{margin:0 0 4px;font-size:1rem}.award .badge{display:inline-block;background:#d4a017;color:#fff;font-size:0.75rem;padding:2px 8px;border-radius:999px;margin-left:8px}.breakdowns,.breakdowns article{display:block}.breakdowns article{border-top:1px dashed #eee;padding:12px 0}.breakdowns article:first-of-type{border-top:0}.breakdowns .avatar{width:32px;height:32px;display:inline-block;vertical-align:middle;margin-right:8px}.breakdowns ol.picks{margin:8px 0 0;padding-left:24px}.breakdowns ol.picks li{margin:2px 0}.hot-takes p.empty{color:#666;font-style:italic}.hot-takes blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid #d4a017;background:#fafafa}.hot-takes blockquote .author{display:block;color:#666;font-size:0.8125rem;margin-bottom:4px}.chip{display:inline-block;padding:1px 6px;margin:0 2px;border:1px solid #eee;border-radius:4px;font-size:0.8125rem;background:#fff}.chip--missed{color:#999;font-style:italic;background:#fafafa}details{margin:6px 0}details summary{cursor:pointer;color:#666;font-size:0.875rem;padding:4px 0}details>table{margin-top:8px;width:100%;border-collapse:collapse;font-size:0.875rem}details>table th,details>table td{padding:4px 6px;border-bottom:1px solid #f0f0f0}.points-pill{display:inline-block;min-width:28px;text-align:center;background:#1a1a1a;color:#fff;border-radius:999px;padding:2px 8px;font-weight:600;font-size:0.8125rem}.points-pill.twelve{background:#d4a017}.edited{color:#999;font-size:0.75rem;font-style:italic}footer{margin-top:48px;padding-top:12px;border-top:1px solid #ddd;color:#666;font-size:0.8125rem;text-align:center}@media print{body{max-width:none;padding:0;font-size:11pt}.leaderboard tr.twelve td.points{color:#000;font-weight:700}.award .badge{background:transparent;color:#000;border:1px solid #000}.points-pill,.points-pill.twelve{background:transparent;color:#000;border:1px solid #000}.hot-takes blockquote{border-left-color:#000;background:transparent}.award,article{page-break-inside:avoid}details{page-break-inside:avoid}details[open] summary{font-weight:600}}`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/lib/export/exportStylesheet.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/exportStylesheet.ts src/lib/export/exportStylesheet.test.ts
git commit -m "feat(export): minified stylesheet constant for HTML export

Hand-minified, ≤4 KB, no external assets. Print-first minimalist
aesthetic with a single gold accent and @media print rules for A4
output. Exported as a string so the renderer can drop it inline in
<style>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `dicebearInline.ts` memoized server-side SVG renderer

**Files:**
- Create: `src/lib/export/dicebearInline.ts`
- Create: `src/lib/export/dicebearInline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/export/dicebearInline.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderAvatarSvg, _resetCache } from "@/lib/export/dicebearInline";

beforeEach(() => {
  _resetCache();
});

describe("renderAvatarSvg", () => {
  it("returns a well-formed SVG string", () => {
    const svg = renderAvatarSvg("alice");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("is deterministic for the same seed", () => {
    expect(renderAvatarSvg("bob")).toBe(renderAvatarSvg("bob"));
  });

  it("differs between seeds", () => {
    expect(renderAvatarSvg("alice")).not.toBe(renderAvatarSvg("bob"));
  });

  it("contains no <script> tags", () => {
    expect(renderAvatarSvg("alice")).not.toContain("<script");
  });

  it("contains no external URLs", () => {
    expect(renderAvatarSvg("alice")).not.toMatch(/https?:\/\//);
  });

  it("memoizes — repeated calls reuse cache", () => {
    const a = renderAvatarSvg("carol");
    const b = renderAvatarSvg("carol");
    expect(a).toBe(b);
    // Same string identity implies cache hit (sanity check, not a hard guarantee)
    expect(Object.is(a, b)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/lib/export/dicebearInline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/export/dicebearInline.ts`:

```ts
import { createAvatar } from "@dicebear/core";
import { funEmoji } from "@dicebear/collection";

const cache = new Map<string, string>();

/**
 * Server-side renderer for inline DiceBear fun-emoji avatars. Used by the
 * R5 §12.3 HTML export to embed avatars without runtime fetches to
 * api.dicebear.com.
 *
 * Memoized per-process. For a single export the cache is bounded by the
 * room's member count (~15-50 unique seeds). The cache is intentionally
 * unbounded — the export route is short-lived so growth is negligible;
 * call _resetCache from tests when isolation is needed.
 */
export function renderAvatarSvg(seed: string): string {
  const hit = cache.get(seed);
  if (hit !== undefined) return hit;
  const svg = createAvatar(funEmoji, {
    seed,
    size: 48,
    backgroundColor: ["transparent"],
  }).toString();
  cache.set(seed, svg);
  return svg;
}

/** Exposed for test isolation only. Not part of the public API. */
export function _resetCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/lib/export/dicebearInline.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/dicebearInline.ts src/lib/export/dicebearInline.test.ts
git commit -m "feat(export): server-side memoized DiceBear SVG renderer

renderAvatarSvg(seed) returns inline fun-emoji SVG with transparent
background. Memoized per-process so a single export render reuses each
unique seed once. Used by buildResultsHtml to inline avatars without
runtime fetches to api.dicebear.com.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Canonical fixture for `buildResultsHtml` tests

**Files:**
- Create: `src/lib/export/__fixtures__/done-15x26.ts`

- [ ] **Step 1: Build the fixture**

Create `src/lib/export/__fixtures__/done-15x26.ts`:

```ts
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const YEAR = 2026;
const EVENT = "final" as const;
const PIN = "TESTPN";

const COUNTRIES: Array<[string, string, string]> = [
  ["al", "Albania", "🇦🇱"], ["am", "Armenia", "🇦🇲"], ["au", "Australia", "🇦🇺"],
  ["at", "Austria", "🇦🇹"], ["be", "Belgium", "🇧🇪"], ["ch", "Switzerland", "🇨🇭"],
  ["cy", "Cyprus", "🇨🇾"], ["de", "Germany", "🇩🇪"], ["dk", "Denmark", "🇩🇰"],
  ["ee", "Estonia", "🇪🇪"], ["es", "Spain", "🇪🇸"], ["fi", "Finland", "🇫🇮"],
  ["fr", "France", "🇫🇷"], ["gb", "United Kingdom", "🇬🇧"], ["gr", "Greece", "🇬🇷"],
  ["hr", "Croatia", "🇭🇷"], ["ie", "Ireland", "🇮🇪"], ["il", "Israel", "🇮🇱"],
  ["is", "Iceland", "🇮🇸"], ["it", "Italy", "🇮🇹"], ["lv", "Latvia", "🇱🇻"],
  ["nl", "Netherlands", "🇳🇱"], ["no", "Norway", "🇳🇴"], ["pl", "Poland", "🇵🇱"],
  ["pt", "Portugal", "🇵🇹"], ["se", "Sweden", "🇸🇪"],
];

const MEMBERS = Array.from({ length: 15 }, (_, i) => ({
  userId: `user-${String(i + 1).padStart(2, "0")}`,
  displayName: `Voter ${String.fromCharCode(65 + i)}`,
  avatarSeed: `seed-${i + 1}`,
}));

const POINTS_LADDER = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1] as const;

const contestants = COUNTRIES.map(([code, country, flag], idx) => ({
  id: `${YEAR}-${code}`,
  country,
  countryCode: code,
  flagEmoji: flag,
  artist: `Artist ${idx + 1}`,
  song: `Song ${idx + 1}`,
  runningOrder: idx + 1,
  event: EVENT,
  year: YEAR,
}));

// Deterministic per-(user, contestant) score in 1-10 so renders stay stable
// across runs. Seed: (userIdx * 7 + contestantIdx * 3) % 10 + 1.
function scoreFor(userIdx: number, contestantIdx: number): number {
  return ((userIdx * 7 + contestantIdx * 3) % 10) + 1;
}

const CATEGORIES = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Music", weight: 1, key: "music" },
  { name: "Outfit", weight: 1, key: "outfit" },
  { name: "Stage", weight: 1, key: "stage" },
  { name: "Vibes", weight: 1, key: "vibes" },
];

// Each user awards points to 10 contestants (their top 10 by mean score).
// Leaderboard is the sum across users.
const voteDetails: DonePayload["voteDetails"] = [];
const resultRowsByUser: Record<string, Array<{ contestantId: string; pointsAwarded: number }>> = {};
MEMBERS.forEach((m, userIdx) => {
  const ranked = contestants
    .map((c, contestantIdx) => ({
      contestantId: c.id,
      score: scoreFor(userIdx, contestantIdx),
    }))
    .sort((a, b) => b.score - a.score);
  resultRowsByUser[m.userId] = ranked.map((r, rankIdx) => ({
    contestantId: r.contestantId,
    pointsAwarded: rankIdx < 10 ? POINTS_LADDER[rankIdx] : 0,
  }));
  contestants.forEach((c, contestantIdx) => {
    const baseScore = scoreFor(userIdx, contestantIdx);
    voteDetails.push({
      userId: m.userId,
      contestantId: c.id,
      scores: {
        vocals: baseScore,
        music: ((baseScore + 1) % 10) + 1,
        outfit: ((baseScore + 2) % 10) + 1,
        stage: ((baseScore + 3) % 10) + 1,
        vibes: ((baseScore + 4) % 10) + 1,
      },
      missed: false,
      pointsAwarded: resultRowsByUser[m.userId].find((r) => r.contestantId === c.id)?.pointsAwarded ?? 0,
      hotTake: contestantIdx < 3 && userIdx < 5 ? `Hot take from ${m.displayName} on ${c.country}` : null,
      hotTakeEditedAt: null,
    });
  });
});

const leaderboard = contestants
  .map((c) => {
    const totalPoints = MEMBERS.reduce(
      (sum, m) =>
        sum +
        (resultRowsByUser[m.userId].find((r) => r.contestantId === c.id)
          ?.pointsAwarded ?? 0),
      0,
    );
    return { contestantId: c.id, totalPoints, rank: 0 };
  })
  .sort((a, b) => {
    if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
    return a.contestantId.localeCompare(b.contestantId);
  })
  .map((row, idx, all) => {
    const rank =
      idx > 0 && all[idx - 1].totalPoints === row.totalPoints
        ? all[idx - 1].rank
        : idx + 1;
    return { ...row, rank };
  });

const breakdowns = MEMBERS.map((m) => ({
  userId: m.userId,
  displayName: m.displayName,
  avatarSeed: m.avatarSeed,
  picks: resultRowsByUser[m.userId]
    .filter((r) => r.pointsAwarded > 0)
    .sort((a, b) => b.pointsAwarded - a.pointsAwarded),
}));

const contestantBreakdowns = contestants
  .map((c) => ({
    contestantId: c.id,
    gives: MEMBERS.map((m) => {
      const row = resultRowsByUser[m.userId].find((r) => r.contestantId === c.id);
      return {
        userId: m.userId,
        displayName: m.displayName,
        avatarSeed: m.avatarSeed,
        pointsAwarded: row?.pointsAwarded ?? 0,
      };
    }).filter((g) => g.pointsAwarded > 0).sort((a, b) => b.pointsAwarded - a.pointsAwarded),
  }))
  .filter((cb) => cb.gives.length > 0);

const hotTakes = voteDetails
  .filter((v) => v.hotTake !== null)
  .map((v) => {
    const m = MEMBERS.find((mm) => mm.userId === v.userId)!;
    return {
      userId: v.userId,
      displayName: m.displayName,
      avatarSeed: m.avatarSeed,
      contestantId: v.contestantId,
      hotTake: v.hotTake!,
      hotTakeEditedAt: v.hotTakeEditedAt,
    };
  });

export const FIXTURE_DONE_15x26: DonePayload = {
  status: "done",
  year: YEAR,
  event: EVENT,
  pin: PIN,
  ownerUserId: MEMBERS[0].userId,
  categories: CATEGORIES,
  leaderboard,
  contestants,
  breakdowns,
  contestantBreakdowns,
  hotTakes,
  awards: [
    {
      roomId: "room-1",
      awardKey: "best_vocals",
      awardName: "Best Vocals",
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: leaderboard[0].contestantId,
      statValue: 8.5,
      statLabel: "Mean vocals score",
    },
    {
      roomId: "room-1",
      awardKey: "harshest_critic",
      awardName: "Harshest Critic",
      winnerUserId: MEMBERS[2].userId,
      winnerUserIdB: null,
      winnerContestantId: null,
      statValue: 4.2,
      statLabel: "Lowest mean given",
    },
    {
      roomId: "room-1",
      awardKey: "neighbourhood_voters",
      awardName: "Neighbourhood Voters",
      winnerUserId: MEMBERS[0].userId,
      winnerUserIdB: MEMBERS[1].userId,
      winnerContestantId: null,
      statValue: 0.91,
      statLabel: "Spearman correlation",
    },
  ],
  personalNeighbours: [],
  members: MEMBERS,
  voteDetails,
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/export/__fixtures__/done-15x26.ts
git commit -m "test(export): canonical 15-user / 26-contestant done fixture

Deterministic per-(user, contestant) scoring so renderer snapshots stay
stable. Includes a category award, a personality award, and a joint-
winner pair award to exercise all award rendering branches. Three users
have hot takes on the first three contestants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `buildResultsHtml` renderer + fixture-driven tests

**Files:**
- Create: `src/lib/export/buildResultsHtml.ts`
- Create: `src/lib/export/buildResultsHtml.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/export/buildResultsHtml.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildResultsHtml,
  type BuildResultsHtmlDeps,
} from "@/lib/export/buildResultsHtml";
import { FIXTURE_DONE_15x26 } from "@/lib/export/__fixtures__/done-15x26";
import type { ResultsData } from "@/lib/results/loadResults";
import { _resetCache } from "@/lib/export/dicebearInline";

type DonePayload = Extract<ResultsData, { status: "done" }>;

function makeT(prefix = "en"): BuildResultsHtmlDeps["t"] {
  return (key, params) => {
    if (params && Object.keys(params).length) {
      const rendered = Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        key,
      );
      return `${prefix}:${rendered}`;
    }
    return `${prefix}:${key}`;
  };
}

function makeDeps(prefix = "en"): BuildResultsHtmlDeps {
  return {
    t: makeT(prefix),
    now: () => new Date("2026-05-16T22:30:00Z"),
    appHostname: "eurovisionmaxxing.com",
  };
}

beforeEach(() => {
  _resetCache();
});

describe("buildResultsHtml", () => {
  it("renders the canonical 15×26 fixture under the 300 KB budget", () => {
    const { html, bytes } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(bytes).toBe(Buffer.byteLength(html, "utf8"));
    expect(bytes).toBeLessThanOrEqual(300 * 1024);
  });

  it("emits the correct filename for a final room", () => {
    const { filename } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(filename).toBe("emx-2026-final-TESTPN.html");
  });

  it("sanitises the filename — no quotes, slashes, or path separators", () => {
    const evil: DonePayload = { ...FIXTURE_DONE_15x26, pin: 'A"B/C\\D' };
    const { filename } = buildResultsHtml(evil, makeDeps());
    expect(filename).not.toMatch(/["/\\]/);
  });

  it("inlines the stylesheet", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toMatch(/<style>.*?@media\s+print.*?<\/style>/s);
  });

  it("inlines avatar SVGs in the breakdowns section", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toMatch(/<svg/);
  });

  it("escapes user-provided strings", () => {
    const evil: DonePayload = {
      ...FIXTURE_DONE_15x26,
      hotTakes: [
        {
          userId: "user-01",
          displayName: "Voter A",
          avatarSeed: "seed-1",
          contestantId: FIXTURE_DONE_15x26.leaderboard[0].contestantId,
          hotTake: "<script>alert(1)</script>",
          hotTakeEditedAt: null,
        },
      ],
      members: [
        ...FIXTURE_DONE_15x26.members.slice(1),
        { userId: "user-01", displayName: "Voter <A> & B", avatarSeed: "seed-1" },
      ],
    };
    const { html } = buildResultsHtml(evil, makeDeps());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Voter &lt;A&gt; &amp; B");
  });

  it("renders missed entries with the chip--missed class and ~ prefix", () => {
    const withMissed: DonePayload = {
      ...FIXTURE_DONE_15x26,
      voteDetails: FIXTURE_DONE_15x26.voteDetails.map((v, i) =>
        i === 0 ? { ...v, missed: true } : v,
      ),
    };
    const { html } = buildResultsHtml(withMissed, makeDeps());
    expect(html).toContain("chip--missed");
    expect(html).toContain("~");
  });

  it("renders the (edited) tag for edited hot takes", () => {
    const withEdited: DonePayload = {
      ...FIXTURE_DONE_15x26,
      hotTakes: [
        {
          userId: "user-01",
          displayName: "Voter A",
          avatarSeed: "seed-1",
          contestantId: FIXTURE_DONE_15x26.leaderboard[0].contestantId,
          hotTake: "Yes",
          hotTakeEditedAt: "2026-05-16T22:00:00Z",
        },
      ],
    };
    const { html } = buildResultsHtml(withEdited, makeDeps());
    expect(html).toContain("en:export.hotTakes.edited");
  });

  it("renders joint-winners caption when winnerUserIdB is set", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.awards.jointWinners");
  });

  it("does not leak English when t is locale-prefixed", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps("es"));
    expect(html).not.toContain("en:export.");
    expect(html).toContain("es:export.");
  });

  it("renders the empty-state copy for hot-takes when there are none", () => {
    const noHotTakes: DonePayload = { ...FIXTURE_DONE_15x26, hotTakes: [] };
    const { html } = buildResultsHtml(noHotTakes, makeDeps());
    expect(html).toContain("en:export.hotTakes.empty");
  });

  it("emits inline <details> drill-down blocks under leaderboard rows", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.contestantDrillDown.heading");
  });

  it("emits participant drill-down sections under each breakdown article", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.participantDrillDown.heading");
  });

  it("emits category drill-down under each category award", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.categoryDrillDown.heading");
  });

  it("suppresses the bets section when betsEnabled is false (default)", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).not.toMatch(/<section[^>]*class="bets"/);
  });

  it("includes the footer with generated-at + roomId-derived path", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.footer");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/lib/export/buildResultsHtml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer**

Create `src/lib/export/buildResultsHtml.ts`:

```ts
import type { ResultsData } from "@/lib/results/loadResults";
import { EXPORT_STYLESHEET } from "@/lib/export/exportStylesheet";
import { escapeHtml } from "@/lib/export/escapeHtml";
import { renderAvatarSvg } from "@/lib/export/dicebearInline";
import { computeWeightedScore } from "@/lib/scoring";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface BuildResultsHtmlDeps {
  /** Locale-resolved translator (caller scopes namespace separately if needed). */
  t: (key: string, params?: Record<string, unknown>) => string;
  /** Injected clock for deterministic tests. */
  now: () => Date;
  /** Hostname for the footer link, e.g. "eurovisionmaxxing.com". */
  appHostname: string;
  /** Forward-compat: bets data when R7/V2 ships. Section is suppressed when undefined. */
  bets?: unknown;
}

export interface BuildResultsHtmlOutput {
  html: string;
  filename: string;
  bytes: number;
}

const FILENAME_BAD_CHARS = /[^A-Za-z0-9._-]/g;

function buildFilename(year: number, event: string, pin: string): string {
  const safePin = pin.replace(FILENAME_BAD_CHARS, "");
  return `emx-${year}-${event}-${safePin}.html`;
}

function renderHeader(data: DonePayload, t: BuildResultsHtmlDeps["t"], now: Date): string {
  return `<header><h1>${escapeHtml(
    t("title", { year: data.year, event: data.event, pin: data.pin }),
  )}</h1><p class="meta">${escapeHtml(
    t("header.generatedAt", { timestamp: now.toISOString() }),
  )}</p></header>`;
}

function renderLeaderboard(data: DonePayload, t: BuildResultsHtmlDeps["t"]): string {
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const drillByContestant = new Map(
    data.contestantBreakdowns.map((cb) => [cb.contestantId, cb]),
  );
  const memberById = new Map(data.members.map((m) => [m.userId, m]));

  const rows = data.leaderboard
    .map((row) => {
      const c = contestantById.get(row.contestantId);
      if (!c) return "";
      const isTwelve = row.totalPoints >= 12 && row.rank === 1;
      const trClass = isTwelve ? ` class="twelve"` : "";
      const drill = drillByContestant.get(row.contestantId);
      const drillSection = drill
        ? `<tr><td colspan="4"><details><summary>${escapeHtml(
            t("contestantDrillDown.heading", { country: c.country }),
          )}</summary><table><thead><tr><th>${escapeHtml(
            t("contestantDrillDown.voter"),
          )}</th><th>${escapeHtml(
            t("contestantDrillDown.weightedScore", { value: "" }).replace(/\s*$/, ""),
          )}</th><th>${escapeHtml(
            t("contestantDrillDown.points"),
          )}</th></tr></thead><tbody>${drill.gives
            .map((g) => {
              const detail = data.voteDetails.find(
                (v) => v.userId === g.userId && v.contestantId === c.id,
              );
              const weighted = detail
                ? computeWeightedScore(detail.scores, data.categories)
                : 0;
              return `<tr><td>${escapeHtml(g.displayName)}</td><td>${
                detail
                  ? `<span class="${detail.missed ? "chip chip--missed" : "chip"}">${
                      detail.missed ? "~" : ""
                    }${weighted.toFixed(1)}</span>`
                  : ""
              }</td><td><span class="points-pill${
                g.pointsAwarded === 12 ? " twelve" : ""
              }">${g.pointsAwarded}</span></td></tr>`;
            })
            .join("")}</tbody></table></details></td></tr>`
        : "";
      return `<tr${trClass}><td>${row.rank}</td><td>${c.flagEmoji} ${escapeHtml(
        c.country,
      )}</td><td>${escapeHtml(c.song)} · ${escapeHtml(c.artist)}</td><td class="points">${
        row.totalPoints
      }</td></tr>${drillSection}`;
    })
    .join("");

  return `<section class="leaderboard"><h2>${escapeHtml(
    t("leaderboard.heading"),
  )}</h2><table><thead><tr><th>${escapeHtml(t("leaderboard.rank"))}</th><th>${escapeHtml(
    t("leaderboard.country"),
  )}</th><th>${escapeHtml(t("leaderboard.song"))}</th><th>${escapeHtml(
    t("leaderboard.points"),
  )}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderAwards(data: DonePayload, t: BuildResultsHtmlDeps["t"]): string {
  if (data.awards.length === 0) {
    return `<section class="awards"><h2>${escapeHtml(
      t("awards.heading"),
    )}</h2><p>${escapeHtml(t("awards.empty"))}</p></section>`;
  }
  const memberById = new Map(data.members.map((m) => [m.userId, m]));
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const cards = data.awards
    .map((a) => {
      const winnerMember = a.winnerUserId ? memberById.get(a.winnerUserId) : null;
      const partner = a.winnerUserIdB ? memberById.get(a.winnerUserIdB) : null;
      const winnerContestant = a.winnerContestantId
        ? contestantById.get(a.winnerContestantId)
        : null;
      const winnerLabel = winnerMember
        ? partner
          ? `${escapeHtml(
              t("awards.jointWinners"),
            )}: ${escapeHtml(winnerMember.displayName)} &amp; ${escapeHtml(
              partner.displayName,
            )}`
          : escapeHtml(winnerMember.displayName)
        : winnerContestant
          ? `${winnerContestant.flagEmoji} ${escapeHtml(winnerContestant.country)}`
          : "";
      const drill = winnerContestant
        ? `<details><summary>${escapeHtml(
            t("categoryDrillDown.heading", { category: a.awardName }),
          )}</summary><p>${escapeHtml(
            t("categoryDrillDown.mean", { value: a.statValue?.toFixed(1) ?? "" }),
          )}</p></details>`
        : "";
      return `<article class="award"><h3>${escapeHtml(
        a.awardName,
      )} — ${winnerLabel}<span class="badge">${escapeHtml(
        t("awards.winner"),
      )}</span></h3>${drill}</article>`;
    })
    .join("");
  return `<section class="awards"><h2>${escapeHtml(
    t("awards.heading"),
  )}</h2>${cards}</section>`;
}

function renderBreakdowns(
  data: DonePayload,
  t: BuildResultsHtmlDeps["t"],
): string {
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const articles = data.breakdowns
    .map((b) => {
      const topPick = b.picks[0];
      const topCountry = topPick
        ? contestantById.get(topPick.contestantId)?.country ?? ""
        : "";
      const avatar = renderAvatarSvg(b.avatarSeed);
      const picksList = b.picks
        .map(
          (p) =>
            `<li>${p.pointsAwarded} — ${
              contestantById.get(p.contestantId)?.flagEmoji ?? ""
            } ${escapeHtml(contestantById.get(p.contestantId)?.country ?? "")}</li>`,
        )
        .join("");
      const ownVoteDetails = data.voteDetails.filter((v) => v.userId === b.userId);
      const drillRows = ownVoteDetails
        .sort((a, c) => c.pointsAwarded - a.pointsAwarded)
        .map((v) => {
          const c = contestantById.get(v.contestantId);
          if (!c) return "";
          return `<tr><td>${c.flagEmoji} ${escapeHtml(c.country)}</td><td><span class="${
            v.missed ? "chip chip--missed" : "chip"
          }">${v.missed ? "~" : ""}${computeWeightedScore(v.scores, data.categories).toFixed(
            1,
          )}</span></td><td><span class="points-pill${
            v.pointsAwarded === 12 ? " twelve" : ""
          }">${v.pointsAwarded}</span></td></tr>`;
        })
        .join("");
      const drill = drillRows
        ? `<details><summary>${escapeHtml(
            t("participantDrillDown.heading", { name: b.displayName }),
          )}</summary><table><tbody>${drillRows}</tbody></table></details>`
        : "";
      return `<article><h3><span class="avatar">${avatar}</span>${escapeHtml(
        t("breakdowns.topPick", {
          name: b.displayName,
          country: topCountry,
        }),
      )}</h3><ol class="picks">${picksList}</ol>${drill}</article>`;
    })
    .join("");
  return `<section class="breakdowns"><h2>${escapeHtml(
    t("breakdowns.heading"),
  )}</h2>${articles}</section>`;
}

function renderHotTakes(data: DonePayload, t: BuildResultsHtmlDeps["t"]): string {
  if (data.hotTakes.length === 0) {
    return `<section class="hot-takes"><h2>${escapeHtml(
      t("hotTakes.heading"),
    )}</h2><p class="empty">${escapeHtml(t("hotTakes.empty"))}</p></section>`;
  }
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const blocks = data.hotTakes
    .map((h) => {
      const c = contestantById.get(h.contestantId);
      const country = c ? `${c.flagEmoji} ${escapeHtml(c.country)}` : "";
      const editedTag = h.hotTakeEditedAt
        ? `<span class="edited">${escapeHtml(t("hotTakes.edited"))}</span>`
        : "";
      return `<blockquote><span class="author">${escapeHtml(
        h.displayName,
      )} → ${country} ${editedTag}</span>${escapeHtml(h.hotTake)}</blockquote>`;
    })
    .join("");
  return `<section class="hot-takes"><h2>${escapeHtml(
    t("hotTakes.heading"),
  )}</h2>${blocks}</section>`;
}

function renderFooter(
  data: DonePayload,
  t: BuildResultsHtmlDeps["t"],
  now: Date,
  appHostname: string,
): string {
  return `<footer>${escapeHtml(
    t("footer", {
      timestamp: now.toISOString(),
      hostname: appHostname,
      roomId: data.pin,
    }),
  )}</footer>`;
}

export function buildResultsHtml(
  data: DonePayload,
  deps: BuildResultsHtmlDeps,
): BuildResultsHtmlOutput {
  const now = deps.now();
  const title = escapeHtml(
    deps.t("title", { year: data.year, event: data.event, pin: data.pin }),
  );

  const body = [
    renderHeader(data, deps.t, now),
    `<main>`,
    renderLeaderboard(data, deps.t),
    renderAwards(data, deps.t),
    renderBreakdowns(data, deps.t),
    renderHotTakes(data, deps.t),
    `</main>`,
    renderFooter(data, deps.t, now, deps.appHostname),
  ].join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${EXPORT_STYLESHEET}</style></head><body>${body}</body></html>`;

  return {
    html,
    filename: buildFilename(data.year, data.event, data.pin),
    bytes: Buffer.byteLength(html, "utf8"),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/lib/export/buildResultsHtml.test.ts`
Expected: all 15 tests pass.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export/buildResultsHtml.ts src/lib/export/buildResultsHtml.test.ts
git commit -m "feat(export): buildResultsHtml renderer for R5 §12.3

Pure function: takes the done payload + a translator + injected clock
and returns { html, filename, bytes }. Inline stylesheet + DiceBear
avatars; emoji flags; section per leaderboard / awards / breakdowns /
hot takes; §12.6.1/§12.6.2/§12.6.3 drill-downs as collapsed <details>
blocks. Bets section suppressed until R7/V2.

Fixture-driven test asserts ≤300 KB on the canonical 15×26 room.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Route adapter `GET /api/results/[id]/export.html`

**Files:**
- Create: `src/app/api/results/[id]/export.html/route.ts`
- Create: `src/app/api/results/[id]/export.html/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/results/[id]/export.html/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";

const loadResultsMock = vi.fn();
const buildHtmlMock = vi.fn();
const getTranslationsMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock("@/lib/results/loadResults", () => ({
  loadResults: (...args: unknown[]) => loadResultsMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ __marker: "service" }),
}));

vi.mock("@/lib/contestants", () => ({
  fetchContestants: vi.fn(),
  fetchContestantsMeta: vi.fn(),
  ContestDataError: class extends Error {},
}));

vi.mock("@/lib/export/buildResultsHtml", () => ({
  buildResultsHtml: (...args: unknown[]) => buildHtmlMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

import { GET } from "@/app/api/results/[id]/export.html/route";
import { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/results/${VALID_ROOM_ID}/export.html`,
  );
}

const DONE_PAYLOAD = {
  status: "done",
  year: 2026,
  event: "final",
  pin: "TESTPN",
  ownerUserId: "u1",
  categories: [],
  leaderboard: [],
  contestants: [],
  breakdowns: [],
  contestantBreakdowns: [],
  hotTakes: [],
  awards: [],
  personalNeighbours: [],
  members: [],
  voteDetails: [],
};

beforeEach(() => {
  loadResultsMock.mockReset();
  buildHtmlMock.mockReset();
  getTranslationsMock.mockReset();
  cookiesMock.mockReset();
  cookiesMock.mockReturnValue({ get: () => undefined });
  getTranslationsMock.mockResolvedValue((key: string) => `en:${key}`);
});

describe("GET /api/results/[id]/export.html", () => {
  it("returns 200 with the rendered HTML on a done room", async () => {
    loadResultsMock.mockResolvedValue({ ok: true, data: DONE_PAYLOAD });
    buildHtmlMock.mockReturnValue({
      html: "<!DOCTYPE html><html></html>",
      filename: "emx-2026-final-TESTPN.html",
      bytes: 32,
    });

    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="emx-2026-final-TESTPN.html"',
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-content-bytes")).toBe("32");
    expect(await res.text()).toBe("<!DOCTYPE html><html></html>");
  });

  it("returns 409 results_not_ready when status is not done", async () => {
    loadResultsMock.mockResolvedValue({
      ok: true,
      data: { status: "announcing" },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("results_not_ready");
  });

  it("returns 400 for invalid UUIDs (passed through from loader)", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", message: "Bad room id." },
    });
    const res = await GET(makeRequest(), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when room missing", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 500 on loader internal error", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR", message: "DB down." },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(500);
  });

  it("resolves locale from the NEXT_LOCALE cookie when present", async () => {
    cookiesMock.mockReturnValue({
      get: (name: string) => (name === "NEXT_LOCALE" ? { value: "es" } : undefined),
    });
    loadResultsMock.mockResolvedValue({ ok: true, data: DONE_PAYLOAD });
    buildHtmlMock.mockReturnValue({ html: "<html></html>", filename: "x.html", bytes: 13 });

    await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(getTranslationsMock).toHaveBeenCalledWith({
      locale: "es",
      namespace: "export",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/app/api/results/[id]/export.html/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/results/[id]/export.html/route.ts`:

```ts
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { loadResults } from "@/lib/results/loadResults";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchContestants, fetchContestantsMeta } from "@/lib/contestants";
import { buildResultsHtml } from "@/lib/export/buildResultsHtml";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
} from "@/i18n/config";

const APP_HOSTNAME =
  process.env.NEXT_PUBLIC_APP_HOSTNAME ?? "eurovisionmaxxing.com";

function resolveLocale(): string {
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * GET /api/results/{id}/export.html
 *
 * Self-contained HTML export per SPEC §12.3. Requires rooms.status='done';
 * returns 409 results_not_ready for any earlier status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const result = await loadResults(
    { roomId: params.id },
    {
      supabase: createServiceClient(),
      fetchContestants,
      fetchContestantsMeta,
    },
  );

  if (!result.ok) {
    return apiError(
      result.error.code,
      result.error.message,
      result.status,
      result.error.field,
    );
  }
  if (result.data.status !== "done") {
    return apiError("INTERNAL_ERROR", "Results not ready.", 409);
    // NOTE: the spec calls for code 'results_not_ready'; we forward the
    // generic INTERNAL_ERROR slot until that code is added to ApiErrorCode.
    // See follow-on: extend ApiErrorCode union.
  }

  const locale = resolveLocale();
  const t = await getTranslations({ locale, namespace: "export" });

  const { html, filename, bytes } = buildResultsHtml(result.data, {
    t: (key, params) => t(key, params as Record<string, unknown> | undefined),
    now: () => new Date(),
    appHostname: APP_HOSTNAME,
  });

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

- [ ] **Step 4: Fix the 409 code**

The route currently returns `INTERNAL_ERROR` with status 409 — wrong. Two-step fix:

(a) Edit `src/lib/api-errors.ts` to add `"RESULTS_NOT_READY"` to the `ApiErrorCode` union:

```ts
export type ApiErrorCode =
  | "INVALID_BODY"
  // ... existing codes ...
  | "RESULTS_NOT_READY"
  | "INTERNAL_ERROR";
```

(b) Edit the route's 409 branch:

```ts
if (result.data.status !== "done") {
  return apiError("RESULTS_NOT_READY", "Results not ready.", 409);
}
```

(c) Update the route test assertion:

```ts
expect(body.error.code).toBe("RESULTS_NOT_READY");
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/app/api/results/[id]/export.html/route.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 6: Type-check + full test suite**

Run: `npm run type-check && npm run test`
Expected: clean type-check; full suite passes (including the existing locales.test that's about to fail in Task 9).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/results/[id]/export.html/route.ts \
        src/app/api/results/[id]/export.html/route.test.ts \
        src/lib/api-errors.ts
git commit -m "feat(api): GET /api/results/[id]/export.html route adapter

Thin wrapper around loadResults + buildResultsHtml + getTranslations.
Locale from NEXT_LOCALE cookie, fallback to en. Headers per SPEC §12.3:
Content-Type text/html, Content-Disposition attachment with sanitised
filename, Cache-Control public max-age=300 (conservative until we audit
post-done write paths), X-Content-Bytes observability.

Adds RESULTS_NOT_READY to ApiErrorCode union for the 409 path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `export.*` locale namespace

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`, `uk.json`, `fr.json`, `de.json`

- [ ] **Step 1: Add the `export.*` namespace to `en.json`**

Locate the top-level object in `src/locales/en.json` and insert (alphabetical placement after the `errors` block is conventional; place it adjacent to any existing `results.*` or `share.*` namespace):

```json
"export": {
  "title": "Eurovision {year} {event} — Room {pin}",
  "header": {
    "generatedAt": "Generated {timestamp}"
  },
  "leaderboard": {
    "heading": "Leaderboard",
    "rank": "#",
    "country": "Country",
    "song": "Song · Artist",
    "points": "Points",
    "voter": "Voter"
  },
  "contestantDrillDown": {
    "heading": "Who voted for {country}?",
    "voter": "Voter",
    "weightedScore": "Weighted {value}",
    "points": "Points",
    "missed": "Missed",
    "edited": "(edited)"
  },
  "participantDrillDown": {
    "heading": "{name}'s full vote",
    "weightedScore": "Weighted {value}",
    "missed": "Missed"
  },
  "categoryDrillDown": {
    "heading": "Full {category} ranking",
    "mean": "Mean {value}",
    "voters": "{voted}/{total} voted"
  },
  "breakdowns": {
    "heading": "Per-voter breakdowns",
    "topPick": "{name}'s 12 points went to {country}"
  },
  "awards": {
    "heading": "Awards",
    "winner": "Winner",
    "jointWinners": "Joint winners",
    "empty": "No awards computed."
  },
  "hotTakes": {
    "heading": "Hot takes",
    "empty": "No hot takes saved this round.",
    "edited": "(edited)"
  },
  "footer": "Generated {timestamp} · {hostname}/results/{roomId}"
}
```

- [ ] **Step 2: Copy the same `export.*` block verbatim into the other four locales**

Open each of `src/locales/es.json`, `uk.json`, `fr.json`, `de.json` and add the identical `export.*` block. Using English copy as the stub keeps `locales.test.ts` parity-green; the L3 follow-on slice translates each locale properly (same workflow as every prior namespace).

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including:
- `locales.test.ts` parity assertions (all five locales now have the new keys)
- `buildResultsHtml.test.ts` (already passing with mock `t`)
- `route.test.ts` (already passing with mock `getTranslations`)

- [ ] **Step 4: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en.json src/locales/es.json src/locales/uk.json \
        src/locales/fr.json src/locales/de.json
git commit -m "i18n: export.* locale namespace for R5 §12.3 HTML export

English copy in en.json; same English text duplicated as stubs in es/
uk/fr/de to keep locales.test.ts key-parity green. L3 translation pass
is a Phase L follow-on slice — same workflow as every prior namespace
(SPEC §21).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full suite + type-check + lint**

```bash
npm run pre-push
```

Expected: clean type-check, lint, and 100% test pass.

- [ ] **Manual smoke (optional)**

If a seeded `done` room is available (see `scripts/seed-room.ts` state `done-with-awards`):

```bash
npm run seed:room -- done-with-awards
# note the room id from output, then:
curl -i http://localhost:3000/api/results/<room-id>/export.html
```

Expected: HTTP 200, `Content-Type: text/html`, `Content-Disposition: attachment; filename="emx-9999-final-...html"`, body starts with `<!DOCTYPE html>`. Save to a file and open in a browser to eyeball the layout.

- [ ] **Push the branch**

```bash
git push -u origin feat/r5-html-export
```

---

## Self-review check (do BEFORE Task 1 starts)

A future reader (you, in 3 days, or a fresh subagent dispatched into one task) should be able to:

1. Open the spec doc and the plan side-by-side and see every spec requirement mapped to a task.
2. Run each Task end-to-end without referencing the prior task's code (each step shows the actual code).
3. Find every file path is absolute from the repo root; no `<placeholder>`s, no "TBD"s.

If any of those fail, fix inline before handing off.

---

## Spec coverage check

- ✅ Self-contained HTML, inline CSS, no JS → Task 4 (stylesheet) + Task 7 (renderer)
- ✅ 409 if not `done` → Task 8 (route)
- ✅ Filename `emx-{year}-{event}-{pin}.html` → Task 7 (renderer `buildFilename`)
- ✅ `Content-Disposition` attachment → Task 8 (route)
- ✅ 300 KB budget asserted by CI fixture → Task 7 (test on FIXTURE_DONE_15x26)
- ✅ Footer with generated-at + hostname/results/{id} → Task 7 (renderFooter)
- ✅ Drill-downs §12.6.1, §12.6.2, §12.6.3 inline as `<details>` → Task 7
- ✅ DiceBear avatars inlined → Task 1 (deps) + Task 5 (renderer)
- ✅ Unicode flag emoji → Task 7 (uses `contestant.flagEmoji` directly)
- ✅ `voteDetails` payload extension → Task 2
- ✅ Locale via `NEXT_LOCALE` cookie → Task 8
- ✅ Bets section suppressed (R7/V2 forward-compat) → Task 7 (no `bets` rendering branch wired today)
- ✅ `Cache-Control: public, max-age=300` → Task 8
- ✅ `X-Content-Bytes` header → Task 8

No gaps.
