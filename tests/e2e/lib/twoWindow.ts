import type { Browser, BrowserContext, Page } from "@playwright/test";

/**
 * Multi-window Playwright helpers for cross-context realtime regression
 * tests. Each "window" is an isolated `BrowserContext` so localStorage
 * (and therefore `emx_session`) doesn't bleed between users.
 *
 * Both windows talk to the SAME mocked `/api/rooms/{id}` and
 * `/api/results/{id}` state via the `RoomStateBus` below: when one
 * context POSTs a status change, the bus mutates the shared in-memory
 * state and the other context picks it up on its next refetch (poll
 * interval or visibilitychange — Fix 5).
 *
 * Supabase realtime is intentionally NOT wired up in this harness — the
 * point is to prove that the polling + visibility fallback advances the
 * guest reliably even when the broadcast is dropped. For tests that
 * exercise real broadcast contracts, a separate harness with a seeded
 * Supabase room is the right tool (deferred to a follow-up).
 */

export interface RoomFixture {
  room: Record<string, unknown>;
  memberships: Array<{
    userId: string;
    displayName: string;
    avatarSeed: string;
    isReady?: boolean;
    readyAt?: string | null;
  }>;
  contestants: unknown[];
  votes: unknown[];
  broadcastStartUtc: string | null;
}

export interface RoomStateBus {
  current(): RoomFixture;
  patch(mutator: (s: RoomFixture) => void): void;
}

export function createRoomStateBus(initial: RoomFixture): RoomStateBus {
  let state: RoomFixture = clone(initial);
  return {
    current: () => state,
    patch(mutator) {
      const next = clone(state);
      mutator(next);
      state = next;
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export interface UserSeed {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

/**
 * Spin up an isolated context for one user. Seeds `emx_session` so the
 * room page doesn't redirect to /onboard. Caller is responsible for
 * `context.close()` cleanup in `afterEach` to keep tests hermetic.
 */
export async function openWindow(
  browser: Browser,
  user: UserSeed,
  roomId: string,
  bus: RoomStateBus,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ session }) => {
      window.localStorage.setItem("emx_session", JSON.stringify(session));
    },
    {
      session: {
        userId: user.userId,
        rejoinToken: "stub-rejoin-token",
        displayName: user.displayName,
        avatarSeed: user.avatarSeed,
        expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      },
    },
  );

  // Both /api/rooms and /api/results read live from the shared bus, so
  // updates pushed by one context become visible to the other on its
  // next refetch.
  await context.route(`**/api/rooms/${roomId}*`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bus.current()),
    });
  });
  await context.route(`**/api/results/${roomId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const s = bus.current();
    // Minimum results shape needed by /room status branches that touch it.
    const status =
      typeof s.room.status === "string" ? (s.room.status as string) : "voting";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status, leaderboard: [], announcement: null }),
    });
  });

  const page = await context.newPage();
  return { context, page };
}
