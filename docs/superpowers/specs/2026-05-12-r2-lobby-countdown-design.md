# R2 #238 Lobby countdown + JSON shape extension (R2 #241) — design

**Date:** 2026-05-12
**TODO refs:** [TODO.md:238](../../../TODO.md#L238) (lobby countdown), [TODO.md:241](../../../TODO.md#L241) (JSON shape extension — included as sub-step)
**SPEC ref:** §6.6.1 (Show countdown)
**Slice:** R2 lobby surfaces — second slice. Builds on R2 #239 (presence indicators, PR #99 merged). Operator backfill of `broadcastStartUtc` per `{year, event}` ([TODO.md:242](../../../TODO.md#L242)) and contestant primer carousel ([TODO.md:240](../../../TODO.md#L240)) are subsequent slices.

## Problem

Guests arrive 20–30 min before showtime. Today the lobby gives them a static avatar grid + categories preview but no signal of *when* the show is starting. SPEC §6.6.1 prescribes a prominent live countdown to broadcast start (`DD:HH:MM:SS` → `HH:MM:SS` collapse in the final 24 h). When `broadcastStartUtc` is unknown (a practice room or pre-backfill data), the countdown is suppressed and replaced with *"Ready whenever you are."*

Today there's no place to even put `broadcastStartUtc` in the data pipeline:

- The hardcoded JSON files at `data/contestants/{year}/{event}.json` are flat `[{ country, artist, song, runningOrder }, ...]` arrays. No wrapper.
- The fetcher [src/lib/contestants.ts:60](../../../src/lib/contestants.ts#L60) validates flat arrays only.
- The room API response surfaces `Contestant[]` only.

This slice adds the data plumbing AND the UI surface in one PR.

## Goals

- **Live ticking countdown** in the lobby. `DD:HH:MM:SS` (>24 h) → `HH:MM:SS` (≤24 h) → fallback copy when null/past.
- **Dual-shape JSON support.** Existing flat-array files keep working forever; new files use a wrapper `{ broadcastStartUtc?: string | null, contestants: [...] }`. Operator backfill becomes a per-file decision.
- **Zero breaking change to `fetchContestants`.** The existing function keeps signature `Promise<Contestant[]>`. A parallel `fetchContestantsAndMeta` returns metadata + contestants.
- **Server response carries `broadcastStartUtc: string | null`.** No second HTTP call needed from the client.
- **Pure formatter helper** `formatCountdown(targetMs, nowMs)` — testable without timer mocking.
- **Component-local interval.** `<LobbyCountdown>` owns its own `setInterval(1000)`; no parent prop drilling for time updates.

## Non-goals

- Operator backfill of production JSON files ([TODO.md:242](../../../TODO.md#L242)). Out of scope; we ship the code surface and the operator flips the switch per event when ready.
- Migrating production JSON files to wrapper shape. Dual-shape support means flat-array files keep working forever; migration is housekeeping that can happen later.
- Contestant primer carousel ([TODO.md:240](../../../TODO.md#L240)). Needs `artistPreviewUrl` per-contestant — different field, different surface, separate slice.
- DD:HH:MM:SS → HH:MM:SS transition animation. The countdown re-renders every second; the format collapses naturally at the 24 h boundary in a single render. No animated transition needed.
- Localized digit formatting (e.g., Arabic numerals). The DD:HH:MM:SS string is locale-independent — every project locale uses base-10 ASCII digits.

## Architecture

Five coordinated additions:

### (a) JSON shape — dual-shape support

The validator and loader in [src/lib/contestants.ts](../../../src/lib/contestants.ts) accept either:

- **Legacy:** flat `[{ country, artist, song, runningOrder }, ...]` array → `broadcastStartUtc` resolves to `null`.
- **New:** wrapper object `{ broadcastStartUtc?: string | null, contestants: [...] }` → metadata + contestants both surfaced.

A new helper `parseContestantsJson(data)` returns `{ contestants, broadcastStartUtc } | null`. Both `loadFromHardcoded` and the API path use it.

### (b) `fetchContestantsAndMeta`

New parallel function:

```ts
export async function fetchContestantsAndMeta(
  year: number,
  event: EventType,
  options?: FetchContestantsOptions,
): Promise<{ contestants: Contestant[]; broadcastStartUtc: string | null }>;
```

Existing `fetchContestants` becomes a thin wrapper that returns just `.contestants`. EurovisionAPI path returns `null` for `broadcastStartUtc` (the upstream doesn't expose it); only hardcoded JSON in wrapper shape can carry the value.

### (c) Server route response

The `/api/rooms/[id]` route's `loadRoom` (or wherever the contestant fetch happens server-side) calls `fetchContestantsAndMeta` instead of `fetchContestants`. Response payload gains:

```ts
{
  ...,
  broadcastStartUtc: string | null;
}
```

### (d) Client wiring

[src/app/room/[id]/page.tsx](../../../src/app/room/[id]/page.tsx) — `Phase['ready']` shape gains `broadcastStartUtc: string | null` (or kept on `room`/`contestants`-adjacent — pick whichever fits the existing structure). Threaded into `<LobbyView>` as a new optional prop.

### (e) `<LobbyView>` + `<LobbyCountdown>`

`<LobbyView>` adds an optional `broadcastStartUtc?: string | null` prop. Renders `<LobbyCountdown broadcastStartUtc={...} />` near the top — between the room PIN/QR section and the existing "Who's here" roster.

`<LobbyCountdown>` is the new component (next section).

## Components

### 1. `formatCountdown` pure helper

[src/lib/lobby/formatCountdown.ts](../../../src/lib/lobby/formatCountdown.ts):

```ts
/**
 * Format a millisecond delta as a Eurovision-style countdown string.
 *
 * - Returns `DD:HH:MM:SS` (zero-padded each segment) when delta > 24h.
 * - Returns `HH:MM:SS` when delta is positive but ≤ 24h.
 * - Returns null when the target is in the past or zero (caller renders
 *   the "Ready whenever you are." fallback in that case).
 *
 * Pure — no Date.now() or Intl dependency. Caller passes both timestamps
 * so tests can drive deterministic boundaries.
 */
export function formatCountdown(
  targetMs: number,
  nowMs: number,
): string | null {
  const diff = targetMs - nowMs;
  if (diff <= 0) return null;
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
```

### 2. `<LobbyCountdown>` component

[src/components/room/LobbyCountdown.tsx](../../../src/components/room/LobbyCountdown.tsx):

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatCountdown } from "@/lib/lobby/formatCountdown";

interface LobbyCountdownProps {
  /** ISO 8601 UTC timestamp of broadcast start. Null suppresses the
   * countdown and renders the fallback copy ("Ready whenever you are."). */
  broadcastStartUtc: string | null;
}

const TICK_MS = 1000;

export default function LobbyCountdown({
  broadcastStartUtc,
}: LobbyCountdownProps) {
  const t = useTranslations();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!broadcastStartUtc) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [broadcastStartUtc]);

  const targetMs = broadcastStartUtc
    ? new Date(broadcastStartUtc).getTime()
    : null;
  const formatted =
    targetMs !== null && !Number.isNaN(targetMs)
      ? formatCountdown(targetMs, now)
      : null;

  if (formatted === null) {
    return (
      <section
        data-testid="lobby-countdown"
        data-state="fallback"
        className="text-center"
      >
        <p className="text-sm text-muted-foreground">
          {t("lobby.countdown.fallback")}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="lobby-countdown"
      data-state="ticking"
      className="text-center space-y-1"
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("lobby.countdown.label")}
      </p>
      <p
        className="font-mono text-3xl font-bold tabular-nums tracking-wider"
        aria-live="polite"
      >
        {formatted}
      </p>
    </section>
  );
}
```

The interval only spins when `broadcastStartUtc` is non-null — otherwise the fallback render skips the timer entirely.

### 3. JSON shape parser

In [src/lib/contestants.ts](../../../src/lib/contestants.ts), replace the existing `validateContestants` with a more general parser:

```ts
function parseContestantsJson(
  data: unknown,
): { contestants: ApiContestant[]; broadcastStartUtc: string | null } | null {
  // Legacy: flat array of contestants.
  if (Array.isArray(data)) {
    if (!data.every(isApiContestant)) return null;
    return { contestants: data, broadcastStartUtc: null };
  }
  // New: wrapper object.
  if (typeof data === "object" && data !== null) {
    const wrapper = data as Record<string, unknown>;
    const contestants = wrapper.contestants;
    if (!Array.isArray(contestants) || !contestants.every(isApiContestant)) {
      return null;
    }
    const startUtc =
      typeof wrapper.broadcastStartUtc === "string"
        ? wrapper.broadcastStartUtc
        : null;
    return { contestants: contestants as ApiContestant[], broadcastStartUtc: startUtc };
  }
  return null;
}

function isApiContestant(item: unknown): item is ApiContestant {
  if (typeof item !== "object" || item === null) return false;
  const c = item as Record<string, unknown>;
  return (
    typeof c.country === "string" &&
    typeof c.artist === "string" &&
    typeof c.song === "string" &&
    typeof c.runningOrder === "number"
  );
}
```

The existing `validateContestants` is retained as a thin wrapper for any external callers, but the new internal path uses `parseContestantsJson`.

### 4. `fetchContestantsAndMeta` + `fetchContestants` thin wrapper

```ts
export async function fetchContestantsAndMeta(
  year: number,
  event: EventType,
  options: FetchContestantsOptions = {},
): Promise<{ contestants: Contestant[]; broadcastStartUtc: string | null }> {
  // Test fixture path
  if (year === TEST_FIXTURE_YEAR) {
    if (!isTestFixtureYear(year)) {
      throw new ContestDataError(/* ... */);
    }
    return loadFromHardcodedWithMeta(year, event);
  }

  // EurovisionAPI path — upstream doesn't expose broadcastStartUtc.
  try {
    const url = `${EUROVISION_API_BASE}/contests/${year}/events/${eventMap[event]}/contestants`;
    const res = await fetch(url, /* ... */);
    if (res.ok) {
      const data = await res.json();
      const parsed = parseContestantsJson(data);
      if (parsed) {
        const contestants = parsed.contestants
          .map((item) => mapApiToContestant(item, year, event))
          .sort((a, b) => a.runningOrder - b.runningOrder);
        return { contestants, broadcastStartUtc: parsed.broadcastStartUtc };
      }
    }
  } catch (err) {
    console.warn(/* ... */);
  }

  // Hardcoded JSON fallback
  try {
    return await loadFromHardcodedWithMeta(year, event);
  } catch {
    /* ... */
  }
  throw new ContestDataError(`Contest data not found for ${year} ${event}`);
}

export async function fetchContestants(
  year: number,
  event: EventType,
  options?: FetchContestantsOptions,
): Promise<Contestant[]> {
  const { contestants } = await fetchContestantsAndMeta(year, event, options);
  return contestants;
}
```

`loadFromHardcodedWithMeta` is the new internal helper that uses `parseContestantsJson` and returns the wrapper. The legacy `loadFromHardcoded` becomes a thin wrapper for any internal callers (delete it if no other callers exist).

### 5. Server route response

Find the route that returns room + contestants (likely [src/app/api/rooms/[id]/route.ts](../../../src/app/api/rooms/[id]/route.ts) or `loadRoom` in `src/lib/rooms/`). Replace its `fetchContestants` call with `fetchContestantsAndMeta` and add `broadcastStartUtc` to the response payload:

```ts
const { contestants, broadcastStartUtc } = await fetchContestantsAndMeta(
  room.year,
  room.event,
);
return NextResponse.json({
  ...,
  contestants,
  broadcastStartUtc,
});
```

### 6. Client wiring

[src/app/room/[id]/page.tsx](../../../src/app/room/[id]/page.tsx) — `Phase['ready']` shape gains `broadcastStartUtc: string | null`. Set during `load()` from the API response. Pass to `<LobbyView>` as `broadcastStartUtc={phase.broadcastStartUtc}`.

### 7. `<LobbyView>` integration

`<LobbyView>` gains an optional prop:

```ts
interface LobbyViewProps {
  // ...existing...
  /** SPEC §6.6.1 — when null, the countdown surface renders the
   * "Ready whenever you are." fallback. */
  broadcastStartUtc?: string | null;
}
```

Render `<LobbyCountdown broadcastStartUtc={broadcastStartUtc ?? null} />` near the top of the `<main>` content, between the room PIN/QR section and the "Who's here" roster.

### 8. Test fixture migration

Migrate the test fixture files to the new wrapper shape with a real value:

- `data/contestants/9999/semi1.json`
- `data/contestants/9999/semi2.json`
- `data/contestants/9999/final.json`

Each becomes:

```json
{
  "broadcastStartUtc": "2026-05-16T19:00:00Z",
  "contestants": [/* existing 5 fixture contestants */]
}
```

This exercises the wrapper path in unit tests AND lets dev rooms render an actual countdown for manual smoke. Production JSON files (2025/*, 2026/*) stay flat — the operator backfills them later.

### 9. Locale keys

In [src/locales/en.json](../../../src/locales/en.json), under the existing `lobby.*` namespace (or add a new top-level `lobby` namespace if absent):

```json
"lobby": {
  "countdown": {
    "label": "Showtime in",
    "fallback": "Ready whenever you are."
  }
}
```

Other locale files (`es`, `uk`, `fr`, `de`) get empty stubs per the existing convention — `locales.test.ts` enforces parity.

## Tests

### Unit

- **`formatCountdown.test.ts`** — 6 cases:
  1. Delta > 24 h → `DD:HH:MM:SS` with zero-padding.
  2. Delta exactly 24 h → `00:00:00:00`-style boundary returns `DD:HH:MM:SS` (24 h means 1 day technically; verify the boundary returns the 4-segment form).
  3. Delta < 24 h, > 1 h → `HH:MM:SS`.
  4. Delta < 1 hour, > 1 min → `00:MM:SS`.
  5. Delta < 1 minute → `00:00:SS`.
  6. Delta ≤ 0 → null.
- **`contestants.test.ts`** — extend with:
  - Wrapper object → returns `{ contestants, broadcastStartUtc }` with the parsed timestamp.
  - Legacy flat array → returns `{ contestants, broadcastStartUtc: null }`.
  - Wrapper with absent/non-string `broadcastStartUtc` → returns `null` for the metadata.
  - Wrapper with malformed `contestants` → parse fails (returns null overall).

### RTL

- **`LobbyCountdown.test.tsx`** — 4 cases (uses `vi.useFakeTimers` + `vi.setSystemTime`):
  1. `broadcastStartUtc=null` renders fallback copy + `data-state="fallback"`.
  2. Future `broadcastStartUtc` (1 h ahead) renders `01:00:00`-style + `data-state="ticking"`.
  3. Past `broadcastStartUtc` renders fallback copy.
  4. Tick — advance the fake clock by 1 second; assert the rendered string updates to one second less.
- **`LobbyView.test.tsx`** — 2 new cases:
  1. `broadcastStartUtc` provided → countdown section renders.
  2. `broadcastStartUtc` undefined/null → countdown still renders (in fallback state).

### No new orchestrator tests

Server-side change is just adding a field to the response.

### No Playwright

UI surface is pure render — no network, no realtime, no cross-window concerns. Manual smoke on dev server before merge.

## Slice plan (one PR, ~6 tasks)

1. Locale keys (`lobby.countdown.label`, `lobby.countdown.fallback` + non-en stubs).
2. `formatCountdown` pure helper + unit tests (TDD).
3. `<LobbyCountdown>` component + RTL (TDD).
4. JSON dual-shape parser + `fetchContestantsAndMeta` + extended `contestants.test.ts` + test-fixture migration.
5. Server route response + `<LobbyView>` props + `page.tsx` wiring + extended `LobbyView.test.tsx`.
6. Final cleanup (TODO tick + push approval gate).

UI-heavy slice. ~half day.

## Risks

- **JSON dual-shape parser robustness.** A malformed wrapper that lacks the `contestants` key would parse as `null` (no contestants), causing the whole load to fall through to the next path in the cascade. Validate the wrapper carefully — the unit tests cover this.
- **Client clock skew.** The countdown computes `targetMs - Date.now()`. If the user's device clock is 5 min slow, the countdown will be off by 5 min. Acceptable for MVP — Eurovision broadcast time is well-publicized; users with broken clocks have bigger problems. No NTP sync logic.
- **Component re-renders every second.** A `setInterval(1000)` in a mounted component triggers state update every second. React batches this fine (single render per tick) and the component is small — the cost is negligible compared to the room's polling and broadcast subscriptions.
- **The existing `validateContestants` wrapper.** Some external callers may import it directly. Verify by grep before deletion. If callers exist, keep the legacy wrapper around as a thin compatibility shim (returns `data is ApiContestant[]` for the array case only).
- **Server route shape change.** Existing tests on the room API route may strict-equal the response object. The new `broadcastStartUtc` field is additive but the test diffs may need updating. Each new test should explicitly include the field; existing tests should ignore it via `expect.objectContaining({...})`.
