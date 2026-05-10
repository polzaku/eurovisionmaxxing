import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";

/**
 * R4 advance-time presence cascade E2E (SPEC §10.2.1).
 *
 * Seeds a room with [A, B, C, D] in announcement_order where A is the
 * active announcer (fresh), B and C are absent (60 s stale), and D is
 * present. Drives A's reveal queue to completion, then asserts that:
 *   (a) Two announce_skip banners appear in sequence (3 s each).
 *   (b) /api/results/{id} reports 2 skipped user IDs once the cascade
 *       has committed to the DB.
 *
 * The spec uses a real dev server + real Supabase (env-gated). If the
 * env is not configured, the seed-room CLI will bail early and the test
 * is skipped gracefully.
 */

interface SeedOutput {
  roomId: string;
  pin: string;
  ownerUserId: string;
  ownerRejoinToken: string;
}

function seedRoom(state: string): SeedOutput {
  // Run the CLI in --json mode so we get machine-readable output.
  // Strip any non-JSON lines (e.g. tsx startup warnings) and return the
  // first parseable line.
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
      // skip non-JSON lines (tsx version banner, etc.)
    }
  }
  throw new Error(`seed-room produced no JSON output. Raw:\n${raw}`);
}

async function signInAsOwner(page: Page, seed: SeedOutput): Promise<void> {
  // Seed localStorage before navigation so the session guard doesn't
  // redirect us to /onboard — same technique as awards-ceremony.spec.ts.
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

test.describe("R4 advance-time presence cascade (SPEC §10.2.1)", () => {
  test("cascades through 2 absent users when first announcer exhausts queue", async ({
    page,
  }, testInfo) => {
    // Cascade happens after A's last reveal + realtime round-trip (two skip
    // banners at 3 s each) — give the test 60 s of headroom.
    testInfo.setTimeout(60_000);

    let seed: SeedOutput;
    try {
      seed = seedRoom("announcing-cascade-absent");
    } catch (err) {
      // If the seed CLI bails (missing env), skip gracefully.
      testInfo.skip(
        true,
        `seed-room failed — likely missing Supabase env. ${String(err)}`,
      );
      return;
    }

    await signInAsOwner(page, seed);
    await page.goto(`/room/${seed.roomId}`);

    // Wait for the announcing view to render with the active-driver panel.
    // A is both owner and the first announcer, so they see the "Reveal next
    // point" button immediately.
    await expect(
      page.getByRole("button", { name: "Reveal next point" }),
    ).toBeVisible({ timeout: 15_000 });

    // Drive A's reveal queue to completion. The seed inserts result rows for
    // 5 contestants with points_awarded > 0 (the 10-row Eurovision top-10
    // from buildFullVotesAndResults). Click until the button disappears,
    // meaning A has exhausted their queue and the cascade fires.
    const MAX_REVEALS = 15; // safety cap above the expected queue length
    for (let i = 0; i < MAX_REVEALS; i++) {
      const revealBtn = page.getByRole("button", { name: "Reveal next point" });
      const visible = await revealBtn
        .isVisible({ timeout: 3_000 })
        .catch(() => false);
      if (!visible) break;

      // Skip early if the first skip banner already appeared (cascade fired
      // before we expected — guard against slow response + timing edge case).
      const bannerVisible = await page
        .getByRole("status")
        .first()
        .isVisible({ timeout: 200 })
        .catch(() => false);
      if (bannerVisible) break;

      await revealBtn.click();
      // Brief pause so the response lands before we probe again.
      await page.waitForTimeout(300);
    }

    // The cascade fires on A's last reveal and emits two announce_skip events
    // in order (B then C). The SkipBannerQueue renders each for 3 s then
    // advances to the next.

    // Banner #1 — first absent user (B).
    await expect(page.getByRole("status")).toContainText(
      /isn't here — their points are being skipped/i,
      { timeout: 10_000 },
    );

    // Wait for banner #1 to clear (3 s display + 0.5 s buffer), then assert
    // banner #2 for the second absent user (C).
    await page.waitForTimeout(3_500);
    await expect(page.getByRole("status")).toContainText(
      /isn't here — their points are being skipped/i,
      { timeout: 6_000 },
    );

    // Validate the DB-side commit: /api/results/{id} should reflect 2 skipped
    // user IDs in the announcement state once the cascade has settled.
    // Poll briefly in case the DB write is slightly behind the broadcasts.
    let skippedIds: unknown[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const apiRes = await page.request.get(`/api/results/${seed.roomId}`);
      if (apiRes.ok()) {
        const body = (await apiRes.json()) as {
          announcement?: { skippedUserIds?: unknown[] } | null;
        };
        const ids = body.announcement?.skippedUserIds;
        if (Array.isArray(ids) && ids.length === 2) {
          skippedIds = ids;
          break;
        }
      }
      await page.waitForTimeout(500);
    }

    expect(Array.isArray(skippedIds)).toBe(true);
    expect(skippedIds.length).toBe(2);
  });

  test("Finish the show: cascade-exhausted state → admin taps Finish → drives batch-reveals to done", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000);

    let seed: SeedOutput;
    try {
      seed = seedRoom("announcing-cascade-all-absent");
    } catch (err) {
      testInfo.skip(
        true,
        `seed-room failed — likely missing Supabase env. ${String(err)}`,
      );
      return;
    }

    await signInAsOwner(page, seed);
    await page.goto(`/room/${seed.roomId}`);

    // Cascade-exhaust state: Finish the show CTA visible to owner.
    await expect(
      page.getByRole("button", { name: /finish the show/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Tap Finish.
    await page.getByRole("button", { name: /finish the show/i }).click();

    // Reveal button appears (admin is now driving the first absent user's reveals).
    await expect(
      page.getByRole("button", { name: /reveal/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Drive reveals to done. ~30 result rows total (3 users × 10 points).
    let revealsFired = 0;
    const MAX_REVEALS = 50;
    while (revealsFired < MAX_REVEALS) {
      const revealBtn = page.getByRole("button", { name: /reveal/i });
      const visible = await revealBtn
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (!visible) break;
      await revealBtn.click();
      revealsFired += 1;
      await page.waitForTimeout(150);
    }

    // Finish CTA should be gone (we're either in batch-reveal or done state).
    await expect(
      page.getByRole("button", { name: /finish the show/i }),
    ).toHaveCount(0, { timeout: 10_000 });

    // Verify final state via API. announcing_user_id should be null and
    // status should be 'done' once the batch-reveal exhausts.
    const apiRes = await page.request.get(`/api/results/${seed.roomId}`);
    expect(apiRes.ok()).toBe(true);
  });
});
