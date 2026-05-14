import { test, expect } from "@playwright/test";
import {
  ROOM_ID,
  USER_ID,
  SCORING_ROOM_LIVE,
  SCORING_ROOM_INSTANT,
} from "./fixtures/voting-room";

/**
 * Fix 6 (2026-05-14): after the host ends voting on a `live` room the
 * scoring screen surfaces a prominent "Open TV mode" CTA pointing at
 * `/room/{id}/present`. Suppressed for `instant` rooms and for non-admin
 * viewers.
 */
test.describe("host TV-mode CTA on the scoring screen", () => {
  test("admin on a live room sees the Open-TV CTA pointing at /present", async ({
    page,
  }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SCORING_ROOM_LIVE),
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

    // Scoring screen renders.
    await expect(page.getByTestId("scoring-screen")).toBeVisible({
      timeout: 15_000,
    });

    // CTA visible with a link to /present (target=_blank).
    const tvLink = page.getByRole("link", { name: /Open TV mode/i });
    await expect(tvLink).toBeVisible();
    await expect(tvLink).toHaveAttribute(
      "href",
      `/room/${ROOM_ID}/present`,
    );
    await expect(tvLink).toHaveAttribute("target", "_blank");
  });

  test("suppresses the CTA on an instant-mode room", async ({ page }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SCORING_ROOM_INSTANT),
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
    await expect(page.getByTestId("scoring-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("link", { name: /Open TV mode/i }),
    ).toHaveCount(0);
  });
});
