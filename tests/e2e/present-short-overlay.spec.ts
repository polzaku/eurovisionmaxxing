import { test, expect } from "@playwright/test";

/**
 * TODO #6 — the short-mode first-load overlay used to render as a
 * full-screen modal (`fixed inset-0 ... bg-background/95`) and blocked
 * the leaderboard on the TV for up to 5 seconds. SPEC §1028 calls for a
 * banner. This spec drives the real /present route with the room +
 * results endpoints stubbed in `short` style and asserts:
 *
 *   1. The overlay renders (it still appears on first load).
 *   2. The overlay is a top banner (CSS `top-4`, not `inset-0`).
 *   3. The leaderboard is visible alongside — country names render and
 *      are not covered.
 */
const ROOM_ID = "77777777-7777-7777-7777-777777777777";
const OWNER_ID = "88888888-8888-8888-8888-888888888888";

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
  {
    id: "2026-UA",
    year: 2026,
    event: "final",
    countryCode: "UA",
    country: "Ukraine",
    artist: "Test Artist UA",
    song: "Test Song UA",
    flagEmoji: "🇺🇦",
    runningOrder: 2,
  },
];

const ROOM_PAYLOAD = {
  room: {
    id: ROOM_ID,
    pin: "SHORT1",
    status: "announcing",
    ownerUserId: OWNER_ID,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "live",
    announcementStyle: "short",
    announcementOrder: null,
    announcingUserId: OWNER_ID,
    currentAnnounceIdx: null,
    votingEndsAt: null,
  },
  memberships: [
    { userId: OWNER_ID, displayName: "Alice", avatarSeed: "alice" },
  ],
  contestants: CONTESTANTS,
  votes: [],
};

const RESULTS_PAYLOAD = {
  status: "announcing" as const,
  year: 2026,
  event: "final",
  pin: "SHORT1",
  contestants: CONTESTANTS,
  leaderboard: [
    { contestantId: "2026-SE", totalPoints: 24, rank: 1 },
    { contestantId: "2026-UA", totalPoints: 18, rank: 2 },
  ],
  announcement: null,
};

test.describe("/present — short-mode banner overlay (TODO #6)", () => {
  test("overlay is a top banner, leaderboard is visible behind it", async ({
    page,
  }) => {
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
        body: JSON.stringify(RESULTS_PAYLOAD),
      });
    });

    await page.goto(`/room/${ROOM_ID}/present`);

    const overlay = page.getByTestId("present-short-overlay");
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Banner positioning — `top-N`, not `inset-0`.
    const cls = await overlay.getAttribute("class");
    expect(cls, "overlay should be a top banner, not fullscreen").not.toMatch(
      /\binset-0\b/,
    );
    expect(cls, "overlay should be pinned to top").toMatch(/\btop-\d/);

    // Leaderboard countries render alongside the overlay (DOM-level).
    await expect(page.getByText("Sweden")).toBeVisible();
    await expect(page.getByText("Ukraine")).toBeVisible();

    // Bounding-box check: the overlay should be near the top of the
    // viewport, and the first leaderboard row should be below the
    // overlay's bottom edge — i.e. not covered.
    const overlayBox = await overlay.boundingBox();
    const swedenBox = await page.getByText("Sweden").boundingBox();
    expect(overlayBox, "overlay must be laid out").not.toBeNull();
    expect(swedenBox, "leaderboard must be laid out").not.toBeNull();
    if (overlayBox && swedenBox) {
      expect(
        swedenBox.y,
        "first leaderboard row must sit below the overlay's bottom edge",
      ).toBeGreaterThanOrEqual(overlayBox.y + overlayBox.height - 1);
    }
  });
});
