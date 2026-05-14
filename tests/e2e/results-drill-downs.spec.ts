import { test, expect } from "@playwright/test";

/**
 * SPEC §12.6 drill-down sheets on `/results/[id]`.
 *
 * **Currently `test.describe.skip(...)`.** `/results/[id]` is a Server
 * Component that calls `loadResults()` SSR via the Supabase service client.
 * The existing E2E pattern in this repo (`tests/e2e/awards-ceremony.spec.ts`,
 * `tests/e2e/your-neighbour-award.spec.ts`) stubs API fetches with
 * `page.route`, which works for the `/room/[id]` flow because that page is
 * a client component fetching `/api/results/[id]`. The static results page
 * has no such fetch to intercept — it would need either a test-mode DB
 * seed or a server-side stubbing mechanism. The repo doesn't have one yet,
 * so this spec is parked until a seeded test fixture lands.
 *
 * **Coverage parity.** All assertions below are exhaustively covered by
 * the RTL + integration test suite:
 *
 *  - DrillDownSheet dialog mechanics (open / ESC / backdrop / X / focus /
 *    aria-modal / aria-labelledby) — `DrillDownSheet.test.tsx` (8 cases)
 *  - ContestantDrillDownBody render — `ContestantDrillDownBody.test.tsx`
 *  - ParticipantDrillDownBody render — `ParticipantDrillDownBody.test.tsx`
 *  - CategoryDrillDownBody render — `CategoryDrillDownBody.test.tsx`
 *  - <Breakdowns> avatar button + stopPropagation — `Breakdowns.test.tsx`
 *  - Trigger wiring (only one sheet open at a time) — `DrillDownClient.test.tsx`
 *
 *  E2E gap: real browser layout (max-height / scroll under iOS rubber-band),
 *  cross-window backdrop click coordinates, real focus-restoration timing.
 */

test.describe.skip("/results/[id] drill-down sheets (SPEC §12.6)", () => {
  // Expected coverage when the SSR-stubbing story lands. Each block maps 1:1
  // to a documented surface in SPEC §12.6.{1,2,3} plus the close-path matrix.

  test("contestant sheet opens via 'Full breakdown' link and closes via X", async ({ page }) => {
    void page;
    expect(true).toBe(true);
  });

  test("participant sheet opens via avatar button and closes via ESC", async ({ page }) => {
    void page;
    expect(true).toBe(true);
  });

  test("category sheet opens via 'Full ranking' link and closes via backdrop click", async ({ page }) => {
    void page;
    expect(true).toBe(true);
  });

  test("only one sheet open at a time — opening a second replaces the first", async ({ page }) => {
    void page;
    expect(true).toBe(true);
  });

  test("reduced-motion: sheets still open and close (no fade animation)", async ({ page }) => {
    void page;
    expect(true).toBe(true);
  });

  test("keyboard nav: Tab → Enter → Tab through sheet → ESC restores focus to trigger", async ({ page }) => {
    void page;
    expect(true).toBe(true);
  });
});
