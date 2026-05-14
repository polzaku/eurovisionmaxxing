import { test, expect } from "@playwright/test";
import { ROOM_ID, USER_ID, VOTING_ROOM_LIVE } from "./fixtures/voting-room";

/**
 * Fix 1 (2026-05-14): host-mode "End voting" CTA no longer overlaps the
 * locale switcher + theme toggle in the page header. It now lives in its
 * own full-width row immediately below the Prev / Missed / Jump-to /
 * Next nav footer (SPEC §8.6).
 */
test.describe("host End Voting CTA placement", () => {
  test("renders below the nav footer, not in the header", async ({ page }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(VOTING_ROOM_LIVE),
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

    // Voting view should render with the host End Voting button.
    const endVotingButton = page.getByRole("button", { name: /End voting/i });
    await expect(endVotingButton).toBeVisible({ timeout: 15_000 });

    // It must NOT be inside the page <header>. Locale switcher + theme
    // toggle live there and the destructive button overlapped them.
    const headerContainsButton = await endVotingButton.evaluate(
      (el) => el.closest("header") !== null,
    );
    expect(headerContainsButton).toBe(false);

    // It must follow the four-button nav footer in document order.
    const nav = page.locator("main nav.grid.grid-cols-4");
    await expect(nav).toBeVisible();
    const navFollowsButton = await nav.evaluate((navEl, btn) => {
      const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
      return (
        // eslint-disable-next-line no-bitwise
        (navEl.compareDocumentPosition(btn as Node) & FOLLOWING) !== 0
      );
    }, await endVotingButton.elementHandle());
    expect(navFollowsButton).toBe(true);
  });
});
