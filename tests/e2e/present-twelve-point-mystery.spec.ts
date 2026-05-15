import { test, expect } from "@playwright/test";

/**
 * TODO #7 — the climactic 12-point reveal must stay a surprise. The
 * "Up next" card on the TV used to leak the destination country + flag
 * for the 12-pointer, killing the Eurovision-style drama. After the
 * fix, when `pendingReveal.points === 12`, the card renders the mystery
 * copy and skips both the country name and the flag.
 *
 * This spec drives `/room/<id>/present` with an `announcing` payload
 * that pins `pendingReveal` to 12 points for Sweden, and asserts:
 *   1. The pending-reveal card is visible.
 *   2. The card does NOT contain "Sweden" or the Swedish flag.
 *   3. For comparison: a separate run with `points: 8` does still
 *      surface "Sweden" (drama only suppressed for the 12-pointer).
 */
const ROOM_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const OWNER_ID = "11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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

function roomPayload() {
  return {
    room: {
      id: ROOM_ID,
      pin: "MYSTRY",
      status: "announcing",
      ownerUserId: OWNER_ID,
      categories: [{ name: "Vocals", weight: 1 }],
      announcementMode: "live",
      announcementStyle: "full",
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
}

function announcingResults(points: number) {
  return {
    status: "announcing" as const,
    year: 2026,
    event: "final",
    pin: "MYSTRY",
    contestants: CONTESTANTS,
    leaderboard: [
      { contestantId: "2026-SE", totalPoints: 24, rank: 1 },
      { contestantId: "2026-UA", totalPoints: 18, rank: 2 },
    ],
    announcement: {
      announcingUserId: OWNER_ID,
      announcingDisplayName: "Alice",
      announcingAvatarSeed: "alice",
      currentAnnounceIdx: 0,
      pendingReveal: { contestantId: "2026-SE", points },
      queueLength: 10,
      delegateUserId: null,
      announcerPosition: 1,
      announcerCount: 1,
      skippedUserIds: [],
    },
  };
}

test.describe("/present — 12-point mystery (TODO #7)", () => {
  test("12-point pendingReveal hides Sweden + 🇸🇪 from the 'Up next' card", async ({
    page,
  }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(roomPayload()),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(announcingResults(12)),
      });
    });

    await page.goto(`/room/${ROOM_ID}/present`);

    const card = page.getByTestId("present-pending-reveal");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("data-has-reveal", "true");

    // Mystery branch — country + flag must not appear inside the card.
    await expect(card).not.toContainText("Sweden");
    await expect(card).not.toContainText("🇸🇪");
    // The mystery copy mentions "douze points" — sanity that we hit the
    // mystery render path, not just an empty card.
    await expect(card).toContainText(/douze points/i);
  });

  test("8-point pendingReveal still shows Sweden + 🇸🇪 (only the 12 is mystery)", async ({
    page,
  }) => {
    await page.route(`**/api/rooms/${ROOM_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(roomPayload()),
      });
    });
    await page.route(`**/api/results/${ROOM_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(announcingResults(8)),
      });
    });

    await page.goto(`/room/${ROOM_ID}/present`);

    const card = page.getByTestId("present-pending-reveal");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText("Sweden");
    await expect(card).toContainText("🇸🇪");
  });
});
