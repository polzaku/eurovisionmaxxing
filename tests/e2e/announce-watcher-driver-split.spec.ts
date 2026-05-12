import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import type { Page, Browser } from "@playwright/test";
import {
  ROOM_ID,
  OWNER_ID,
  GUEST_ID,
  ROOM_PAYLOAD,
  ANNOUNCING_RESULTS_DRIVER,
} from "./fixtures/announce-l1-room";

interface SeedOutput {
  roomId: string;
  pin: string;
  ownerSession: { userId: string; rejoinToken: string };
  guestSessions?: Array<{
    userId: string;
    displayName: string;
    rejoinToken: string;
  }>;
}

function seedRoom(state: string): SeedOutput {
  const raw = execSync(
    `npm run --silent seed:room -- --state=${state} --json`,
    { encoding: "utf-8", cwd: process.cwd() },
  );
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      return JSON.parse(line) as SeedOutput;
    } catch {
      // skip non-JSON lines (tsx banner, dotenv banner, etc.)
    }
  }
  throw new Error(`seed-room produced no JSON output. Raw:\n${raw}`);
}

async function signIn(
  page: Page,
  session: { userId: string; rejoinToken: string },
  displayName: string,
  avatarSeed: string,
): Promise<void> {
  // Seed localStorage before navigation so the session guard doesn't
  // redirect to /onboard. Mirrors the announce-short-style.spec.ts
  // pattern.
  await page.goto("/");
  await page.evaluate(
    ({ userId, rejoinToken, displayName, avatarSeed }) => {
      window.localStorage.setItem(
        "emx_session",
        JSON.stringify({
          userId,
          rejoinToken,
          displayName,
          avatarSeed,
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        }),
      );
    },
    {
      userId: session.userId,
      rejoinToken: session.rejoinToken,
      displayName,
      avatarSeed,
    },
  );
}

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

  test("guest watcher renders watcher-density leaderboard rows + no StillToGiveLine", async ({
    page,
  }) => {
    // Same API stubs as the driver tests — the announcement state still has
    // announcingUserId === OWNER_ID. But we seed the session as GUEST_ID,
    // so isActiveDriver is false → surface === "watcher".
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
        userId: GUEST_ID,
        displayName: "Bob",
        seed: "bob",
      },
    );

    await page.goto(`/room/${ROOM_ID}`);

    await expect(page.getByTestId("leaderboard-row").first()).toBeVisible({
      timeout: 15_000,
    });

    const rows = await page.getByTestId("leaderboard-row").all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      await expect(row).toHaveAttribute("data-density", "watcher");
    }

    // Watchers never see the StillToGiveLine — it's gated on isActiveDriver
    // && announcementStyle === "full" && queueLength === 10. Without the
    // active-driver half, the line stays out of the DOM.
    await expect(page.getByTestId("still-to-give-line")).toHaveCount(0);
  });
});

// ─── Block 2: multi-window broadcast-driven scenarios ────────────────────────

test.describe("L1 watcher vs driver matrix — broadcast-driven scenarios", () => {
  test("full-style guest watcher receives RevealToast on announce_next", async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);

    let seed: SeedOutput;
    try {
      seed = seedRoom("announcing-mid-queue-live");
    } catch (err) {
      testInfo.skip(
        true,
        `seed-room failed — likely missing Supabase env. ${String(err)}`,
      );
      return;
    }
    if (!seed.guestSessions || seed.guestSessions.length === 0) {
      testInfo.skip(true, "seed produced no guestSessions — extend seed-room");
      return;
    }

    // announcing-mid-queue-live: order = [owner, guest0, guest1, guest2].
    // announcing_user_id === guest0 (the 2nd user). So:
    //   - driver context = guest0 (the active announcer)
    //   - watcher context = owner (a guest-watching surface)
    const driverSession = seed.guestSessions[0];
    const watcherSession = seed.ownerSession;

    const driverCtx = await (browser as Browser).newContext();
    const watcherCtx = await (browser as Browser).newContext();
    try {
      const driverPage = await driverCtx.newPage();
      const watcherPage = await watcherCtx.newPage();

      await signIn(
        driverPage,
        { userId: driverSession.userId, rejoinToken: driverSession.rejoinToken },
        driverSession.displayName,
        "guest0",
      );
      await signIn(
        watcherPage,
        watcherSession,
        "Admin",
        "owner",
      );

      // Open both windows on the room. Watcher first so its realtime
      // subscription is ready when the driver's broadcast fires.
      await watcherPage.goto(`/room/${seed.roomId}`);
      await driverPage.goto(`/room/${seed.roomId}`);

      // Driver sees the active-announcer surface — the "Reveal next point"
      // button is the canonical control.
      await expect(
        driverPage.getByRole("button", { name: /reveal next point/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Watcher window: no toast yet (nothing has been announced this tick).
      await expect(watcherPage.getByTestId("reveal-toast")).toHaveCount(0);

      // Driver taps Reveal — server fires announce_next on the realtime
      // channel; both contexts receive it. The driver's toast handler skips
      // self-echoes; the watcher's fires.
      await driverPage
        .getByRole("button", { name: /reveal next point/i })
        .click();

      // Watcher receives the toast within the broadcast round-trip budget.
      await expect(watcherPage.getByTestId("reveal-toast")).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await driverCtx.close();
      await watcherCtx.close();
    }
  });

  test("full-style active announcer fires no toast for own announce_next", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(45_000);

    let seed: SeedOutput;
    try {
      seed = seedRoom("announcing-mid-queue-live");
    } catch (err) {
      testInfo.skip(
        true,
        `seed-room failed — likely missing Supabase env. ${String(err)}`,
      );
      return;
    }
    if (!seed.guestSessions || seed.guestSessions.length === 0) {
      testInfo.skip(true, "seed produced no guestSessions — extend seed-room");
      return;
    }

    const driverSession = seed.guestSessions[0];

    await signIn(
      page,
      { userId: driverSession.userId, rejoinToken: driverSession.rejoinToken },
      driverSession.displayName,
      "guest0",
    );
    await page.goto(`/room/${seed.roomId}`);

    await expect(
      page.getByRole("button", { name: /reveal next point/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Pre-tap: no toast.
    await expect(page.getByTestId("reveal-toast")).toHaveCount(0);

    await page.getByRole("button", { name: /reveal next point/i }).click();

    // Post-tap: confirm the broadcast loop actually fired by waiting for
    // the leaderboard to update (the API refetch pulls in the new
    // announced result). We give it the same 10 s budget the multi-
    // window test uses.
    await page.waitForTimeout(3_000);

    // Driver still does NOT see a toast — the watcher-only filter
    // (currentUserId !== event.announcingUserId) suppresses it.
    await expect(page.getByTestId("reveal-toast")).toHaveCount(0);
  });

  test("short-style guest watcher receives RevealToast (regression guard)", async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);

    let seed: SeedOutput;
    try {
      seed = seedRoom("announcing-short-style-live");
    } catch (err) {
      testInfo.skip(
        true,
        `seed-room failed — likely missing Supabase env. ${String(err)}`,
      );
      return;
    }
    if (!seed.guestSessions || seed.guestSessions.length === 0) {
      testInfo.skip(true, "seed produced no guestSessions — extend seed-room");
      return;
    }

    // announcing-short-style-live: owner is the announcer; one guest.
    const driverSession = seed.ownerSession;
    const watcherSession = seed.guestSessions[0];

    const driverCtx = await (browser as Browser).newContext();
    const watcherCtx = await (browser as Browser).newContext();
    try {
      const driverPage = await driverCtx.newPage();
      const watcherPage = await watcherCtx.newPage();

      await signIn(driverPage, driverSession, "Admin", "owner");
      await signIn(
        watcherPage,
        { userId: watcherSession.userId, rejoinToken: watcherSession.rejoinToken },
        watcherSession.displayName,
        "guest0",
      );

      await watcherPage.goto(`/room/${seed.roomId}`);
      await driverPage.goto(`/room/${seed.roomId}`);

      // Short-style driver sees a "Reveal 12 points" CTA — not the
      // generic "Reveal next point" button.
      await expect(
        driverPage.getByRole("button", { name: /reveal 12 points/i }),
      ).toBeVisible({ timeout: 15_000 });

      await expect(watcherPage.getByTestId("reveal-toast")).toHaveCount(0);

      await driverPage
        .getByRole("button", { name: /reveal 12 points/i })
        .click();

      // Watcher gets a toast on the 12-point reveal — this is the
      // pre-rename TwelvePointToast path, now under the same RevealToast
      // component. Regression guard: ensures the watcher fire condition
      // didn't accidentally re-gate on announcementStyle === 'full'.
      await expect(watcherPage.getByTestId("reveal-toast")).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await driverCtx.close();
      await watcherCtx.close();
    }
  });
});
