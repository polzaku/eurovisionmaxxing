---
title: Screen wake lock (voting view)
date: 2026-04-27
spec_anchor: SPEC §8.9
phase: Phase R3 (item §8.9)
status: design
---

# Screen wake lock — implementation design

Maps SPEC §8.9 onto a controller class + thin React hook + single wire-in. SPEC §8.9 is the source of truth for behaviour; this doc captures the implementation shape and edge-case handling.

## Problem

Phones aggressively sleep during multi-hour shows. With nothing holding the screen awake, every phone goes dark every ~30s during the 3-hour voting window, interrupting voting + missing performances. The Web Wake Lock API (`navigator.wakeLock.request('screen')`) keeps the display awake but requires careful re-acquisition on `visibilitychange` because the browser auto-releases the lock when a tab loses visibility.

## Scope

In:
- `WakeLockController` class — wraps the Wake Lock API with a `setActive(boolean)` interface; handles feature detection, async request lifecycle, sentinel `release` events, document `visibilitychange` re-acquisition, and disposal.
- `useWakeLock(active)` thin React hook — owns the controller's lifecycle for one component.
- Wire-in to `VotingView` — single `useWakeLock(true)` call (`VotingView` is mounted only when `rooms.status = 'voting'`, so its mount/unmount already maps to the SPEC §8.9 voting-view rule).
- Unit tests on the controller, mocking `navigator.wakeLock` and `document` so they run in vitest's node env.

Out:
- `/room/{id}/present` wake-lock wire-in. Route doesn't exist yet — Phase 5c. The hook is built generically so plugging into `<PresentScreen>` later is one line.
- `voting_ending` status handling. SPEC §8.9 says "voting OR voting_ending"; the status enum doesn't have `voting_ending` yet (R0+R4 work). Adding it later is one prop change.
- User-visible toggle. SPEC explicitly says "deferred to V2".
- Toast/error UI on unsupported browsers. SPEC says "silently no-op".

## Architecture

Two new units, one wire-in.

### 1. `WakeLockController` — `src/lib/wakeLock/WakeLockController.ts`

```ts
export interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

export interface WakeLockApiLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export interface WakeLockControllerOpts {
  /** Defaults to globalThis.navigator. Pass a stub for tests. */
  navigator?: { wakeLock?: WakeLockApiLike } | undefined;
  /** Defaults to globalThis.document. Pass a stub for tests. */
  document?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> | undefined;
}

export class WakeLockController {
  constructor(opts?: WakeLockControllerOpts);
  setActive(active: boolean): void;  // idempotent
  dispose(): void;
}
```

**State**: one of `idle` | `pending` | `held` | `released-by-browser`. The class tracks:
- `desired: boolean` — what the caller asked for
- `sentinel: WakeLockSentinelLike | null` — the active lock if held
- `pendingRequest: Promise<...> | null` — in-flight request (so concurrent `setActive` calls don't double-request)
- `visibilityListener: (() => void) | null` — registered when desired=true

**Behaviour**:

- `setActive(true)`:
  - If `wakeLock` API absent on navigator → no-op forever (sets desired=true so subsequent ops still work, but acquisition will never start).
  - Else if `desired` already true → no-op.
  - Else: set `desired = true`, attach `visibilitychange` listener if not already, attempt acquisition (if `visibilityState === 'visible'`). If hidden, defer until next visibility change.
- `setActive(false)`:
  - Sets `desired = false`, detach `visibilitychange` listener, release current sentinel (await; if a request is in flight, await it then release).
- Sentinel `release` event (browser auto-released):
  - Set `sentinel = null`. The `visibilitychange` listener will re-acquire when the tab becomes visible again.
- `visibilitychange` to `visible` while `desired = true` and no `sentinel`:
  - Trigger acquisition (await `request('screen')`, store sentinel, attach `release` listener).
- `visibilitychange` to `hidden`:
  - No action. Browser auto-releases anyway.
- `dispose()`:
  - Equivalent to `setActive(false)`, plus belts-and-braces removal of any remaining listeners. Safe to call multiple times.

**Concurrency invariants**:

- Only ever one outstanding `request('screen')` Promise. If `setActive(true)` is called while a request is in flight, the existing Promise is returned/awaited (no second request).
- If `setActive(false)` is called while a request is in flight, the Promise is awaited then the resolved sentinel is released immediately. Final state: no sentinel held, listeners removed.
- Listener identity stable across calls (single function bound at construction; `addEventListener`/`removeEventListener` use the same reference).

### 2. `useWakeLock(active: boolean): void` — `src/hooks/useWakeLock.ts`

```ts
"use client";
export function useWakeLock(active: boolean): void;
```

- On first mount: instantiate one controller (via `useRef` or `useState` factory).
- On every render where `active` changed: call `controller.setActive(active)`.
- On unmount: call `controller.dispose()`.

~15 LOC.

### 3. Wire-in — `src/components/voting/VotingView.tsx`

Add at the top of the component body (any time before the render):

```ts
useWakeLock(true);
```

`VotingView` is mounted only when `rooms.status === 'voting'` (verified in `src/app/room/[id]/page.tsx`). When status transitions out (to `scoring`/`announcing`), the parent stops rendering `VotingView` → unmount → `useWakeLock` cleanup → controller dispose → sentinel released. This single line covers SPEC §8.9 bullet #1.

Note: when `voting_ending` status lands (R4), the page-level branching will continue to render `VotingView` for both `voting` and `voting_ending`. The hook stays `useWakeLock(true)` and continues to work.

## Test plan (TDD on the controller)

All tests use injected stubs for navigator/document — no JSDOM. Approach: a `FakeWakeLock` class returning `FakeSentinel` instances, plus a fake `document` with `visibilityState` + listener registry. Use `vi.useFakeTimers()` only if microtask ordering becomes load-bearing (likely not).

1. **Unsupported navigator** — `setActive(true)` followed by `setActive(false)` does nothing, raises no error, and request is never called.
2. **Supported + visible** — `setActive(true)` → exactly one `request('screen')` call → sentinel stored after Promise resolves.
3. **Idempotent acquisition** — `setActive(true)` twice in a row → still one outstanding request.
4. **Release on deactivate** — after acquisition, `setActive(false)` → sentinel.release() called once → controller's sentinel is null.
5. **Browser auto-release while still desired** — fire sentinel `release` event → controller doesn't immediately re-request; waits for visibility.
6. **Re-acquire on visibility return** — after auto-release while hidden, fire `visibilitychange` to visible → exactly one new `request('screen')` call → new sentinel stored.
7. **Hidden during initial setActive** — `document.visibilityState = 'hidden'` + `setActive(true)` → no request yet → `visibilitychange` to visible → request fires.
8. **No action on visibility → hidden** — visibility flips to hidden while desired and held → no extra calls; sentinel reference cleared by browser via `release` event when applicable.
9. **In-flight request + setActive(false)** — call setActive(true), await microtask one tick, then setActive(false) before request resolves → when request finally resolves, the resolved sentinel is released; controller ends up with no sentinel.
10. **dispose() cleans up listeners** — track `addEventListener` / `removeEventListener` calls on the document stub; after dispose, every visibility listener has been removed; calling setActive afterwards is allowed but a no-op (safe failure).
11. **dispose() is idempotent** — calling dispose() twice does not throw or double-release.

11 tests. Each ≤15 LOC. The pattern matches `MissedUndoController.test.ts` which is the established style in this repo.

## Files

New:
- `src/lib/wakeLock/WakeLockController.ts`
- `src/lib/wakeLock/WakeLockController.test.ts`
- `src/hooks/useWakeLock.ts`

Modified:
- `src/components/voting/VotingView.tsx` — add `import { useWakeLock } from "@/hooks/useWakeLock";` and one `useWakeLock(true);` line.

No schema, no API, no broadcast, no copy, no locale keys.

## Verification

- `npm run type-check` clean
- `npx vitest run` green (789→800-ish; +11 controller tests)
- `npm run lint` no new warnings
- `npm run dev` smoke: open the voting screen on a phone (or in browser devtools "device emulation"), open a long task that would normally trigger sleep (e.g. devtools idle for ~15s with the system display-sleep set short), confirm the screen stays awake. Switch tabs and back — confirm wake-lock re-acquires (devtools → Application → Wake Locks panel shows the active sentinel).

## Out-of-scope follow-ups

- `<PresentScreen>` wake lock when /present route lands (Phase 5c): single `useWakeLock(true)` call in that component.
- `voting_ending` extension: when R4 lands, no change needed to this code — the new status is rendered by the same `VotingView` branch.
- User-visible toggle if battery complaints emerge (V2).
