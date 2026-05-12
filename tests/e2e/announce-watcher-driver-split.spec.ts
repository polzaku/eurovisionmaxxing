import { test, expect } from "@playwright/test";
import {
  ROOM_ID,
  OWNER_ID,
  ROOM_PAYLOAD,
  ANNOUNCING_RESULTS_DRIVER,
} from "./fixtures/announce-l1-room";

/**
 * L1 watcher-vs-driver surface differentiation — Playwright E2E.
 *
 * This spec pins the two most observable per-surface deltas that are
 * testable today in a single browser window:
 *
 *   1. Active driver (full-style, queueLength === 10) sees `<StillToGiveLine>`
 *      with the correct given / remaining split at currentAnnounceIdx === 3.
 *   2. Active driver's leaderboard rows carry `data-density="driver"`.
 *
 * The complementary watcher-surface assertions (RevealToast on announce_next,
 * data-density="watcher" rows) require a second browser context subscribed to
 * the same Supabase Realtime channel — that infra isn't wired yet. Those
 * scenarios are documented and skipped in Block 2 below.
 *
 * Auth + payloads are stubbed via `page.route()` and `page.addInitScript()`;
 * no real Supabase env or DB seeding is required for Block 1.
 */

// ─── Block 1: single-window active-driver scenarios ──────────────────────────
// These tests run today. They mock /api/rooms and /api/results via page.route()
// and seed owner session in localStorage so the room page sees the owner
// (OWNER_ID) as the current user. Because OWNER_ID === announcingUserId and
// delegateUserId is null, isActiveDriver is true → driver surface renders.

test.describe("L1 active driver surface — single window", () => {
  test("full-style active announcer sees StillToGiveLine with strike-through split", async ({
    page,
  }) => {
    // Stub the two API endpoints the room page fetches on mount.
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ROOM_PAYLOAD),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANNOUNCING_RESULTS_DRIVER),
      });
    });

    // Seed owner session in localStorage before navigation so the session
    // guard doesn't redirect to /onboard.
    await page.addInitScript(
      ({ userId, displayName, seed }) => {
        const session = {
          userId,
          rejoinToken: "stub-rejoin-token",
          displayName,
          avatarSeed: seed,
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        };
        window.localStorage.setItem("emx_session", JSON.stringify(session));
      },
      {
        userId: OWNER_ID,
        displayName: "Alice",
        seed: "alice",
      },
    );

    await page.goto(`/room/${ROOM_ID}`);

    // StillToGiveLine must appear. Budget 15s for the initial API fetch +
    // React render cycle.
    await expect(page.getByTestId("still-to-give-line")).toBeVisible({
      timeout: 15_000,
    });

    // currentAnnounceIdx === 3 → given = [1, 2, 3]
    for (const p of [1, 2, 3]) {
      await expect(page.getByTestId(`stg-given-${p}`)).toBeVisible();
    }

    // remaining = [4, 5, 6, 7, 8, 10, 12]
    for (const p of [4, 5, 6, 7, 8, 10, 12]) {
      await expect(page.getByTestId(`stg-remaining-${p}`)).toBeVisible();
    }
  });

  test("full-style active driver renders driver-density leaderboard rows", async ({
    page,
  }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ROOM_PAYLOAD),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANNOUNCING_RESULTS_DRIVER),
      });
    });

    await page.addInitScript(
      ({ userId, displayName, seed }) => {
        const session = {
          userId,
          rejoinToken: "stub-rejoin-token",
          displayName,
          avatarSeed: seed,
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        };
        window.localStorage.setItem("emx_session", JSON.stringify(session));
      },
      {
        userId: OWNER_ID,
        displayName: "Alice",
        seed: "alice",
      },
    );

    await page.goto(`/room/${ROOM_ID}`);

    // Wait for at least one leaderboard row to be present.
    await expect(page.getByTestId("leaderboard-row").first()).toBeVisible({
      timeout: 15_000,
    });

    const rows = await page.getByTestId("leaderboard-row").all();
    expect(rows.length).toBeGreaterThan(0);

    // Every row must carry data-density="driver" when the active driver
    // surface is rendered (LeaderboardRow receives density={surface} where
    // surface === "driver" when isActiveDriver is true).
    for (const row of rows) {
      await expect(row).toHaveAttribute("data-density", "driver");
    }
  });
});

// ─── Block 2: multi-window watcher-vs-driver matrix (SKIPPED) ────────────────
//
// Cross-window broadcast capture isn't wired yet — the watcher behavior
// requires two browser contexts subscribed to the same Supabase Realtime
// channel, with announce_next firing from window A and visual assertion in
// window B. The existing pattern in `your-neighbour-award.spec.ts` for
// skipped specs is documentation-first; unskip when multi-window infra lands
// (the Phase 0 TODO at line 27 calls this out as the original Playwright slot).

test.describe.skip("L1 watcher vs driver matrix — multi-window scenarios", () => {
  test("full-style guest watcher receives toast on announce_next, no flash card", async ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    page,
  }) => {
    // Needs: two browser contexts. Window A (owner/driver) triggers
    // announce_next; Window B (guest/watcher) asserts:
    //   - page.getByTestId("reveal-toast") is visible within 3s
    //   - no element with data-testid="active-driver-tap-zone" (the flash
    //     card is only for the driver)
    // Missing infra: multi-context Realtime subscription + broadcast capture.
    test.fixme(true, "Requires multi-window broadcast capture infra");
  });

  test("full-style active announcer fires no toast for own announce_next", async ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    page,
  }) => {
    // Needs: the driver window's own announce_next event must NOT produce a
    // RevealToast — the driver sees the JustRevealedFlash card instead.
    // Assert: after clicking Reveal, reveal-toast count === 0 while
    // active-driver-tap-zone is visible.
    // Missing infra: real Supabase realtime + DB seeding for advanceAnnouncement.
    test.fixme(true, "Requires real Supabase realtime + DB seeding");
  });

  test("short-style guest watcher receives toast (regression for shipped short-style path)", async ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    page,
  }) => {
    // SPEC §10.2.2 — non-drivers get a RevealToast on every announce_next
    // regardless of announcementStyle (full or short). This test guards
    // against a regression where watcher toast was accidentally gated on
    // announcementStyle === 'full'.
    // Missing infra: multi-context Realtime subscription.
    test.fixme(true, "Requires multi-window broadcast capture infra");
  });

  test("watcher surface renders leaderboard rows with data-density='watcher'", async ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    page,
  }) => {
    // Guest session (GUEST_ID !== OWNER_ID/announcingUserId) → isActiveDriver
    // is false → surface === "watcher" → LeaderboardRow data-density="watcher".
    // This requires the /api/results route to return a live announcement so
    // the leaderboard renders; with stubbed APIs this should be single-window
    // testable but the LeaderboardRow only populates after the on-mount
    // /api/results fetch returns, so it needs a real Supabase endpoint or the
    // same page.route() stub used in Block 1 — promote to Block 1 when ready.
    test.fixme(
      true,
      "Promote to Block 1 once guest-session page.route() path is verified",
    );
  });
});
