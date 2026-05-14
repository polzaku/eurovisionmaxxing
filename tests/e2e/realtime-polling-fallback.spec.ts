import { test, expect } from "@playwright/test";
import {
  createRoomStateBus,
  openWindow,
  type RoomFixture,
} from "./lib/twoWindow";

/**
 * Two-window regression spec for Fix 5 (2026-05-14): the
 * `useRoomStatusPolling` fallback advances guests even when the Supabase
 * `status_changed` broadcast is dropped.
 *
 * The harness omits broadcast wiring entirely — every cross-window state
 * transition has to be carried by the polling refetch or the
 * visibilitychange refetch. If either path regresses, the test stalls.
 *
 * Single-window RTL coverage for the hook itself lives in
 * `src/hooks/useRoomStatusPolling.test.ts`. This spec is the higher-up
 * integration check that the wiring in `/room/[id]/page.tsx` actually
 * consumes the hook the way production does.
 */

const ROOM_ID = "55555555-5555-5555-5555-555555555555";
const HOST_USER_ID = "66666666-6666-6666-6666-666666666666";
const GUEST_USER_ID = "77777777-7777-7777-7777-777777777777";

function baseRoomState(status: string): RoomFixture {
  return {
    room: {
      id: ROOM_ID,
      pin: "ABCDEF",
      status,
      ownerUserId: HOST_USER_ID,
      categories: [{ name: "Vocals", weight: 1 }],
      announcementMode: "live",
      announcementOrder: null,
      announcingUserId: null,
      currentAnnounceIdx: null,
      votingEndsAt: null,
    },
    memberships: [
      {
        userId: HOST_USER_ID,
        displayName: "Host Alice",
        avatarSeed: "alice",
      },
      {
        userId: GUEST_USER_ID,
        displayName: "Guest Bob",
        avatarSeed: "bob",
      },
    ],
    contestants: [
      {
        id: "2026-SE",
        year: 2026,
        event: "final",
        countryCode: "SE",
        country: "Sweden",
        artist: "Artist SE",
        song: "Song SE",
        flagEmoji: "🇸🇪",
        runningOrder: 1,
      },
    ],
    votes: [],
    broadcastStartUtc: null,
  };
}

test.describe("Realtime polling fallback — cross-window", () => {
  test("guest auto-advances voting_ending → announcing via the 3 s poll even without a broadcast", async ({
    browser,
  }) => {
    // Pre-seed the room as `voting_ending` — the hook polls only for
    // {voting_ending, scoring}, so this starts the polling clock the
    // moment the guest's page mounts. Mirrors the production race where
    // the guest received the first broadcast but missed the second.
    const bus = createRoomStateBus(baseRoomState("voting_ending"));

    const guest = await openWindow(
      browser,
      {
        userId: GUEST_USER_ID,
        displayName: "Guest Bob",
        avatarSeed: "bob",
      },
      ROOM_ID,
      bus,
    );

    try {
      await guest.page.goto(`/room/${ROOM_ID}`);

      // Sanity: guest landed on a voting-flavoured surface (voting_ending
      // still renders the voting view in this app — only the EndingPill
      // overlay changes for non-admin viewers).
      await expect(
        guest.page.locator("main").first(),
      ).toBeVisible({ timeout: 15_000 });

      // Host fires the scoring + announcing transitions server-side
      // WITHOUT broadcasting. The guest's only path to learning about
      // them is the 3 s poll interval kicked off by `voting_ending`.
      bus.patch((s) => {
        (s.room as Record<string, unknown>).status = "announcing";
        (s.room as Record<string, unknown>).announcingUserId = HOST_USER_ID;
      });

      // The poll fires every 3 000 ms; allow up to ~5 s for the swing.
      await expect(guest.page.getByText("Live announcement")).toBeVisible({
        timeout: 8_000,
      });
    } finally {
      await guest.context.close();
    }
  });

  test("guest stuck on voting catches up via visibilitychange refetch when broadcast is missed entirely", async ({
    browser,
  }) => {
    // Worst case: guest never even saw `voting_ending`. They're locally
    // on `voting`, so the interval polling doesn't activate. The only
    // recovery path is the visibilitychange listener firing when they
    // tab back into the app.
    const bus = createRoomStateBus(baseRoomState("voting"));

    const guest = await openWindow(
      browser,
      {
        userId: GUEST_USER_ID,
        displayName: "Guest Bob",
        avatarSeed: "bob",
      },
      ROOM_ID,
      bus,
    );

    try {
      await guest.page.goto(`/room/${ROOM_ID}`);
      // Guest sees the voting surface (the cluster footer renders
      // Prev / Missed / Jump-to / Next on every viewport).
      await expect(
        guest.page.getByRole("button", { name: /Jump to/i }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Host completes the full status arc server-side, broadcasts
      // dropped. Guest's local status is still `voting` so no polling.
      bus.patch((s) => {
        (s.room as Record<string, unknown>).status = "announcing";
        (s.room as Record<string, unknown>).announcingUserId = HOST_USER_ID;
      });

      // Simulate the user backgrounding the tab and returning — exactly
      // the recovery path `useRoomStatusPolling` covers via its
      // `visibilitychange` listener.
      await guest.page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await guest.page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // After one refetch the guest should be on the announcing surface
      // (header reads "Live announcement").
      await expect(guest.page.getByText("Live announcement")).toBeVisible({
        timeout: 8_000,
      });
    } finally {
      await guest.context.close();
    }
  });
});
