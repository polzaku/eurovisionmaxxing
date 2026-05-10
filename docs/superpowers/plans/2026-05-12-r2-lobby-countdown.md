# R2 #238 Lobby Countdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live ticking countdown in the lobby (`DD:HH:MM:SS` → `HH:MM:SS` collapse → "Ready whenever you are." fallback) plus the JSON dual-shape support that lets `data/contestants/{year}/{event}.json` carry an optional `broadcastStartUtc` field.

**Architecture:** Pure formatter helper + isolated `<LobbyCountdown>` component with its own `setInterval(1000)`. Existing `fetchContestantsMeta` (already shipped) reads the metadata; this slice **upgrades `fetchContestants` to also handle the wrapper shape** so a JSON file can be safely migrated. `getRoom` orchestrator gains a `fetchContestantsMeta` dep, server response gains `broadcastStartUtc`, threaded through `page.tsx` to `<LobbyView>` to `<LobbyCountdown>`.

**Tech Stack:** Next.js 14 App Router, React 18, Vitest + RTL with jsdom (per-file `// @vitest-environment jsdom`), Tailwind for styling, `next-intl` for locale strings.

**Spec:** [docs/superpowers/specs/2026-05-12-r2-lobby-countdown-design.md](../specs/2026-05-12-r2-lobby-countdown-design.md)

**Branch:** `feat/r2-lobby-countdown` — currently 1 commit ahead of main (spec doc, `031032a`). Based on main with R2 #239 (PR #99) merged.

**Key existing scaffolding:**
- `fetchContestantsMeta` at [src/lib/contestants.ts:195](../../../src/lib/contestants.ts#L195) — **already exists**, handles both flat-array and wrapper-object shapes for metadata reading.
- `fetchContestants` at [src/lib/contestants.ts:101](../../../src/lib/contestants.ts#L101) — **only handles flat-array shape today**, needs upgrade in Task 4.
- `getRoom` at [src/lib/rooms/get.ts:89](../../../src/lib/rooms/get.ts#L89) — DI pattern accepts `fetchContestants` as a dep; Task 5 adds `fetchContestantsMeta` as a sibling dep.
- `<LobbyView>` at [src/components/room/LobbyView.tsx](../../../src/components/room/LobbyView.tsx) — parent that mounts `<LobbyCountdown>`.
- `src/locales/locales.test.ts` enforces non-en stub parity (R2 #239 added stubs to es/uk/fr/de — same convention).

---

## Task 1: Locale keys

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/{es,uk,fr,de}.json` (empty stubs per locales.test.ts parity rule)

- [ ] **Step 1: Read locales test to confirm parity policy**

```bash
cat /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/locales/locales.test.ts
```

Confirm: parity is enforced (R2 #239 had to add empty stubs to es/uk/fr/de). Same convention applies here.

- [ ] **Step 2: Add `lobby.countdown.*` to `src/locales/en.json`**

Find the existing `"lobby"` namespace (a top-level key already exists from R2 #239 work — inspect first to confirm). Add a new sub-namespace inside it:

```json
"lobby": {
  ...existing keys...,
  "countdown": {
    "label": "Showtime in",
    "fallback": "Ready whenever you are."
  }
}
```

If `"lobby"` doesn't exist as a top-level namespace (only `"lobby.refreshContestants"` does, for example), create it. Place alphabetically.

- [ ] **Step 3: Add empty stubs to non-en locale files**

For each of `src/locales/{es,uk,fr,de}.json`, add the same nested structure with empty strings:

```json
"lobby": {
  ...existing stubs...,
  "countdown": { "label": "", "fallback": "" }
}
```

- [ ] **Step 4: Run the locales test**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/locales 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en.json src/locales/es.json src/locales/uk.json src/locales/fr.json src/locales/de.json
git commit -m "$(cat <<'EOF'
feat(locale): lobby.countdown.* keys (R2 #238)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `formatCountdown` pure helper (TDD)

**Files:**
- Create: `src/lib/lobby/formatCountdown.ts`
- Create: `src/lib/lobby/formatCountdown.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/lobby/formatCountdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCountdown } from "@/lib/lobby/formatCountdown";

describe("formatCountdown", () => {
  it("returns DD:HH:MM:SS when delta > 24h (3 days, 14h, 25m, 9s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0); // 2026-05-12T00:00:00Z
    const target = now + 3 * 86400_000 + 14 * 3600_000 + 25 * 60_000 + 9 * 1000;
    expect(formatCountdown(target, now)).toBe("03:14:25:09");
  });

  it("returns DD:HH:MM:SS at exactly 24h (boundary — 1 day, 0h)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 24 * 3600_000;
    expect(formatCountdown(target, now)).toBe("01:00:00:00");
  });

  it("returns HH:MM:SS when delta < 24h (4h, 32m, 12s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 4 * 3600_000 + 32 * 60_000 + 12 * 1000;
    expect(formatCountdown(target, now)).toBe("04:32:12");
  });

  it("returns HH:MM:SS with leading zeros when delta < 1h (45m, 30s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 45 * 60_000 + 30 * 1000;
    expect(formatCountdown(target, now)).toBe("00:45:30");
  });

  it("returns 00:00:SS when delta < 1 minute (15s)", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now + 15 * 1000;
    expect(formatCountdown(target, now)).toBe("00:00:15");
  });

  it("returns null when delta is exactly 0", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    expect(formatCountdown(now, now)).toBeNull();
  });

  it("returns null when target is in the past", () => {
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const target = now - 1000;
    expect(formatCountdown(target, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib/lobby/formatCountdown.test.ts 2>&1 | tail -15
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the implementation**

`src/lib/lobby/formatCountdown.ts`:

```ts
/**
 * SPEC §6.6.1 — format a millisecond delta as a Eurovision-style countdown.
 *
 * - Returns `DD:HH:MM:SS` (zero-padded each segment) when delta > 0 and
 *   includes 1+ full days.
 * - Returns `HH:MM:SS` when delta is positive but < 1 day.
 * - Returns null when the target is at or before now (caller renders the
 *   "Ready whenever you are." fallback in that case).
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
  if (days > 0) {
    return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib/lobby/formatCountdown.test.ts 2>&1 | tail -10
```

Expected: 7 PASS.

- [ ] **Step 5: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/lobby/formatCountdown.ts src/lib/lobby/formatCountdown.test.ts
git commit -m "$(cat <<'EOF'
feat(lobby): formatCountdown pure helper (R2 #238)

DD:HH:MM:SS when delta includes 1+ days, HH:MM:SS otherwise.
Returns null when target is at or before now (caller renders the
"Ready whenever you are." fallback). Pure — no Date.now() / Intl.
Caller passes both timestamps for deterministic tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `<LobbyCountdown>` component (TDD)

**Files:**
- Create: `src/components/room/LobbyCountdown.tsx`
- Create: `src/components/room/LobbyCountdown.test.tsx`

- [ ] **Step 1: Write the failing RTL tests**

`src/components/room/LobbyCountdown.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import LobbyCountdown from "./LobbyCountdown";

describe("LobbyCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the fallback copy when broadcastStartUtc is null", () => {
    render(<LobbyCountdown broadcastStartUtc={null} />);
    const section = screen.getByTestId("lobby-countdown");
    expect(section).toHaveAttribute("data-state", "fallback");
    expect(screen.getByText("lobby.countdown.fallback")).toBeInTheDocument();
  });

  it("renders the digits + label when broadcastStartUtc is in the future", () => {
    // 1h ahead of system time
    render(
      <LobbyCountdown broadcastStartUtc="2026-05-12T01:00:00.000Z" />,
    );
    const section = screen.getByTestId("lobby-countdown");
    expect(section).toHaveAttribute("data-state", "ticking");
    expect(screen.getByText("lobby.countdown.label")).toBeInTheDocument();
    expect(screen.getByText("01:00:00")).toBeInTheDocument();
  });

  it("renders the fallback copy when broadcastStartUtc is in the past", () => {
    render(
      <LobbyCountdown broadcastStartUtc="2026-05-11T00:00:00.000Z" />,
    );
    const section = screen.getByTestId("lobby-countdown");
    expect(section).toHaveAttribute("data-state", "fallback");
  });

  it("ticks the displayed digits every second", () => {
    render(
      <LobbyCountdown broadcastStartUtc="2026-05-12T00:00:10.000Z" />,
    );
    expect(screen.getByText("00:00:10")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("00:00:09")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("00:00:08")).toBeInTheDocument();
  });

  it("shows DD:HH:MM:SS format when delta > 24h", () => {
    render(
      <LobbyCountdown broadcastStartUtc="2026-05-15T03:30:00.000Z" />,
    );
    // 3 days, 3h, 30m, 0s ahead
    expect(screen.getByText("03:03:30:00")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/LobbyCountdown.test.tsx 2>&1 | tail -15
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the component**

`src/components/room/LobbyCountdown.tsx`:

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

/**
 * SPEC §6.6.1 — live ticking countdown shown in the lobby. DD:HH:MM:SS
 * when delta > 24h, HH:MM:SS in the final 24h, fallback copy when the
 * target is null or in the past.
 */
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

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/LobbyCountdown.test.tsx 2>&1 | tail -15
```

Expected: 5 PASS.

- [ ] **Step 5: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/room/LobbyCountdown.tsx src/components/room/LobbyCountdown.test.tsx
git commit -m "$(cat <<'EOF'
feat(lobby): LobbyCountdown component (R2 #238 / §6.6.1)

Component-local setInterval(1000) drives state updates; pure
formatCountdown helper produces the DD:HH:MM:SS or HH:MM:SS string.
Renders fallback copy when broadcastStartUtc is null, malformed, or
in the past.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Upgrade `fetchContestants` to handle wrapper shape (TDD)

**Why:** `fetchContestantsMeta` already supports both shapes (flat array AND `{ broadcastStartUtc?, contestants: [...] }`). But `fetchContestants` only handles the flat array — `validateContestants` rejects the wrapper. If anyone migrates a JSON file to wrapper shape today, the contestants load fails. This task aligns the readers.

**Files:**
- Modify: `src/lib/contestants.ts`
- Modify: `src/lib/contestants.test.ts`
- Modify: `data/contestants/9999/{semi1,semi2,final}.json` (test fixture migration)

- [ ] **Step 1: Add failing tests for wrapper-shape parsing**

In `src/lib/contestants.test.ts`, find the existing `loadFromHardcoded` / `fetchContestants` tests. Add a new describe block:

```ts
describe("fetchContestants — wrapper-shape JSON support (R2 #238)", () => {
  it("loads contestants from wrapper-shape JSON file (test fixture)", async () => {
    // The 9999/* fixtures are migrated to wrapper shape in this task.
    const contestants = await fetchContestants(TEST_FIXTURE_YEAR, "final");
    expect(Array.isArray(contestants)).toBe(true);
    expect(contestants.length).toBeGreaterThan(0);
    expect(contestants[0]).toMatchObject({
      country: expect.any(String),
      artist: expect.any(String),
      song: expect.any(String),
      runningOrder: expect.any(Number),
    });
  });
});
```

The `TEST_FIXTURE_YEAR` and `"final"` references mirror existing test patterns. If the existing tests use a different way to access the fixture, mirror that.

- [ ] **Step 2: Run tests — they should pass for the legacy shape (existing fixture is flat array) but the new test will fail once we migrate the fixture**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib/contestants.test.ts 2>&1 | tail -15
```

Expected: existing tests pass; new wrapper-shape test passes too because the fixture is still flat. We need to migrate the fixture first to drive the failure.

- [ ] **Step 3: Migrate the test fixture JSON files to wrapper shape**

For each of `data/contestants/9999/{semi1,semi2,final}.json`:

Read the existing file (it's a flat array of 5 fixture contestants). Wrap it:

```json
{
  "broadcastStartUtc": "2026-05-16T19:00:00Z",
  "contestants": [
    /* ...existing 5 fixture contestants verbatim... */
  ]
}
```

Use the same timestamp for all three files — the test fixture is for dev smoke, not realistic data.

- [ ] **Step 4: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib/contestants.test.ts 2>&1 | tail -15
```

Expected: the new wrapper-shape test FAILS — `fetchContestants` calls `validateContestants` which only accepts arrays. With the fixture now wrapper-shaped, `validateContestants` returns false → `loadFromHardcoded` throws `ContestDataError`. This is the failing state we wanted.

- [ ] **Step 5: Upgrade `fetchContestants` to handle wrapper shape**

Open `src/lib/contestants.ts`. Find `validateContestants` (around line 60) and `loadFromHardcoded` (around line 165).

Add a new helper `parseContestantsJson` and rewire `loadFromHardcoded`:

```ts
/**
 * Parse contestants JSON in either legacy (flat array) or wrapper shape.
 * Returns null if the input doesn't match either shape.
 */
function parseContestantsJson(data: unknown): ApiContestant[] | null {
  // Legacy: bare array of contestants.
  if (Array.isArray(data)) {
    return data.every(isApiContestant) ? data : null;
  }
  // Wrapper: { broadcastStartUtc?, contestants: [...] }.
  if (typeof data === "object" && data !== null) {
    const wrapper = data as Record<string, unknown>;
    const inner = wrapper.contestants;
    if (Array.isArray(inner) && inner.every(isApiContestant)) {
      return inner as ApiContestant[];
    }
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

Replace the existing `validateContestants` body with a call to `parseContestantsJson` for backward compat:

```ts
function validateContestants(data: unknown): data is ApiContestant[] {
  return Array.isArray(data) && parseContestantsJson(data) !== null;
}
```

(Or delete `validateContestants` entirely if no external callers rely on it. Grep first.)

Update `loadFromHardcoded` to use `parseContestantsJson` instead of `validateContestants`:

```ts
async function loadFromHardcoded(
  year: number,
  event: EventType
): Promise<Contestant[]> {
  const fallback = await import(`../../data/contestants/${year}/${event}.json`);
  const data = fallback.default ?? fallback;
  const parsed = parseContestantsJson(data);
  if (parsed === null) {
    throw new ContestDataError(`Hardcoded data invalid for ${year} ${event}`);
  }
  return parsed
    .map((item: ApiContestant) => mapApiToContestant(item, year, event))
    .sort((a, b) => a.runningOrder - b.runningOrder);
}
```

Update the EurovisionAPI path inside `fetchContestants` to use the same parser (around line 134):

```ts
if (res.ok) {
  const data = await res.json();
  const parsed = parseContestantsJson(data);
  if (parsed) {
    return parsed
      .map((item) => mapApiToContestant(item, year, event))
      .sort((a, b) => a.runningOrder - b.runningOrder);
  }
}
```

(The upstream API returns flat arrays, but using `parseContestantsJson` for both paths keeps the parsing logic in one place.)

- [ ] **Step 6: Run tests to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib/contestants.test.ts 2>&1 | tail -15
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib 2>&1 | tail -5
```

Expected: ALL PASS — the new wrapper-shape test now succeeds, plus all existing tests (regression).

- [ ] **Step 7: Type-check**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/contestants.ts src/lib/contestants.test.ts data/contestants/9999/semi1.json data/contestants/9999/semi2.json data/contestants/9999/final.json
git commit -m "$(cat <<'EOF'
feat(contestants): fetchContestants accepts wrapper-shape JSON (R2 #238 / R2 #241)

parseContestantsJson handles both legacy flat arrays and the new
{ broadcastStartUtc?, contestants: [...] } wrapper shape that
fetchContestantsMeta already supports. Aligns the two readers so a
JSON file can be safely migrated to the wrapper shape.

Test fixture (year 9999) migrated to wrapper shape with a fixture
broadcastStartUtc value to exercise the new code path. Production
JSON files (2025/*, 2026/*) stay flat — operator backfills per
TODO #242 when ready.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `broadcastStartUtc` through getRoom → API → page → LobbyView (TDD)

**Files:**
- Modify: `src/lib/rooms/get.ts` (extend `GetRoomDeps` + `GetRoomData`, call `fetchContestantsMeta`)
- Modify: `src/lib/rooms/get.test.ts` (extend mocks + assertions)
- Modify: `src/app/api/rooms/[id]/route.ts` (inject `fetchContestantsMeta` dep)
- Modify: `src/app/api/rooms/[id]/route.test.ts` if it asserts on the response shape
- Modify: `src/app/room/[id]/page.tsx` (thread `broadcastStartUtc` to `<LobbyView>`)
- Modify: `src/components/room/LobbyView.tsx` (accept `broadcastStartUtc` prop, mount `<LobbyCountdown>`)
- Modify: `src/components/room/LobbyView.test.tsx` (extend `renderLobby` helper + 2 new cases)

- [ ] **Step 1: Add failing tests for the LobbyView integration**

Open `src/components/room/LobbyView.test.tsx`. The existing `renderLobby` helper has a `RenderOpts` interface — extend it:

```ts
interface RenderOpts {
  ...existing fields...
  broadcastStartUtc?: string | null;
}
```

Pass the new prop in the `<LobbyView>` JSX inside `renderLobby`:

```tsx
broadcastStartUtc={opts.broadcastStartUtc}
```

Add a new describe block at the bottom:

```ts
describe("<LobbyView> — countdown section (R2 #238)", () => {
  it("renders <LobbyCountdown> in fallback state when broadcastStartUtc is null", () => {
    renderLobby({ broadcastStartUtc: null });
    const countdown = screen.getByTestId("lobby-countdown");
    expect(countdown).toHaveAttribute("data-state", "fallback");
  });

  it("renders <LobbyCountdown> in ticking state when broadcastStartUtc is a future ISO timestamp", () => {
    // Use a timestamp far in the future (year 2099) so the test isn't
    // sensitive to the system clock at run time.
    renderLobby({ broadcastStartUtc: "2099-01-01T00:00:00.000Z" });
    const countdown = screen.getByTestId("lobby-countdown");
    expect(countdown).toHaveAttribute("data-state", "ticking");
  });
});
```

`<LobbyCountdown>` itself isn't mocked here — the real component renders. Tests rely on the existing `next-intl` mock at the top of `LobbyView.test.tsx` (which returns the key as the rendered string) so no additional mocking is needed.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/LobbyView.test.tsx 2>&1 | tail -15
```

Expected: 2 new tests FAIL — `<LobbyCountdown>` not rendered yet.

- [ ] **Step 3: Add `broadcastStartUtc` prop to `<LobbyView>`**

Open `src/components/room/LobbyView.tsx`. In the `LobbyViewProps` interface, add the new optional prop:

```ts
/**
 * SPEC §6.6.1 — when null, <LobbyCountdown> renders the
 * "Ready whenever you are." fallback. When a valid ISO 8601 UTC
 * timestamp, the countdown ticks down to that target.
 */
broadcastStartUtc?: string | null;
```

Destructure it in the function signature alongside other props:

```ts
broadcastStartUtc,
```

- [ ] **Step 4: Mount `<LobbyCountdown>` in the JSX**

Add the import at the top:

```ts
import LobbyCountdown from "@/components/room/LobbyCountdown";
```

In the JSX, find a sensible insertion point — between the room PIN/QR section and the "Who's here" roster (around line 333 — search for `Who&rsquo;s here`). Add a new `<section>`:

```tsx
<section className="space-y-3">
  <LobbyCountdown broadcastStartUtc={broadcastStartUtc ?? null} />
</section>
```

The `?? null` is defensive — the component itself already handles undefined → fallback, but explicit null mirrors the prop type.

- [ ] **Step 5: Run LobbyView tests to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/LobbyView.test.tsx 2>&1 | tail -15
```

Expected: ALL PASS — 2 new + every existing test (regression).

- [ ] **Step 6: Extend `getRoom` orchestrator + dependency type**

Open `src/lib/rooms/get.ts`. Update `GetRoomDeps` (around line 21) to add a sibling dep:

```ts
export interface GetRoomDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (year: number, event: EventType) => Promise<Contestant[]>;
  /** SPEC §6.6.1 — read broadcastStartUtc from the JSON wrapper if present. */
  fetchContestantsMeta: (
    year: number,
    event: EventType,
  ) => Promise<{ broadcastStartUtc: string | null }>;
}
```

Update `GetRoomData` (around line 35):

```ts
export interface GetRoomData {
  room: Room;
  memberships: MembershipView[];
  contestants: Contestant[];
  votes: VoteView[];
  /** SPEC §6.6.1 — null when the JSON file uses the legacy flat-array
   * shape or doesn't carry the field. */
  broadcastStartUtc: string | null;
}
```

Inside the orchestrator body (after the existing `await deps.fetchContestants(...)` call around line 128), add:

```ts
let broadcastStartUtc: string | null = null;
try {
  const meta = await deps.fetchContestantsMeta(room.year, room.event);
  broadcastStartUtc = meta.broadcastStartUtc;
} catch {
  // Metadata is best-effort — falling back to null when the file is
  // missing/malformed mirrors the contestant fallback chain.
}
```

Include `broadcastStartUtc` in the success-data return.

- [ ] **Step 7: Update `get.test.ts` mocks**

Find existing mocks for `fetchContestants` in `src/lib/rooms/get.test.ts`. Add a sibling mock for `fetchContestantsMeta`:

```ts
const fetchContestantsMeta = vi.fn().mockResolvedValue({ broadcastStartUtc: null });
```

Pass it into the `getRoom` deps wherever the existing tests call the orchestrator. Update existing strict-equal assertions on the return data — change `.toEqual({ ... })` to `.toMatchObject({ ... })` if any of them strict-match the whole `GetRoomData` (so the new `broadcastStartUtc: null` field doesn't break them). If existing assertions are narrower, no change needed.

Add at least one new test:

```ts
it("includes broadcastStartUtc in the returned data when fetchContestantsMeta returns one", async () => {
  fetchContestantsMeta.mockResolvedValueOnce({
    broadcastStartUtc: "2026-05-16T19:00:00.000Z",
  });
  const result = await getRoom(/* valid input */, /* deps with the mock */);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.broadcastStartUtc).toBe("2026-05-16T19:00:00.000Z");
});
```

Adapt to the existing test fixture style — the orchestrator's other test cases will show the canonical setup.

- [ ] **Step 8: Update the API route to inject the new dep**

Open `src/app/api/rooms/[id]/route.ts`. Add the import:

```ts
import { fetchContestants, fetchContestantsMeta } from "@/lib/contestants";
```

Update the `getRoom` call:

```ts
const result = await getRoom(
  {
    roomId: params.id,
    ...(userIdParam !== null ? { userId: userIdParam } : {}),
  },
  {
    supabase: createServiceClient(),
    fetchContestants,
    fetchContestantsMeta,
  }
);
```

If `src/app/api/rooms/[id]/route.test.ts` asserts on the response payload shape, update those assertions similarly to Step 7 (use `toMatchObject` or add the new field).

- [ ] **Step 9: Wire through `page.tsx`**

Open `src/app/room/[id]/page.tsx`. The `Phase['ready']` shape will need `broadcastStartUtc: string | null`. Find where the API response is set into state (the `load` callback around the room fetch):

```ts
const data = fetchResult.data;
setPhase({
  kind: "ready",
  room: data.room as RoomShape,
  memberships: ...,
  contestants: ...,
  broadcastStartUtc: data.broadcastStartUtc as string | null,
});
```

Add `broadcastStartUtc: string | null;` to whatever local `Phase` type the file declares.

In the `<LobbyView>` JSX render (around line 575 — the existing call site), add the new prop:

```tsx
broadcastStartUtc={phase.broadcastStartUtc}
```

- [ ] **Step 10: Run all tests + type-check + lint**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test 2>&1 | tail -5
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run lint 2>&1 | tail -5
```

Expected: ALL PASS, type-check clean, lint shows only pre-existing warnings (e.g., `useRoomRealtime.ts`).

- [ ] **Step 11: Commit**

```bash
git add src/lib/rooms/get.ts src/lib/rooms/get.test.ts src/app/api/rooms/[id]/route.ts src/app/api/rooms/[id]/route.test.ts src/app/room/[id]/page.tsx src/components/room/LobbyView.tsx src/components/room/LobbyView.test.tsx
git commit -m "$(cat <<'EOF'
feat(lobby): wire broadcastStartUtc through to LobbyCountdown (R2 #238)

getRoom orchestrator gains fetchContestantsMeta dep + GetRoomData
extends with broadcastStartUtc: string | null. /api/rooms/{id} route
injects fetchContestantsMeta. page.tsx threads broadcastStartUtc into
phase.ready and passes to <LobbyView>. <LobbyView> mounts
<LobbyCountdown> in a new section between the room chrome and the
"Who's here" roster.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Stage only the test files for routes/orchestrators that you actually edited.)

---

## Task 6: Final cleanup — TODO tick + verifications + push approval gate

**Files:**
- Modify: `TODO.md` (tick lines 238 + 241 — gitignored, local only)

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test 2>&1 | tail -5
```

Expected: ALL PASS.

- [ ] **Step 2: Type-check + lint**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3 && npm run lint 2>&1 | tail -5
```

Expected: type-check green, lint shows only pre-existing warnings (the `useRoomRealtime.ts` ref-cleanup warning, not from this branch).

- [ ] **Step 3: Tick TODO.md line 238 (lobby countdown)**

Find the line:

```markdown
- [ ] Lobby countdown component — consume `broadcastStartUtc` from contestant JSON; suppress when absent (§6.6.1)
```

Change to:

```markdown
- [x] Lobby countdown component — consume `broadcastStartUtc` from contestant JSON; suppress when absent (§6.6.1)  _(landed on `feat/r2-lobby-countdown` — `<LobbyCountdown>` with pure `formatCountdown` helper renders DD:HH:MM:SS (>24h) → HH:MM:SS (≤24h) → "Ready whenever you are." fallback when null/past. Also bundles the JSON dual-shape extension (TODO #241): `fetchContestants` now accepts both flat-array (legacy) and `{ broadcastStartUtc?, contestants: [...] }` wrapper shapes via the new `parseContestantsJson` helper. Test fixture (year 9999) migrated to wrapper shape; production JSON stays flat (operator backfills per TODO #242). Spec: `docs/superpowers/specs/2026-05-12-r2-lobby-countdown-design.md`. Plan: `docs/superpowers/plans/2026-05-12-r2-lobby-countdown.md`.)_
```

- [ ] **Step 4: Tick TODO.md line 241 (JSON shape extension)**

Find the line:

```markdown
- [ ] Extend `data/contestants/{year}/{event}.json` shape: add optional top-level `broadcastStartUtc` and optional `artistPreviewUrl` per contestant. Update `data/README.md`.
```

This task only delivers the `broadcastStartUtc` half. `artistPreviewUrl` is for the contestant primer carousel (TODO #240) and stays open. Mark this as `[~]`:

```markdown
- [~] Extend `data/contestants/{year}/{event}.json` shape: add optional top-level `broadcastStartUtc` and optional `artistPreviewUrl` per contestant. Update `data/README.md`.  _(broadcastStartUtc half landed on `feat/r2-lobby-countdown` — `parseContestantsJson` helper supports both legacy flat-array and `{ broadcastStartUtc?, contestants: [...] }` wrapper shapes. `artistPreviewUrl` for the primer carousel (TODO #240) is the remaining work — separate slice.)_
```

(TODO.md is gitignored — no commit.)

- [ ] **Step 5: Pause for user push approval**

Push and PR are shared-state mutations. Stop here, summarise commits, and wait for explicit user approval before:

```bash
git push -u origin feat/r2-lobby-countdown
gh pr create --title "feat(lobby): R2 #238 lobby countdown + JSON shape extension (§6.6.1)" --body ...
```

PR body template (use when user approves):

```
## Summary

- New `<LobbyCountdown>` component renders a live ticking countdown to broadcast start: `DD:HH:MM:SS` (>24h) → `HH:MM:SS` (≤24h) → "Ready whenever you are." when null/past.
- Pure `formatCountdown(targetMs, nowMs)` helper handles the digit math; component owns its own `setInterval(1000)`.
- JSON dual-shape support: `fetchContestants` accepts both flat-array (legacy) and `{ broadcastStartUtc?, contestants: [...] }` wrapper shapes via the new `parseContestantsJson` helper. `fetchContestantsMeta` (already shipped) reads the metadata. Aligns the two readers so a JSON file can be safely migrated.
- Test fixture (year 9999) migrated to wrapper shape with a fixture timestamp. Production JSON files stay flat — operator backfills per [TODO.md:242](TODO.md#L242) when ready.
- `getRoom` orchestrator gains `fetchContestantsMeta` dep; `/api/rooms/{id}` response carries `broadcastStartUtc: string | null`; `page.tsx` threads through to `<LobbyView>` to `<LobbyCountdown>`.

UI-heavy slice. No schema, no endpoints, no orchestrator behaviour change beyond a new field on the response payload.

## Test plan

- [ ] **Verify the countdown renders in dev**: `npm run dev`, create a room with the test fixture (year 9999), open the lobby. Countdown should show DD:HH:MM:SS ticking down to 2026-05-16T19:00:00Z.
- [ ] **Verify the fallback renders in production-shape rooms**: create a room with a real year (2025/2026). The lobby countdown should show "Ready whenever you are." until an operator backfills broadcastStartUtc.
- [ ] **Verify cross-locale**: switch to es/uk/fr/de — empty stubs render gracefully (no key errors).
- [ ] CI: `npm test`, `npm run type-check`, `npm run lint`.
```

---

## Parallelization map

Strict order: 1 → 2 → 3 → 4 → 5 → 6.

- Task 1 (locale keys) is a chokepoint — Task 3's RTL test asserts on `lobby.countdown.label` / `lobby.countdown.fallback`.
- Task 2 (formatCountdown) is independent of 1 but Task 3 imports it.
- Task 3 (LobbyCountdown) needs 1 + 2.
- Task 4 (fetchContestants wrapper support) is independent of 1/2/3 in code but must precede Task 5 (which imports the new behaviour).
- Task 5 (wiring) needs everything before it.
- Task 6 is final cleanup.

Tasks 2 + 4 could parallelise in theory (different files, no shared state) but each is small enough that serial is faster than the coordination overhead.

## Self-review checklist (run before declaring complete)

- [ ] `lobby.countdown.label` + `lobby.countdown.fallback` keys exist in en.json + non-en stubs.
- [ ] `formatCountdown` returns `DD:HH:MM:SS` when delta includes 1+ days, `HH:MM:SS` when < 1 day, `null` when delta ≤ 0.
- [ ] `<LobbyCountdown>` mounts a `setInterval(1000)` ONLY when `broadcastStartUtc` is non-null.
- [ ] `parseContestantsJson` accepts both flat array and wrapper object shapes; rejects malformed inputs (returns null).
- [ ] `fetchContestants` and `fetchContestantsMeta` both go through `parseContestantsJson` for the wrapper-shape branch.
- [ ] Test fixture JSON files use wrapper shape with a real `broadcastStartUtc` value.
- [ ] `GetRoomDeps` includes `fetchContestantsMeta`; `GetRoomData` includes `broadcastStartUtc: string | null`.
- [ ] `/api/rooms/{id}` response includes `broadcastStartUtc`.
- [ ] `<LobbyView>` accepts `broadcastStartUtc` prop and renders `<LobbyCountdown>` between room chrome and "Who's here" roster.
- [ ] `npm test` + `npm run type-check` + `npm run lint` all green.
- [ ] TODO.md line 238 ticked from `[ ]` to `[x]`; line 241 ticked to `[~]` (artistPreviewUrl half remains for #240).
