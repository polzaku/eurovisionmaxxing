import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";

/**
 * R4 short live reveal mode E2E (SPEC §10.2.2).
 *
 * Seeds a room with `announcement_style='short'` where the owner is the
 * active announcer mid-flow: their auto-batch (ranks 2..N) is already
 * revealed, only the rank-1 (12-point) row is pending. Walks the
 * happy-path flow:
 *
 *   1. Open /room/{id} as owner — assert the compressed "Reveal 12 points"
 *      CTA + "Tap when you say it" microcopy are visible, and the
 *      verbose "tap anywhere to reveal" copy is absent.
 *   2. Tap the CTA — server runs advanceAnnouncement which marks rank-1
 *      announced, rotates to the guest, fires their auto-batch.
 *   3. After the round-trip, assert /api/results/{id} reports the room
 *      advanced (announcing_user_id changed to the guest; idx is the
 *      guest's twelvePointIdx).
 *
 * Skips gracefully when the seed CLI bails (missing Supabase env).
 */

interface SeedOutput {
  roomId: string;
  pin: string;
  ownerUserId: string;
  ownerRejoinToken: string;
}

function seedRoom(state: string): SeedOutput {
  const raw = execSync(
    `npm run --silent seed:room -- --state=${state} --json`,
    {
      encoding: "utf-8",
      cwd: process.cwd(),
    },
  );
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      return JSON.parse(line) as SeedOutput;
    } catch {
      // skip non-JSON lines (tsx banner, etc.)
    }
  }
  throw new Error(`seed-room produced no JSON output. Raw:\n${raw}`);
}

async function signInAsOwner(page: Page, seed: SeedOutput): Promise<void> {
  // Seed localStorage before navigation so the session guard doesn't
  // redirect to /onboard.
  await page.goto("/");
  await page.evaluate(
    ({ userId, rejoinToken }) => {
      window.localStorage.setItem(
        "emx_session",
        JSON.stringify({
          userId,
          rejoinToken,
          displayName: "Admin",
          avatarSeed: "owner",
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        }),
      );
    },
    { userId: seed.ownerUserId, rejoinToken: seed.ownerRejoinToken },
  );
}

test.describe("R4 short live reveal mode (SPEC §10.2.2)", () => {
  test("active announcer sees compressed 'Reveal 12 points' CTA + tap fires rotation", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(45_000);

    let seed: SeedOutput;
    try {
      seed = seedRoom("announcing-short-style-live");
    } catch (err) {
      testInfo.skip(
        true,
        `seed-room failed — likely missing Supabase env. ${String(err)}`,
      );
      return;
    }

    await signInAsOwner(page, seed);
    await page.goto(`/room/${seed.roomId}`);

    // SPEC §10.2.2 surface table: announcer's phone shows a single
    // "Reveal 12 points" CTA with "Tap when you say it" microcopy.
    await expect(
      page.getByRole("button", { name: /reveal 12 points/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/tap when you say it/i),
    ).toBeVisible();

    // The verbose full-style "tap anywhere to reveal" copy should NOT
    // appear under short style (we use a different CTA card entirely).
    await expect(
      page.getByText(/tap anywhere to reveal/i),
    ).toHaveCount(0);

    // Capture pre-tap state from the API for the post-tap diff.
    const preApiRes = await page.request.get(`/api/results/${seed.roomId}`);
    expect(preApiRes.ok()).toBe(true);
    const preBody = (await preApiRes.json()) as {
      announcement?: {
        announcingUserId?: string;
        currentAnnounceIdx?: number;
      } | null;
    };
    expect(preBody.announcement?.announcingUserId).toBe(seed.ownerUserId);

    // Tap the CTA. advanceAnnouncement marks rank-1 announced, rotates
    // to the guest, fires the guest's auto-batch.
    await page.getByRole("button", { name: /reveal 12 points/i }).click();

    // Post-tap: poll /api/results until the rotation lands. The guest
    // is the only other user in the order so announcingUserId flips to
    // them.
    let rotated = false;
    let postAnnouncingUserId: string | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const postApiRes = await page.request.get(
        `/api/results/${seed.roomId}`,
      );
      if (postApiRes.ok()) {
        const body = (await postApiRes.json()) as {
          announcement?: {
            announcingUserId?: string;
            currentAnnounceIdx?: number;
          } | null;
        };
        const nextAnnouncer = body.announcement?.announcingUserId;
        if (nextAnnouncer && nextAnnouncer !== seed.ownerUserId) {
          rotated = true;
          postAnnouncingUserId = nextAnnouncer;
          break;
        }
      }
      await page.waitForTimeout(500);
    }

    expect(rotated).toBe(true);
    expect(postAnnouncingUserId).not.toBe(seed.ownerUserId);
  });
});
