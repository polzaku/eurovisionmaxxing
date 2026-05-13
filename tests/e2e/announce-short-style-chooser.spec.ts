import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";

/**
 * R4 short live reveal — chooser + present-overlay E2E (SPEC §10.2.2 + §6.1).
 *
 * Two tests:
 *
 * 1. Wizard happy path: signs in via localStorage seed, walks the
 *    create wizard, picks Live + Short via the new sub-radio, submits,
 *    and confirms the created room landed in the lobby (URL redirect +
 *    visible "Host lobby" copy + visible short-mode lobby info card).
 *
 * 2. Present-screen overlay: seeds a short-style announcing room via
 *    the seed CLI, opens /room/{id}/present, asserts the 5-second
 *    first-load overlay banner renders with the SPEC §10.2.2 line 1028
 *    copy.
 *
 * Both tests skip gracefully without Supabase env (existing pattern).
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

async function signInAsAnon(page: Page): Promise<string> {
  await page.goto("/");
  const userId = crypto.randomUUID();
  await page.evaluate(
    ({ userId }) => {
      window.localStorage.setItem(
        "emx_session",
        JSON.stringify({
          userId,
          rejoinToken: "test-token-" + userId,
          displayName: "Wizard Tester",
          avatarSeed: "tester",
          expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        }),
      );
    },
    { userId },
  );
  return userId;
}

test.describe("R4 short live reveal — chooser + overlay (SPEC §10.2.2)", () => {
  test("wizard: select Live → toggle Short → create → lobby info card visible", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(45_000);

    try {
      await signInAsAnon(page);
    } catch (err) {
      testInfo.skip(true, `auth setup failed: ${String(err)}`);
      return;
    }

    await page.goto("/create");

    // Step 1: year + event. Pick the dev-only 9999 fixture if available
    // so the wizard can complete without hitting the live upstream.
    const yearSelect = page.getByLabel(/Year/i);
    if (await yearSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const options = await yearSelect.locator("option").allTextContents();
      const fixtureOpt = options.find((o) => o.includes("9999"));
      if (fixtureOpt) {
        await yearSelect.selectOption({ label: fixtureOpt });
      }
    }

    // Wait for contestants to load (visible "countries loaded" status).
    await expect(page.getByText(/countries loaded/i)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /^Next$/ }).click();

    // Step 2: announcement mode picker. Select Live. The button's
    // accessible name includes the tagline post-i18n migration, so
    // anchor to the start with a word boundary instead of exact-match.
    const liveCard = page.getByRole("button", { name: /^Live\b/ });
    await expect(liveCard).toBeVisible({ timeout: 10_000 });
    await liveCard.click();

    // The style sub-radio appears below the Live card.
    await expect(
      page.getByTestId("announcement-style-subradio"),
    ).toBeVisible({ timeout: 5_000 });

    // The "Short reveal — Eurovision style" option is visible. Click it.
    await page
      .getByRole("button", { name: /Short reveal — Eurovision style/i })
      .click();

    // Tooltip is reachable via the info button on the Short option.
    // We don't assert tooltip content here — unit tests cover that.

    // Submit. Lands on /room/{id}.
    await page.getByRole("button", { name: /Create room/i }).click();
    await page.waitForURL(/\/room\/[0-9a-f-]+/, { timeout: 15_000 });

    // Lobby info card surfaces for the admin under short style.
    await expect(page.getByTestId("lobby-short-info-card")).toBeVisible({
      timeout: 10_000,
    });

    // Extract room id from the URL for an API probe.
    const url = page.url();
    const match = url.match(/\/room\/([0-9a-f-]+)/);
    expect(match).not.toBeNull();
    const roomId = match![1];

    // Probe /api/rooms/{id} to confirm the room exists with short style.
    const apiRes = await page.request.get(`/api/rooms/${roomId}`);
    expect(apiRes.ok()).toBe(true);
    const body = (await apiRes.json()) as {
      room?: { announcementStyle?: string };
    };
    // Defensive: the API may surface the field under `room.announcementStyle`
    // or `room.announcement_style` depending on the read path. Accept either.
    const styleFromApi =
      body.room?.announcementStyle ??
      (body as { room?: { announcement_style?: string } }).room
        ?.announcement_style;
    expect(styleFromApi).toBe("short");
  });

  test("present: 5-second first-load overlay banner renders under short + announcing", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(30_000);

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

    // No sign-in needed — /present is publicly viewable.
    await page.goto(`/room/${seed.roomId}/present`);

    // The first-load overlay renders with the SPEC §10.2.2 line 1028 copy.
    await expect(page.getByTestId("present-short-overlay")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/Short reveal mode/i),
    ).toBeVisible();
    await expect(
      page.getByText(
        /announcer.s phone has a single .Reveal 12 points. button/i,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Got it/i }),
    ).toBeVisible();

    // Tap "Got it" — overlay dismisses.
    await page.getByRole("button", { name: /Got it/i }).click();
    await expect(page.getByTestId("present-short-overlay")).toHaveCount(0, {
      timeout: 2_000,
    });

    // Refresh the page — overlay does NOT re-render (sessionStorage flag).
    await page.reload();
    await expect(page.getByTestId("present-short-overlay")).toHaveCount(0, {
      timeout: 5_000,
    });
  });
});
