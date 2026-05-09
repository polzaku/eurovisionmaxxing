import { test, expect } from "@playwright/test";

/**
 * R6 §5.1e — /create wizard contestant-fetch state machine.
 *
 * The wizard's debounce → slow → timeout → abort flow is timer-driven
 * (5 s slow cue, 10 s hard cut). RTL covers the discrete renders, but
 * only a real browser exercises the actual `setTimeout` clocks in the
 * order users see them. This spec stubs `/api/contestants` via
 * `page.route` so we can either fulfil immediately (happy path) or
 * delay long enough to walk through the slow + timeout transitions.
 *
 * Session is seeded via `localStorage.emx_session` so the page guard
 * (`/onboard?next=/create`) doesn't redirect us out before the wizard
 * mounts — same trick the awards-ceremony spec uses.
 */

const SESSION_STUB = {
  userId: "33333333-3333-3333-3333-333333333333",
  rejoinToken: "stub-rejoin-token",
  displayName: "Alice",
  avatarSeed: "alice",
  expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
};

const TWENTY_SIX_CONTESTANTS = Array.from({ length: 26 }, (_, i) => ({
  id: `2026-c${i}`,
  year: 2026,
  event: "final",
  countryCode: `c${i}`,
  country: `Country ${i}`,
  artist: `Artist ${i}`,
  song: `Song ${i}`,
  flagEmoji: "🏳️",
  runningOrder: i + 1,
}));

test.describe("/create wizard — contestant fetch state machine", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((session) => {
      window.localStorage.setItem("emx_session", JSON.stringify(session));
    }, SESSION_STUB);
  });

  test("happy path: 200 response renders the country count", async ({
    page,
  }) => {
    await page.route("**/api/contestants**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ contestants: TWENTY_SIX_CONTESTANTS }),
      });
    });

    await page.goto("/create");

    await expect(page.getByText(/26 countries loaded/i)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole("button", { name: /Next/ })).toBeEnabled();
  });

  test("slow → timeout: delaying past 10 s walks through both transitions", async ({
    page,
  }, testInfo) => {
    // This test deliberately observes real-clock timing (5 s slow cue,
    // 10 s hard cut). Bump the per-test timeout above the default 30 s
    // so we have headroom for the full sequence + a small buffer.
    testInfo.setTimeout(45_000);

    await page.route("**/api/contestants**", async (route) => {
      // Hold the response open past the wizard's 10 s hard timeout so
      // the AbortController fires before fulfilment. The wizard never
      // sees this body — it renders the timeout copy instead.
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ contestants: TWENTY_SIX_CONTESTANTS }),
      });
    });

    await page.goto("/create");

    // Loading copy should be visible immediately after the 300 ms debounce.
    await expect(page.getByText(/Loading contestants/i)).toBeVisible({
      timeout: 3_000,
    });

    // Slow cue lands at the 5 s mark.
    await expect(page.getByTestId("contestants-slow")).toBeVisible({
      timeout: 7_000,
    });
    await expect(
      page.getByText(/Loading is taking longer than usual/i),
    ).toBeVisible();

    // Hard timeout fires at the 10 s mark; the slow node is replaced with
    // an actionable timeout alert.
    await expect(page.getByTestId("contestants-timeout")).toBeVisible({
      timeout: 8_000,
    });
    await expect(
      page.getByText(/taking too long\. Try again/i),
    ).toBeVisible();
    // Next stays disabled — the wizard never reached the `ready` state.
    await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  test("changing year mid-flight aborts the in-flight fetch and starts a new one", async ({
    page,
  }) => {
    // Track every fetched year so we can assert the second one wins after
    // the in-flight request is aborted.
    const yearsSeen: number[] = [];

    await page.route("**/api/contestants**", async (route) => {
      const url = new URL(route.request().url());
      const year = Number(url.searchParams.get("year"));
      yearsSeen.push(year);
      // The first request hangs for 3 s — long enough for us to scrub the
      // year picker before it returns. The second request fulfils fast.
      const isFirst = yearsSeen.length === 1;
      if (isFirst) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ contestants: TWENTY_SIX_CONTESTANTS }),
      });
    });

    await page.goto("/create");

    // Wait for the loading state on year=2026 (default; current UTC year).
    await expect(page.getByText(/Loading contestants/i)).toBeVisible();

    // Scrub to a different year while the first request is still hanging.
    await page.getByLabel(/Year/i).selectOption("2025");

    // The wizard should ultimately settle on `ready` — the aborted
    // first request never gets to render an error.
    await expect(page.getByText(/26 countries loaded/i)).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId("contestants-timeout")).toHaveCount(0);

    // Both years were requested — the second one is what won.
    expect(yearsSeen).toContain(2025);
  });
});
