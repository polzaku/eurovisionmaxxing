import { test, expect } from "@playwright/test";
import {
  ROOM_ID,
  USER_ID,
  SCORING_ROOM_INSTANT,
} from "./fixtures/voting-room";

const ANNOUNCING_ROOM_LIVE = {
  ...SCORING_ROOM_INSTANT,
  room: {
    ...SCORING_ROOM_INSTANT.room,
    status: "announcing",
    announcementMode: "live",
    announcingUserId: USER_ID,
    currentAnnounceIdx: 0,
  },
};

const ANNOUNCING_RESULTS_LIVE = {
  status: "announcing",
  leaderboard: [],
  announcement: {
    announcingUserId: USER_ID,
    announcingDisplayName: "Alice",
    announcingAvatarSeed: "alice",
    currentAnnounceIdx: 0,
    pendingReveal: { contestantId: "2026-SE", points: 1 },
    queueLength: 10,
    delegateUserId: null,
    announcerPosition: 1,
    announcerCount: 1,
    skippedUserIds: [],
  },
};

/**
 * TV-mode chooser surface (2026-05-15 follow-up).
 *
 * The original Fix 6 placed an inline "Open TV mode" CTA on the
 * sub-second scoring screen, which flashed by before the host could
 * interact with it. The chooser now lives as a non-modal banner at the
 * top of `<AnnouncingView>` for the host. Two explicit choices,
 * persisted across refresh via sessionStorage.
 */
test.describe("host TV-mode chooser banner", () => {
  test("host on a live announcing room sees the chooser with Open + Skip CTAs", async ({
    page,
  }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANNOUNCING_ROOM_LIVE),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANNOUNCING_RESULTS_LIVE),
      });
    });

    await page.addInitScript(
      ({ userId }) => {
        const session = {
          userId,
          rejoinToken: "stub-rejoin-token",
          displayName: "Alice",
          avatarSeed: "alice",
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        };
        window.localStorage.setItem("emx_session", JSON.stringify(session));
      },
      { userId: USER_ID },
    );

    await page.goto(`/room/${ROOM_ID}`);

    const chooser = page.getByTestId("tv-mode-chooser");
    await expect(chooser).toBeVisible({ timeout: 15_000 });

    const openLink = page.getByRole("link", { name: /Open TV mode/i });
    await expect(openLink).toHaveAttribute(
      "href",
      `/room/${ROOM_ID}/present`,
    );
    await expect(openLink).toHaveAttribute("target", "_blank");

    await expect(
      page.getByRole("button", { name: /Continue on phone/i }),
    ).toBeVisible();
  });

  test("clicking 'Continue on phone' dismisses the chooser + persists 'skip'", async ({
    page,
  }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANNOUNCING_ROOM_LIVE),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANNOUNCING_RESULTS_LIVE),
      });
    });
    await page.addInitScript(
      ({ userId }) => {
        const session = {
          userId,
          rejoinToken: "stub-rejoin-token",
          displayName: "Alice",
          avatarSeed: "alice",
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        };
        window.localStorage.setItem("emx_session", JSON.stringify(session));
      },
      { userId: USER_ID },
    );

    await page.goto(`/room/${ROOM_ID}`);
    await expect(page.getByTestId("tv-mode-chooser")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /Continue on phone/i }).click();

    await expect(page.getByTestId("tv-mode-chooser")).toHaveCount(0);

    // sessionStorage choice was persisted so the chooser stays gone
    // after a refresh.
    const choice = await page.evaluate(
      (id) => window.sessionStorage.getItem(`emx_tv_choice_${id}`),
      ROOM_ID,
    );
    expect(choice).toBe("skip");

    await page.reload();
    await expect(page.getByTestId("tv-mode-chooser")).toHaveCount(0);
  });

  test("non-admin viewers do not see the chooser", async ({ page }) => {
    const NON_OWNER_ID = "99999999-9999-9999-9999-999999999999";

    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANNOUNCING_ROOM_LIVE),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...ANNOUNCING_RESULTS_LIVE,
          announcement: {
            ...ANNOUNCING_RESULTS_LIVE.announcement,
            // Owner (USER_ID) is the announcer; the page viewer is a
            // different user, so they should NOT see the chooser.
          },
        }),
      });
    });
    await page.addInitScript(
      ({ userId }) => {
        const session = {
          userId,
          rejoinToken: "stub-rejoin-token",
          displayName: "Bob",
          avatarSeed: "bob",
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        };
        window.localStorage.setItem("emx_session", JSON.stringify(session));
      },
      { userId: NON_OWNER_ID },
    );

    await page.goto(`/room/${ROOM_ID}`);
    // Wait for the announcing view to render before asserting absence.
    await expect(page.locator("main").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("tv-mode-chooser")).toHaveCount(0);
  });
});
