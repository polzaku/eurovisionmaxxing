import { test, expect } from "@playwright/test";

/**
 * TODO #1 — re-tapping the currently-selected score button retracts
 * that score. The Autosaver forwards the retract as
 * `scores: { Cat: null }`; before the fix the server rejected null with
 * `INVALID_BODY` and the SaveChip flashed "Save failed" on every
 * retract.
 *
 * This Playwright spec drives the full client round-trip and asserts:
 *   1. Initial save lands on "✓ Saved".
 *   2. Re-tap also lands on "✓ Saved" (not "Save failed").
 *
 * The server stub accepts every POST — that's the fixed behaviour. The
 * unit suite (`src/lib/votes/upsert.test.ts`) covers the server side.
 */
const ROOM_ID = "55555555-5555-5555-5555-555555555555";
const USER_ID = "66666666-6666-6666-6666-666666666666";

const CONTESTANTS = [
  {
    id: "2026-SE",
    year: 2026,
    event: "final",
    countryCode: "SE",
    country: "Sweden",
    artist: "Test Artist SE",
    song: "Test Song SE",
    flagEmoji: "🇸🇪",
    runningOrder: 1,
  },
];

const ROOM_PAYLOAD = {
  room: {
    id: ROOM_ID,
    pin: "RETRA1",
    status: "voting",
    ownerUserId: USER_ID,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "live",
    announcementOrder: null,
    announcingUserId: null,
    currentAnnounceIdx: null,
    votingEndsAt: null,
  },
  memberships: [
    { userId: USER_ID, displayName: "Alice", avatarSeed: "alice" },
  ],
  contestants: CONTESTANTS,
  votes: [],
  broadcastStartUtc: null,
};

test.describe("voting card retract — SaveChip", () => {
  test("retract lands on '✓ Saved', not 'Save failed'", async ({ page }) => {
    // The voting view is heartbeat-driven; stub status polling so it
    // doesn't bounce out of `voting`.
    await page.route(`**/api/rooms/${ROOM_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { status: "voting" } }),
      });
    });
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ROOM_PAYLOAD),
      });
    });

    // Capture every score POST so we can verify the retract round-trip
    // is genuinely sent over the wire (i.e. the SaveChip's "Saved"
    // isn't coming from a no-op).
    const scorePosts: Array<Record<string, unknown>> = [];
    await page.route(`**/api/rooms/${ROOM_ID}/votes`, async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        scorePosts.push(body);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            vote: {
              id: "vote-1",
              roomId: ROOM_ID,
              userId: USER_ID,
              contestantId: "2026-SE",
              scores: {},
              missed: false,
              hotTake: null,
              hotTakeEditedAt: null,
              updatedAt: new Date().toISOString(),
            },
            scoredCount: 0,
          },
        }),
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

    // Wait for the score buttons to render. The Vocals category renders
    // 10 buttons; each has an aria-label like "Vocals: score 7".
    const score7 = page.getByRole("button", { name: "Vocals: score 7" });
    await expect(score7).toBeVisible({ timeout: 15_000 });

    // Initial save: tap 7. The Autosaver debounces ~500ms — give it
    // enough headroom to flush + receive the response.
    await score7.click();
    await expect(page.getByText("✓ Saved")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Save failed")).toHaveCount(0);

    // Retract: tap 7 again. SaveChip must land on "Saved" again. Before
    // the fix this was the flashing-red path.
    await score7.click();
    await expect(page.getByText("✓ Saved")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Save failed")).toHaveCount(0);

    // Sanity: the retract POST really went out with `Vocals: null`.
    const retract = scorePosts.find((p) => {
      const scores = p.scores as Record<string, unknown> | undefined;
      return scores != null && scores.Vocals === null;
    });
    expect(
      retract,
      `expected a POST with scores.Vocals === null; got ${JSON.stringify(scorePosts)}`,
    ).toBeDefined();
  });
});
