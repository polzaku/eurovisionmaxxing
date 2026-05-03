import { test, expect } from "@playwright/test";
import {
  ANNOUNCING_PAYLOAD,
  ANNOUNCING_RESULTS,
  DONE_PAYLOAD,
  DONE_RESULTS,
  LOBBY_PAYLOAD,
  PRESENT_ROOM_ID,
} from "./fixtures/present-room";

/**
 * SPEC §10.3 / L1 + L13 — TV-cast presentation surface E2E. Drives the
 * /room/{id}/present route on a real Next.js dev server with the room
 * + results endpoints stubbed via page.route. Covers:
 *
 * - Lobby render: PIN huge + memberCount line.
 * - Announcing render: leaderboard rows, medals, totals, announcer name.
 * - Done render: final leaderboard.
 * - Force-dark: <html data-theme="dark"> after mount.
 * - L13 fullscreen prompt: visible when not in fullscreen, dismissible.
 *
 * No session seeding required — /present doesn't auth-gate or redirect
 * to /onboard.
 */

async function stubRoom(page: import("@playwright/test").Page, payload: unknown) {
  await page.route(`**/api/rooms/${PRESENT_ROOM_ID}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

async function stubResults(
  page: import("@playwright/test").Page,
  payload: unknown,
) {
  await page.route(`**/api/results/${PRESENT_ROOM_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

test.describe("/present — TV cast surface", () => {
  test("lobby state renders the PIN huge + member count", async ({ page }) => {
    await stubRoom(page, LOBBY_PAYLOAD);
    await page.goto(`/room/${PRESENT_ROOM_ID}/present`);

    await expect(page.getByText("PRSNT1")).toBeVisible();
    // status attribute on the screen wrapper
    await expect(page.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "lobby",
    );
  });

  test("announcing state renders the leaderboard with medals + totals", async ({
    page,
  }) => {
    await stubRoom(page, ANNOUNCING_PAYLOAD);
    await stubResults(page, ANNOUNCING_RESULTS);
    await page.goto(`/room/${PRESENT_ROOM_ID}/present`);

    await expect(page.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "announcing",
    );
    // Leaderboard rows are visible in rank order.
    await expect(page.getByText("Sweden")).toBeVisible();
    await expect(page.getByText("Ukraine")).toBeVisible();
    await expect(page.getByText("France")).toBeVisible();
    // Top totals
    await expect(page.getByText("24", { exact: true })).toBeVisible();
    await expect(page.getByText("18", { exact: true })).toBeVisible();
    // Medals on top three
    await expect(page.getByText("🥇")).toBeVisible();
    await expect(page.getByText("🥈")).toBeVisible();
    await expect(page.getByText("🥉")).toBeVisible();
  });

  test("done state renders the final leaderboard", async ({ page }) => {
    await stubRoom(page, DONE_PAYLOAD);
    await stubResults(page, DONE_RESULTS);
    await page.goto(`/room/${PRESENT_ROOM_ID}/present`);

    await expect(page.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "done",
    );
    // Done totals (different from announcing)
    await expect(page.getByText("32", { exact: true })).toBeVisible();
    await expect(page.getByText("28", { exact: true })).toBeVisible();
  });

  test("forces dark theme via <html data-theme='dark'> on mount", async ({
    page,
  }) => {
    await stubRoom(page, LOBBY_PAYLOAD);
    // Seed a 'light' theme in localStorage so we can prove it gets overridden.
    await page.addInitScript(() => {
      window.localStorage.setItem("emx_theme", "light");
    });
    await page.goto(`/room/${PRESENT_ROOM_ID}/present`);

    // After mount, the present page should have set data-theme="dark"
    // regardless of the stored 'light' preference.
    await expect(async () => {
      const theme = await page.locator("html").getAttribute("data-theme");
      expect(theme).toBe("dark");
    }).toPass({ timeout: 5000 });
  });

  test("renders the L13 fullscreen prompt when not in fullscreen, dismissible", async ({
    page,
  }) => {
    await stubRoom(page, LOBBY_PAYLOAD);
    await page.goto(`/room/${PRESENT_ROOM_ID}/present`);

    const prompt = page.getByTestId("fullscreen-prompt");
    await expect(prompt).toBeVisible();

    // Tap the dismiss × — prompt should disappear.
    await page.getByRole("button", { name: /Dismiss fullscreen prompt/i }).click();
    await expect(prompt).not.toBeVisible();
  });
});
