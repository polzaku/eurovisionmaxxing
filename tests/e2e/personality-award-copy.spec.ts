import { test, expect } from "@playwright/test";

/**
 * SPEC #12 — personality award cinematic card:
 *   1. The numeric stat (avg / Pearson / Spearman / variance) must
 *      render rounded to 1 decimal — the raw 3-decimal float looked
 *      noisy during live testing.
 *   2. The plain-English explainer must speak about the winner in 3rd
 *      person ("they / their"), not 1st person ("you / your"), because
 *      every viewer sees the same card even when the winner is someone
 *      else.
 *
 * The standing awards-ceremony spec keeps its own fixture (best_vocals
 * + the_enabler) — we use a fresh inline fixture here with a
 * `biggest_stan` award whose statValue carries deliberate noise (8.94123)
 * so the rounding assertion is meaningful.
 */
const ROOM_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "44444444-4444-4444-4444-444444444444";

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

const DONE_RESULTS_FIXTURE = {
  status: "done" as const,
  year: 2026,
  event: "final",
  pin: "PERS01",
  contestants: CONTESTANTS,
  leaderboard: [{ contestantId: "2026-SE", totalPoints: 12, rank: 1 }],
  breakdowns: [],
  hotTakes: [],
  awards: [
    {
      roomId: ROOM_ID,
      awardKey: "biggest_stan",
      awardName: "Biggest stan",
      winnerUserId: USER_ID,
      winnerUserIdB: null,
      winnerContestantId: null,
      // Deliberately noisy value — must render as "8.9" after the
      // localizedAwardStat round.
      statValue: 8.94123,
      statLabel: "avg 8.9/10",
    },
  ],
  members: [
    {
      userId: USER_ID,
      displayName: "Alice",
      avatarSeed: "alice",
    },
  ],
};

const ROOM_PAYLOAD = {
  room: {
    id: ROOM_ID,
    pin: "PERS01",
    status: "done",
    ownerUserId: USER_ID,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "instant",
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
};

test.describe("personality award card — copy + stat formatting", () => {
  test("renders 1-decimal stat + 3rd-person explainer", async ({ page }) => {
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

    // The ceremony opens on the overall-winner reveal — advance past it
    // to land on the personality card.
    await expect(page.getByText("tonight's room champion")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("awards-next-button").click();

    // Wait for the personality award card to appear.
    await expect(page.getByText("Biggest stan")).toBeVisible({
      timeout: 5_000,
    });

    // Stat: rounded to 1 decimal. We assert on the visible text rather
    // than a brittle selector because the locale template is just
    // "avg {value}/10".
    await expect(page.getByText("avg 8.9/10")).toBeVisible();
    await expect(page.getByText("8.94123")).toHaveCount(0);

    // Explainer: 3rd-person copy. We assert positively on "they voted"
    // (taken from the updated en.json) and negatively on "you voted".
    await expect(page.getByText(/they voted on/i)).toBeVisible();
    await expect(page.getByText(/you voted on/i)).toHaveCount(0);
  });
});
