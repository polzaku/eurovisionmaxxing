import { test, expect } from "@playwright/test";
import {
  DONE_RESULTS_FIXTURE,
  ROOM_ID,
  ROOM_PAYLOAD,
  USER_ID,
} from "./fixtures/done-room";

/**
 * Phase 6.2 awards-ceremony E2E smoke. Drives a real Next.js dev server
 * with the two API endpoints the room page hits stubbed via page.route.
 * Seeds localStorage so the page doesn't redirect to /onboard, and seeds
 * sessionStorage so the leaderboard ceremony fast-paths to the awards
 * phase (the leaderboard reveal is covered by the 5c.2 RTL suite — this
 * spec focuses on the awards reveal).
 */
test.describe("awards ceremony flow", () => {
  test("admin sees awards reveal → 3-CTA footer", async ({ page }) => {
    // Stub the two API endpoints the room page hits.
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ROOM_PAYLOAD),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(DONE_RESULTS_FIXTURE),
      });
    });

    // Seed session (localStorage) + leaderboard replay-skip (sessionStorage).
    await page.addInitScript(
      ({ userId, roomId }) => {
        const session = {
          userId,
          rejoinToken: "stub-rejoin-token",
          displayName: "Alice",
          avatarSeed: "alice",
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        };
        window.localStorage.setItem("emx_session", JSON.stringify(session));
        window.sessionStorage.setItem(`emx_revealed_${roomId}`, "true");
      },
      { userId: USER_ID, roomId: ROOM_ID },
    );

    await page.goto(`/room/${ROOM_ID}`);

    // We should land in the awards phase quickly because the leaderboard
    // replay-skip flag is set.
    await expect(page.getByText("Best Vocals")).toBeVisible({ timeout: 15_000 });

    // Advance via the corner Next button.
    await page.getByTestId("awards-next-button").click();
    await expect(page.getByText("The enabler")).toBeVisible();

    // Advance via the tap-anywhere zone.
    await page.getByTestId("awards-tap-zone").click();

    // CTAs phase: admin sees all three buttons.
    await expect(
      page.getByRole("button", { name: "Copy share link" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy text summary" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create another room" }),
    ).toBeVisible();
  });
});
