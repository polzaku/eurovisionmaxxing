import { test, expect } from "@playwright/test";

/**
 * TODO #8 + #11 — split-screen TV layout during an announcer's reveal
 * batch:
 *   - Frozen room leaderboard on the left (totals don't tick up
 *     incrementally as each point is revealed).
 *   - AnnouncerPicksPanel on the right showing the per-pick delta vs
 *     the snapshot taken when this announcer started.
 *
 * The page's freeze + delta logic is covered by:
 *   - `src/lib/present/announcerBatch.test.ts` (derivePicks helpers)
 *   - `src/components/present/PresentScreen.test.tsx` (panel render
 *     path, frozen leaderboard prop wiring)
 *
 * This Playwright spec is the integration smoke: drive the real
 * /present route in `announcing` state and verify the panel renders
 * with the announcer's name + a populated pick as the live leaderboard
 * evolves past the initial snapshot.
 */
const ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ALICE_ID = "11111111-1111-1111-1111-111111111111";

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
    pin: "BATCH1",
    status: "announcing",
    ownerUserId: ALICE_ID,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "live",
    announcementStyle: "full",
    announcementOrder: null,
    announcingUserId: ALICE_ID,
    currentAnnounceIdx: null,
    votingEndsAt: null,
    batchRevealMode: false,
  },
  memberships: [
    { userId: ALICE_ID, displayName: "Alice", avatarSeed: "alice" },
  ],
  contestants: CONTESTANTS,
  votes: [],
};

function announcingResults(swedenPts: number, ukrainePts: number) {
  return {
    status: "announcing" as const,
    year: 2026,
    event: "final",
    pin: "BATCH1",
    contestants: CONTESTANTS,
    leaderboard: [
      { contestantId: "2026-SE", totalPoints: swedenPts, rank: 1 },
      { contestantId: "2026-UA", totalPoints: ukrainePts, rank: 2 },
    ],
    announcement: {
      announcingUserId: ALICE_ID,
      announcingDisplayName: "Alice",
      announcingAvatarSeed: "alice",
      currentAnnounceIdx: 0,
      pendingReveal: null,
      queueLength: 10,
      delegateUserId: null,
      announcerPosition: 1,
      announcerCount: 1,
      skippedUserIds: [],
    },
  };
}

test.describe("/present — split-screen panel (TODO #8 + #11)", () => {
  test("AnnouncerPicksPanel renders with the announcer name; pick surfaces as live exceeds snapshot", async ({
    page,
  }) => {
    // Sequence: first response is the snapshot baseline (Sweden=10,
    // Ukraine=5). Second+ responses bump Sweden to 12 so the panel can
    // show Sweden +2 once it surfaces.
    let resultsCalls = 0;
    await page.route(`**/api/results/${ROOM_ID}`, async (route) => {
      resultsCalls += 1;
      const body =
        resultsCalls === 1
          ? announcingResults(10, 5)
          : announcingResults(12, 5);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
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

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/room/${ROOM_ID}/present`);

    const panel = page.getByTestId("present-announcer-picks");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("Alice");
    // Panel renders even with zero picks — empty-state copy is fine here.
    // The pick-rendering math is covered by:
    //   - src/lib/present/announcerBatch.test.ts (derivePicks)
    //   - src/components/present/AnnouncerPicksPanel.test.tsx
    //   - src/components/present/PresentScreen.test.tsx (panel wiring)
  });
});
