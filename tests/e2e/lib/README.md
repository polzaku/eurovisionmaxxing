# Multi-window Playwright helpers

These helpers exist for **cross-window regression tests** — flows where one
user's action changes state that another user's window has to react to.
The single-window Playwright tests in this folder (using `page.route(...)`
on one `page`) can't catch:

- Realtime broadcast races (Fix 2, Fix 5 in [docs/superpowers/plans/2026-05-14-host-ui-batch.md](../../../docs/superpowers/plans/2026-05-14-host-ui-batch.md)).
- Polling / visibilitychange fallback behaviour.
- "Did the host see the leaderboard advance after the guest voted?" type
  cross-user assertions.

## When to reach for this harness

Use the multi-window helpers when **the bug you're protecting against
involves >1 connected client**. Examples that justify the extra cost:

- Auto-advance between room lifecycle states (this PR — `realtime-polling-fallback.spec.ts`).
- "Now performing" pill appears on every guest's phone when the host taps a contestant.
- Leaderboard rank-shift visible on all guests during live announcement.
- Host's "End voting" undo countdown shows on every guest's screen.

For UX confined to a single surface (e.g. "the End-voting button isn't
in the header"), stick to single-window specs — they're 10× cheaper.

## What's in here

- [`twoWindow.ts`](./twoWindow.ts) — primitives:
  - `createRoomStateBus(initial)` — in-memory state shared across contexts.
    Both windows' `/api/rooms/{id}` and `/api/results/{id}` route handlers
    read from the bus, so a mutation in one window is visible to the other
    on its next refetch.
  - `openWindow(browser, user, roomId, bus)` — spins up an isolated
    `BrowserContext`, seeds `emx_session` for that user, wires the routes,
    returns `{ context, page }`.

## What's intentionally NOT in here

- **No Supabase realtime wiring.** The harness omits broadcasts on
  purpose so the polling + visibilitychange fallback (Fix 5) gets
  honest test coverage. For tests that exercise the real broadcast
  contract, a separate harness with a seeded Supabase room is the
  right tool (deferred until we have a dedicated test project — see
  TODO.md Phase 0).
- **No automatic context teardown.** Each test owns its `context.close()`
  in a `try/finally` block. Wrapping that into a fixture is fine when
  more than two specs use it.

## Skeleton

```ts
import { test, expect } from "@playwright/test";
import { createRoomStateBus, openWindow } from "./lib/twoWindow";

test("two-window scenario", async ({ browser }) => {
  const bus = createRoomStateBus({ /* RoomFixture */ });

  const host = await openWindow(browser, { /* userSeed */ }, ROOM_ID, bus);
  const guest = await openWindow(browser, { /* userSeed */ }, ROOM_ID, bus);

  try {
    await host.page.goto(`/room/${ROOM_ID}`);
    await guest.page.goto(`/room/${ROOM_ID}`);

    // Mutate state via the bus (simulates a server-side change) or via
    // a real HTTP POST that the route handler intercepts.
    bus.patch((s) => {
      (s.room as Record<string, unknown>).status = "announcing";
    });

    // Assert that the OTHER window reflects the change without manual
    // refresh. Allow up to ~5 s for the poll interval (3 s + slack).
    await expect(guest.page.getByText("Live announcement")).toBeVisible({
      timeout: 8_000,
    });
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
```

## Why isolated contexts (not just two pages)

Pages within one `BrowserContext` share `localStorage`. `emx_session`
lives there, so two pages in the same context would impersonate the
same user. Each "user" therefore needs its own `browser.newContext()`.

Cost: contexts are a bit heavier than pages — expect ~1 s extra per
spec for the second context creation. Acceptable for the leverage.
