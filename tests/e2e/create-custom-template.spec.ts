import { test, expect } from "@playwright/test";

/**
 * Wizard custom-template E2E. Three cases, all single-window, fully
 * stubbed via page.route():
 *
 *  1. Selecting Custom expands the inline editor with one starter row.
 *  2. Adding rows up to 8 disables +Add; removing one re-enables it.
 *  3. Submitting Custom with valid rows POSTs {name, weight: 1} for
 *     every typed row.
 *
 * No seed-room, no realtime — the wizard is purely client-state +
 * a single POST /api/rooms on submit, which we intercept.
 */

const STUB_ROOM_ID = "11111111-2222-4333-8444-555566667777";
const STUB_USER_ID = "99999999-8888-4777-8666-555544443333";

const CONTESTANTS_PREVIEW = {
  count: 26,
  preview: [
    { flag: "🇸🇪", country: "Sweden" },
    { flag: "🇺🇦", country: "Ukraine" },
    { flag: "🇮🇹", country: "Italy" },
  ],
};

async function seedSession(page: import("@playwright/test").Page) {
  await page.addInitScript((userId) => {
    window.localStorage.setItem(
      "emx_session",
      JSON.stringify({
        userId,
        rejoinToken: "stub-rejoin-token",
        displayName: "Alice",
        avatarSeed: "alice",
        expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      }),
    );
  }, STUB_USER_ID);
}

async function stubContestants(page: import("@playwright/test").Page) {
  await page.route("**/api/contestants*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CONTESTANTS_PREVIEW),
    });
  });
}

test.describe("Wizard — custom template", () => {
  test("selecting Custom expands the editor with one starter row", async ({
    page,
  }) => {
    await stubContestants(page);
    await seedSession(page);
    await page.goto("/create");

    // Step 1 → Step 2
    await page.getByRole("button", { name: /Next/i }).click();

    // Custom card visible, editor not yet
    await expect(page.getByText("Custom", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Category name")).toHaveCount(0);

    // Click Custom to select + expand the editor
    await page.getByText("Custom", { exact: true }).click();

    await expect(page.getByPlaceholder("Category name")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /\+ Add category/i }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /Remove category 1/i }),
    ).toBeDisabled();
  });

  test("adding rows up to 8 disables +Add; removing one re-enables it", async ({
    page,
  }) => {
    await stubContestants(page);
    await seedSession(page);
    await page.goto("/create");
    await page.getByRole("button", { name: /Next/i }).click();
    await page.getByText("Custom", { exact: true }).click();

    const addButton = page.getByRole("button", { name: /\+ Add category/i });
    for (let i = 0; i < 7; i++) {
      await addButton.click();
    }
    await expect(page.getByPlaceholder("Category name")).toHaveCount(8);
    await expect(addButton).toBeDisabled();

    await page
      .getByRole("button", { name: /Remove category 8/i })
      .click();
    await expect(page.getByPlaceholder("Category name")).toHaveCount(7);
    await expect(addButton).toBeEnabled();
  });

  test("submitting Custom POSTs the entered names with weight=1", async ({
    page,
  }) => {
    await stubContestants(page);
    await seedSession(page);

    let capturedBody: unknown = null;
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() !== "POST") {
        return route.fallback();
      }
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          room: { id: STUB_ROOM_ID },
        }),
      });
    });

    await page.goto("/create");
    await page.getByRole("button", { name: /Next/i }).click();
    await page.getByText("Custom", { exact: true }).click();

    // Type into row 1
    const firstInput = page.getByPlaceholder("Category name").nth(0);
    await firstInput.fill("Vocals");

    // Add row 2 + fill
    await page.getByRole("button", { name: /\+ Add category/i }).click();
    const secondInput = page.getByPlaceholder("Category name").nth(1);
    await secondInput.fill("Stage Drama");

    await page.getByRole("button", { name: /Create room/i }).click();

    // Wait for the navigation + captured POST.
    await expect(page).toHaveURL(new RegExp(`/room/${STUB_ROOM_ID}`));

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as { categories: unknown };
    expect(body.categories).toEqual([
      { name: "Vocals", weight: 1 },
      { name: "Stage Drama", weight: 1 },
    ]);
  });
});
