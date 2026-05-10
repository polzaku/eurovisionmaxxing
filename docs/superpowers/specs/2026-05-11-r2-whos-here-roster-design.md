# R2 #239 "Who's here" lobby presence indicators — design

**Date:** 2026-05-11
**TODO ref:** [TODO.md:239](../../../TODO.md#L239) (Phase R2)
**SPEC ref:** §6.6.2 ("Who's here" roster)
**Slice:** R2 lobby surfaces — first slice. Subsequent R2 surfaces (lobby countdown #238, primer carousel #240, JSON shape extension #241) are follow-on slices.

## Problem

`<LobbyView>` already renders a "Who's here" avatar grid showing every room member, and the membership list is already live-updated via `user_joined` broadcasts ([page.tsx:244](../../../src/app/room/[id]/page.tsx#L244)). What's missing per SPEC §6.6.2 is the **presence treatment**: members who closed their tab or lost connection should grey out within ~30 s rather than appearing as if they're still around.

The existing avatar grid is static — every member who has ever joined renders identically with no signal that some of them aren't actually here right now. Early arrivers experience the lobby as "lots of avatars but nobody's actually in the room", and late arrivers can't tell who's settled in vs who left.

## Goals

- **Live presence dots** on each lobby avatar — green when the user is currently subscribed to the `presence:{roomId}` channel, grey otherwise.
- **Muted opacity** on offline members so the eye is drawn to who's actually here.
- **Reuse the existing `useRoomPresence` hook** (PR #76). 30 s heartbeat timeout is the working signal; no new infrastructure needed.
- **Visual consistency** with `<AnnouncerRoster>`'s "here now" emerald dot — same color, similar placement.

## Non-goals

- Voting-header compact roster (SPEC §6.6.2 last paragraph) — defer to a follow-up slice. Different surface, different layout, low code reuse.
- Co-admin promotion via long-press on a roster row (SPEC §6.6.5 / §6.7) — separate feature.
- `user_left` broadcast emission. Today the type variant exists but is never emitted; relying on `useRoomPresence`'s 30 s timeout is sufficient and avoids server-side hooks.
- Empty/single-member state copy. The owner is always present; the roster always has at least one row.
- New `<LobbyRoster>` component extraction. The existing inline grid is small (~20 lines) and serves only one caller — extraction is YAGNI.

## Architecture

`<LobbyView>` already has the avatar grid. This slice:

1. **Adds two new props** — `roomId: string`, `currentUserId: string` — which `<LobbyView>` needs to call `useRoomPresence`.
2. **Calls `useRoomPresence(roomId, currentUserId)`** inside the component body. Returns a `Set<userId>` of currently-subscribed members; auto-cleans on heartbeat timeout (~30 s) without explicit `user_left` events.
3. **Wraps each avatar block** with presence-aware styling: an absolute-positioned dot indicator on the avatar (top-right of the 64 px avatar) and `opacity-50` on the whole block when offline.

Membership list (additive, grows via `user_joined`) and presence Set (live, auto-clean) are complementary — same shape as the announcer-side roster pattern from PR #76.

## Components

### 1. `<LobbyView>` props extension

In [src/components/room/LobbyView.tsx](../../../src/components/room/LobbyView.tsx):

```ts
interface LobbyViewProps {
  // ...existing props...

  /** SPEC §6.6.2 — required for the live presence channel subscription. */
  roomId: string;
  currentUserId: string;
}
```

Both values already exist at the page level (`page.tsx` has `roomId = params.id` and `currentUserId = session.userId`). Plumb them through.

### 2. `useRoomPresence` wiring

At the top of `<LobbyView>` alongside the existing imports:

```ts
import { useRoomPresence } from "@/hooks/useRoomPresence";
```

Inside the component body (near the top, before the existing `useMemo`/`useState` declarations):

```ts
const presenceUserIds = useRoomPresence(roomId, currentUserId);
```

This hook is the same one `<AnnouncingView>` uses for the announcer-roster panel — same channel, same auto-cleanup, no behaviour overlap.

### 3. Presence-aware roster render

Replace the existing avatar block at [LobbyView.tsx:338-351](../../../src/components/room/LobbyView.tsx#L338) with:

```tsx
{memberships.map((m) => {
  const isOnline = presenceUserIds.has(m.userId);
  return (
    <div
      key={m.userId}
      data-testid={`lobby-member-${m.userId}`}
      data-online={isOnline ? "true" : "false"}
      className={`flex flex-col items-center text-center space-y-1 transition-opacity ${
        isOnline ? "" : "opacity-50"
      }`}
    >
      <div className="relative">
        <Avatar seed={m.avatarSeed} size={64} />
        <span
          aria-hidden
          title={isOnline ? "Online" : "Offline"}
          className={`absolute bottom-0 right-0 inline-block w-3 h-3 rounded-full border-2 border-card ${
            isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
        />
      </div>
      <p className="text-sm font-medium truncate w-full">
        {m.displayName}
        {m.userId === ownerUserId && (
          <span className="ml-1 text-xs text-primary">★</span>
        )}
      </p>
    </div>
  );
})}
```

The presence dot:
- Lives in a `relative` wrapper around the avatar so it can be absolutely-positioned at `bottom-0 right-0`.
- 12 px diameter (`w-3 h-3`) — visible on a 64 px avatar without being intrusive.
- 2 px `border-card` ring isolates it from the avatar art so it's legible regardless of avatar background.
- Emerald 500 (online) matches the `<AnnouncerRoster>` "here now" dot exactly.
- `bg-muted-foreground/40` (offline) — desaturated grey, lower contrast than the offline state but still visible.

Whole block gets `opacity-50` when offline — the avatar + name fade together, drawing the eye to who's currently around.

### 4. `page.tsx` wiring

[src/app/room/[id]/page.tsx](../../../src/app/room/[id]/page.tsx) — find the existing `<LobbyView>` JSX render. Add the two new props:

```tsx
<LobbyView
  // ...existing props...
  roomId={roomId}
  currentUserId={session.userId}
/>
```

Both values are already in scope at the call site.

## Tests

### `<LobbyView>` RTL — 3 new cases

In `src/components/room/LobbyView.test.tsx`:

```tsx
vi.mock("@/hooks/useRoomPresence", () => ({
  useRoomPresence: vi.fn(),
}));

import { useRoomPresence } from "@/hooks/useRoomPresence";

describe("LobbyView — presence indicators (R2 #239)", () => {
  it("renders online treatment for members in the presence Set", () => {
    vi.mocked(useRoomPresence).mockReturnValue(new Set(["u1"]));
    render(
      <LobbyView
        // ...minimal required props...
        roomId="r1"
        currentUserId="u1"
        memberships={[
          { userId: "u1", displayName: "Alice", avatarSeed: "a" },
        ]}
      />,
    );
    const row = screen.getByTestId("lobby-member-u1");
    expect(row).toHaveAttribute("data-online", "true");
    expect(row).not.toHaveClass("opacity-50");
  });

  it("renders offline treatment (opacity-50 + grey dot) for members not in the presence Set", () => {
    vi.mocked(useRoomPresence).mockReturnValue(new Set()); // empty
    render(
      <LobbyView
        // ...minimal required props...
        roomId="r1"
        currentUserId="u1"
        memberships={[
          { userId: "u2", displayName: "Bob", avatarSeed: "b" },
        ]}
      />,
    );
    const row = screen.getByTestId("lobby-member-u2");
    expect(row).toHaveAttribute("data-online", "false");
    expect(row).toHaveClass("opacity-50");
  });

  it("preserves owner star for the owner regardless of online state", () => {
    vi.mocked(useRoomPresence).mockReturnValue(new Set());
    render(
      <LobbyView
        // ...minimal required props...
        roomId="r1"
        currentUserId="o1"
        ownerUserId="o1"
        memberships={[
          { userId: "o1", displayName: "Owner", avatarSeed: "x" },
        ]}
      />,
    );
    expect(screen.getByText("★")).toBeInTheDocument();
  });
});
```

The first two cases cover the happy path (online vs offline visual treatment). The third case is a regression check that the existing owner-badge logic (line 346) survives the JSX restructure.

Existing LobbyView tests should continue to pass since they don't currently inspect avatar-level details that this slice changes — the only structural change is the wrapper `<div>` adding the `data-testid` + `data-online` attributes.

### No orchestrator / API tests

UI-only slice.

### No Playwright

Single-window presence rendering — the slice's full behaviour is captured by RTL with a mocked hook return. The cross-browser presence channel is exercised by the existing announcer-roster Playwright cases (R4 cluster).

## Slice plan (one PR, ~3 tasks)

1. `<LobbyView>` props extension + `useRoomPresence` wiring + presence-aware roster render + RTL.
2. `page.tsx` plumbing (`roomId` + `currentUserId` props).
3. Final cleanup (TODO tick + push approval gate).

UI-only, ~half day.

## Risks

- **`useRoomPresence` mounted twice** — once in `<LobbyView>`, once in `<AnnouncingView>` (existing). The hook subscribes to the `presence:{roomId}` channel; running two subscriptions in parallel is fine (Supabase Realtime handles it), but in practice only one renders at a time (the room page swaps between LobbyView and AnnouncingView based on `room.status`). No actual collision.
- **30 s timeout window.** A user who closes their tab will linger on the roster as "online" for up to 30 s before greying out. Acceptable for MVP — matches spec wording (*"Grey-out on presence loss (>30 s since last broadcast ping)"*). Faster signal would require explicit `user_left` emission, which is out of scope.
- **First-mount empty Set.** When the lobby loads, `useRoomPresence` initialises `presenceUserIds` as an empty Set and updates after the first sync event arrives. For a brief window, every member shows offline. Mitigation: the sync arrives within ~100 ms — visually imperceptible. If future iteration shows a flicker, an `isHydrated` flag gate could suppress the initial empty render.
- **Avatar dot placement on small viewports.** The 12 px dot at `bottom-0 right-0` with `border-card` should remain visible on iPhone SE (320 px) where the 3-column grid puts each avatar at ~80 px wide. Smoke check on dev server before merge.
