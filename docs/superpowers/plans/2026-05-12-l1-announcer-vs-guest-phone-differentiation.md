# L1 announcer-phone vs guest-phone differentiation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Differentiate the active driver and the guest watcher surfaces inside `<AnnouncingView>` so SPEC §10.2's three-surface matrix is feature-complete (TV column already shipped).

**Architecture:** Pure presentational change. A derived `surface: 'driver' | 'watcher'` boolean in `<AnnouncingView>` gates four behavioural deltas: (1) `JustRevealedFlash` card renders driver-only, (2) toast renders watcher-only (in both styles), (3) a new `<StillToGiveLine>` mounts on full-style active drivers, (4) leaderboard rows take a `density` prop that compacts watcher rendering. The existing `TwelvePointToast` is renamed to `RevealToast` and gains a `points: number` field so the same component serves both short (always `points=12`) and full (any value) styles. No schema, no API, no realtime payload changes.

**Tech Stack:** React 18 / Next.js 14 / TypeScript / next-intl / Tailwind / vitest (jsdom for RTL, node default).

**Spec:** [docs/superpowers/specs/2026-05-12-l1-announcer-vs-guest-phone-differentiation-design.md](../specs/2026-05-12-l1-announcer-vs-guest-phone-differentiation-design.md)

**Branch:** `feat/l1-watcher-driver-split` (already created from `origin/main`; spec commit `4987427` already landed).

---

## File map

**Create:**
- `src/lib/announce/stillToGive.ts` — pure helper + `FULL_REVEAL_POINTS` constant
- `src/lib/announce/stillToGive.test.ts` — table-driven unit tests
- `src/components/room/StillToGiveLine.tsx` — single-line monospace component
- `src/components/room/StillToGiveLine.test.tsx` — RTL tests
- `src/components/room/RevealToast.tsx` — created via `git mv` from `TwelvePointToast.tsx`
- `src/components/room/RevealToast.test.tsx` — created via `git mv` from `TwelvePointToast.test.tsx`

**Delete (via `git mv`, not standalone):**
- `src/components/room/TwelvePointToast.tsx` (→ `RevealToast.tsx`)
- `src/components/room/TwelvePointToast.test.tsx` (→ `RevealToast.test.tsx`)

**Modify:**
- `src/components/room/AnnouncingView.tsx` — derived `surface`, mount `<StillToGiveLine>`, gate flash card, extract `<LeaderboardRow>`, update toast fire condition, update import
- `src/components/room/AnnouncingView.test.tsx` — update mock + Case D/E + add 6 new cases
- `src/locales/en.json` — add `announcing.stillToGive.{label,aria}`; rename `announce.shortReveal.guestToast` → `announce.revealToast` with `{points}` placeholder
- `src/locales/es.json`, `uk.json`, `fr.json`, `de.json` — same shape changes

---

## Task 1 — Pure helper `stillToGive`

**Why first:** smallest, isolated, zero deps. TDD baseline before any component work.

**Files:**
- Create: `src/lib/announce/stillToGive.ts`
- Create: `src/lib/announce/stillToGive.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `src/lib/announce/stillToGive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FULL_REVEAL_POINTS, stillToGive } from "./stillToGive";

describe("FULL_REVEAL_POINTS", () => {
  it("matches the canonical Eurovision sequence", () => {
    expect(FULL_REVEAL_POINTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12]);
  });

  it("has 10 entries (full-style queue length)", () => {
    expect(FULL_REVEAL_POINTS).toHaveLength(10);
  });
});

describe("stillToGive", () => {
  it("returns the full sequence as remaining when idx is 0", () => {
    expect(stillToGive(0)).toEqual({
      given: [],
      remaining: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
    });
  });

  it("splits after one reveal", () => {
    expect(stillToGive(1)).toEqual({
      given: [1],
      remaining: [2, 3, 4, 5, 6, 7, 8, 10, 12],
    });
  });

  it("splits mid-sequence", () => {
    expect(stillToGive(5)).toEqual({
      given: [1, 2, 3, 4, 5],
      remaining: [6, 7, 8, 10, 12],
    });
  });

  it("splits with only the 12 remaining", () => {
    expect(stillToGive(9)).toEqual({
      given: [1, 2, 3, 4, 5, 6, 7, 8, 10],
      remaining: [12],
    });
  });

  it("returns empty remaining when all 10 are given", () => {
    expect(stillToGive(10)).toEqual({
      given: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
      remaining: [],
    });
  });

  it("clamps negative idx to 0", () => {
    expect(stillToGive(-1)).toEqual({
      given: [],
      remaining: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
    });
  });

  it("clamps idx > length to length", () => {
    expect(stillToGive(99)).toEqual({
      given: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
      remaining: [],
    });
  });
});
```

- [ ] **Step 1.2: Run test, verify it fails for the right reason**

```bash
npx vitest run src/lib/announce/stillToGive.test.ts
```

Expected: FAIL with `Cannot find module './stillToGive'`.

- [ ] **Step 1.3: Implement the helper**

Create `src/lib/announce/stillToGive.ts`:

```ts
/**
 * Canonical Eurovision points sequence for the full reveal style.
 * Each announcer awards exactly these 10 values to 10 different contestants,
 * revealed one at a time in this order. Short style auto-batches 1–8 + 10
 * and only the 12-point reveal is live.
 *
 * SPEC §10.2.2.
 */
export const FULL_REVEAL_POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12] as const;

export interface StillToGiveSplit {
  given: readonly number[];
  remaining: readonly number[];
}

/**
 * Split the canonical full-style points sequence into already-given vs
 * still-to-give based on `currentAnnounceIdx`. Out-of-range inputs clamp
 * to [0, FULL_REVEAL_POINTS.length] — defensive, since the announcement
 * pointer is server-authoritative but the helper consumes it as a plain
 * number prop.
 */
export function stillToGive(currentAnnounceIdx: number): StillToGiveSplit {
  const clamped = Math.max(
    0,
    Math.min(currentAnnounceIdx, FULL_REVEAL_POINTS.length),
  );
  return {
    given: FULL_REVEAL_POINTS.slice(0, clamped),
    remaining: FULL_REVEAL_POINTS.slice(clamped),
  };
}
```

- [ ] **Step 1.4: Run tests, verify all pass**

```bash
npx vitest run src/lib/announce/stillToGive.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/announce/stillToGive.ts src/lib/announce/stillToGive.test.ts
git commit -m "$(cat <<'EOF'
feat(announce): stillToGive pure helper for full-style remaining-points UI

Canonical FULL_REVEAL_POINTS sequence [1,2,3,4,5,6,7,8,10,12] plus a
clamping splitter that returns given/remaining halves keyed on the
server's currentAnnounceIdx. Used by the upcoming <StillToGiveLine>
component on the active-driver phone surface (SPEC §10.2 announcer
column "Still to give: 7, 8, 10, 12").

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Locale key changes (5 locales, atomic)

**Why second:** `RevealToast` (Task 3) and `<StillToGiveLine>` (Task 4) both consume locale keys. Landing the keys first means subsequent component renders read translated copy, and `locales.test.ts` (which requires every `en` key to exist in every other locale) stays green throughout. All 5 locale edits land in one commit.

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`
- Modify: `src/locales/uk.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/de.json`

- [ ] **Step 2.1: Edit `src/locales/en.json` — add `stillToGive`, rename `guestToast` → `revealToast` with `{points}`**

Two edits in this file:

**Edit A** (rename + reshape — locate the `announce.shortReveal` block at line 361):

Find:
```json
    "shortReveal": {
      "cta": "Reveal 12 points",
      "ctaMicrocopy": "Tap when you say it",
      "revealed": "Revealed ✓",
      "awaitingTwelve": "Awaiting their 12 points…",
      "guestToast": "{name} gave 12 to {country} {flag}"
    }
```

Replace with:
```json
    "shortReveal": {
      "cta": "Reveal 12 points",
      "ctaMicrocopy": "Tap when you say it",
      "revealed": "Revealed ✓",
      "awaitingTwelve": "Awaiting their 12 points…"
    },
    "revealToast": "{name} gave {points} to {flag} {country}"
```

Note the rename **also reorders the placeholders** to `{flag} {country}` (the flag emoji renders adjacent to the country name — better for RTL languages and matches the existing splash component shape).

**Edit B** (add `stillToGive` — locate the `announcing.*` block, search for `"upNext"` to find the right namespace and append):

Inside the `announcing` block, add a `stillToGive` sub-object alongside existing entries. Use the Read tool to find the right insertion point if needed. Add:

```json
    "stillToGive": {
      "label": "Still to give:",
      "aria": "Remaining points to award: {remaining}"
    }
```

- [ ] **Step 2.2: Edit `src/locales/es.json` — same shape**

Find the `announce.shortReveal.guestToast` line (line 366):
```json
      "guestToast": "{name} dio 12 puntos a {country} {flag}"
```

Remove that line (don't leave the trailing comma broken — the line above will need its trailing comma removed too if `guestToast` was the last entry). Then add a sibling `revealToast` outside the `shortReveal` block:

```json
    "revealToast": "{name} dio {points} puntos a {flag} {country}"
```

Inside the `announcing` block, add:

```json
    "stillToGive": {
      "label": "Quedan por dar:",
      "aria": "Puntos que aún hay que dar: {remaining}"
    }
```

- [ ] **Step 2.3: Edit `src/locales/uk.json` — same shape**

Remove the `guestToast` line. Add `revealToast` sibling:

```json
    "revealToast": "{name} віддав(ла) {points} балів {flag} {country}"
```

Inside `announcing`:

```json
    "stillToGive": {
      "label": "Ще треба дати:",
      "aria": "Бали, які ще треба роздати: {remaining}"
    }
```

- [ ] **Step 2.4: Edit `src/locales/fr.json` — same shape**

Remove the `guestToast` line. Add `revealToast` sibling:

```json
    "revealToast": "{name} a donné {points} à {flag} {country}"
```

Inside `announcing`:

```json
    "stillToGive": {
      "label": "Reste à donner :",
      "aria": "Points restant à attribuer : {remaining}"
    }
```

- [ ] **Step 2.5: Edit `src/locales/de.json` — same shape**

Remove the `guestToast` line. Add `revealToast` sibling:

```json
    "revealToast": "{name} gab {points} Punkte an {flag} {country}"
```

Inside `announcing`:

```json
    "stillToGive": {
      "label": "Noch zu vergeben:",
      "aria": "Verbleibende Punkte: {remaining}"
    }
```

- [ ] **Step 2.6: Run `locales.test.ts` to verify key parity**

```bash
npx vitest run src/locales/locales.test.ts
```

Expected: 4 tests PASS (es/uk/fr/de each contain every en key).

If a missing key is reported, fix the offending locale file and re-run.

- [ ] **Step 2.7: Don't commit yet — wait for Task 3**

The `revealToast` rename leaves the existing `TwelvePointToast` component pointing at a key that no longer exists. Running the full test suite right now would break `TwelvePointToast.test.tsx`. Task 3 renames the component + updates the key reference in the same commit so the diff stays atomic.

---

## Task 3 — Rename `TwelvePointToast` → `RevealToast`, extend `ToastEvent` with `points`

**Why third:** Locale keys from Task 2 are already in place, so the renamed component immediately reads the new key. Single coherent commit: rename + extension + key update.

**Files:**
- Rename: `src/components/room/TwelvePointToast.tsx` → `src/components/room/RevealToast.tsx`
- Rename: `src/components/room/TwelvePointToast.test.tsx` → `src/components/room/RevealToast.test.tsx`
- Modify: `src/components/room/AnnouncingView.tsx` — update import + ToastEvent push to include `points`

- [ ] **Step 3.1: Rename the files via `git mv`**

```bash
git mv src/components/room/TwelvePointToast.tsx src/components/room/RevealToast.tsx
git mv src/components/room/TwelvePointToast.test.tsx src/components/room/RevealToast.test.tsx
```

This preserves git history through the rename.

- [ ] **Step 3.2: Update `RevealToast.tsx` — rename export + add `points` + new key**

Replace the entire file with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export interface ToastEvent {
  id: string;
  announcingUserDisplayName: string;
  country: string;
  flagEmoji: string;
  /** Points awarded in this reveal. 12 for short style; 1–8/10/12 for full style. */
  points: number;
  at: number;
}

interface RevealToastProps {
  events: ToastEvent[];
  /** Default 3000ms per SPEC §10.2 surface table (guest-phone toast). */
  dismissAfterMs?: number;
}

/**
 * SPEC §10.2 (full + short styles) — transient toast for guest phones
 * (anyone who isn't the active announcer/delegate) on every announce_next
 * broadcast. Shows the latest event; auto-dismisses after 3s.
 */
export default function RevealToast({
  events,
  dismissAfterMs = 3000,
}: RevealToastProps) {
  const t = useTranslations();
  const [visible, setVisible] = useState<ToastEvent | null>(null);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    setVisible(latest);
    const timer = setTimeout(() => {
      setVisible((prev) => (prev?.id === latest.id ? null : prev));
    }, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [events, dismissAfterMs]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="reveal-toast"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm rounded-full bg-primary/95 px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg motion-safe:animate-fade-in"
    >
      {t("announce.revealToast", {
        name: visible.announcingUserDisplayName,
        points: visible.points,
        country: visible.country,
        flag: visible.flagEmoji,
      })}
    </div>
  );
}
```

Key changes from the old `TwelvePointToast`:
- Renamed export `TwelvePointToast` → `RevealToast`.
- Renamed props interface `TwelvePointToastProps` → `RevealToastProps`.
- Added `points: number` to `ToastEvent`.
- `data-testid` changed `twelve-point-toast` → `reveal-toast`.
- ICU placeholder `points` added; flag/country order swapped to match new key shape (Task 2 edit A).
- Translation key path `announce.shortReveal.guestToast` → `announce.revealToast`.

- [ ] **Step 3.3: Update `RevealToast.test.tsx`**

Replace the entire file with:

```tsx
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import RevealToast, { type ToastEvent } from "./RevealToast";

const messages = {
  announce: {
    revealToast: "{name} gave {points} to {flag} {country}",
  },
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("RevealToast", () => {
  it("renders 12-point short-style event (regression for short reveal flow)", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 12,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    expect(
      screen.getByText(/Alice gave 12 to 🇸🇪 Sweden/),
    ).toBeInTheDocument();
  });

  it("renders 5-point full-style event with the same component", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Bob",
        country: "Austria",
        flagEmoji: "🇦🇹",
        points: 5,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    expect(
      screen.getByText(/Bob gave 5 to 🇦🇹 Austria/),
    ).toBeInTheDocument();
  });

  it("renders the most recent event when multiple are queued", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 1,
        at: 1,
      },
      {
        id: "2",
        announcingUserDisplayName: "Bob",
        country: "Austria",
        flagEmoji: "🇦🇹",
        points: 12,
        at: 2,
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    expect(screen.getByText(/Bob gave 12 to 🇦🇹 Austria/)).toBeInTheDocument();
    expect(screen.queryByText(/Alice gave 1/)).not.toBeInTheDocument();
  });

  it("auto-dismisses after dismissAfterMs", () => {
    vi.useFakeTimers();
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 12,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} dismissAfterMs={3000} />);
    expect(screen.queryByText(/Alice gave 12/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText(/Alice gave 12/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders nothing when events is empty", () => {
    renderWithIntl(<RevealToast events={[]} />);
    expect(screen.queryByText(/gave/)).not.toBeInTheDocument();
  });

  it("exposes a role=status / aria-live=polite container for screen readers", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        points: 12,
        at: Date.now(),
      },
    ];
    renderWithIntl(<RevealToast events={events} />);
    const toast = screen.getByTestId("reveal-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });
});
```

- [ ] **Step 3.4: Update `AnnouncingView.tsx` import + toast event push**

Two edits in `src/components/room/AnnouncingView.tsx`:

**Edit A** — Update the import (lines 14-16):

Find:
```ts
import TwelvePointToast, {
  type ToastEvent,
} from "@/components/room/TwelvePointToast";
```

Replace with:
```ts
import RevealToast, {
  type ToastEvent,
} from "@/components/room/RevealToast";
```

**Edit B** — Update the JSX render (around line 484):

Find:
```tsx
      <TwelvePointToast events={toastEvents} />
```

Replace with:
```tsx
      <RevealToast events={toastEvents} />
```

**Edit C** — Add `points` to the existing `setToastEvents` push (around lines 237-247). The fire-condition change comes in Task 5; in this task we just add the `points` field so the type stays consistent:

Find:
```tsx
          setToastEvents((prev) => [
            ...prev,
            {
              id: `toast-${event.announcingUserId}-${Date.now()}`,
              announcingUserDisplayName: announcerName,
              country: contestant.country,
              flagEmoji: contestant.flagEmoji,
              at: Date.now(),
            },
          ]);
```

Replace with:
```tsx
          setToastEvents((prev) => [
            ...prev,
            {
              id: `toast-${event.announcingUserId}-${Date.now()}`,
              announcingUserDisplayName: announcerName,
              country: contestant.country,
              flagEmoji: contestant.flagEmoji,
              points: event.points,
              at: Date.now(),
            },
          ]);
```

**Edit D** — Update the comment block on `announcementStyle` (around lines 69-72) — strictly cosmetic but keeps inline docs accurate:

Find:
```ts
  /**
   * SPEC §10.2.2 — when 'short', the active driver sees a compressed
   * 'Reveal 12 points' CTA and non-drivers see a TwelvePointToast on
   * each announce_next broadcast. Render branches in subsequent commits.
   */
  announcementStyle?: 'full' | 'short';
```

Replace with:
```ts
  /**
   * SPEC §10.2.2 — when 'short', the active driver sees a compressed
   * 'Reveal 12 points' CTA. Non-drivers see a RevealToast on each
   * announce_next broadcast regardless of style (full or short).
   */
  announcementStyle?: 'full' | 'short';
```

- [ ] **Step 3.5: Update `AnnouncingView.test.tsx` mock + Case D**

Two edits.

**Edit A** — Update the toast mock (lines 132-155):

Find:
```tsx
// TwelvePointToast — render a minimal stub that preserves the
// data-testid attribute and shows the formatted text.
vi.mock("@/components/room/TwelvePointToast", () => ({
  default: ({
    events,
  }: {
    events: Array<{
      id: string;
      announcingUserDisplayName: string;
      country: string;
      flagEmoji: string;
      at: number;
    }>;
  }) => {
    if (!events || events.length === 0) return null;
    const latest = events[events.length - 1];
    return (
      <div data-testid="twelve-point-toast">
        {latest.announcingUserDisplayName} gave 12 to {latest.country}{" "}
        {latest.flagEmoji}
      </div>
    );
  },
}));
```

Replace with:
```tsx
// RevealToast — render a minimal stub that preserves the data-testid
// attribute and shows the formatted text including the points value.
vi.mock("@/components/room/RevealToast", () => ({
  default: ({
    events,
  }: {
    events: Array<{
      id: string;
      announcingUserDisplayName: string;
      country: string;
      flagEmoji: string;
      points: number;
      at: number;
    }>;
  }) => {
    if (!events || events.length === 0) return null;
    const latest = events[events.length - 1];
    return (
      <div data-testid="reveal-toast">
        {latest.announcingUserDisplayName} gave {latest.points} to{" "}
        {latest.country} {latest.flagEmoji}
      </div>
    );
  },
}));
```

**Edit B** — Update the inline translations mock (line 96-98):

Find:
```ts
      "announce.shortReveal.guestToast": params
        ? `${params.name} gave 12 to ${params.country} ${params.flag}`
        : key,
```

Replace with:
```ts
      "announce.revealToast": params
        ? `${params.name} gave ${params.points} to ${params.flag} ${params.country}`
        : key,
```

**Edit C** — Update Case D's testid assertion (line 1277-1280):

Find:
```tsx
    await waitFor(() =>
      expect(screen.getByTestId("twelve-point-toast")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("twelve-point-toast")).toHaveTextContent("Bob");
    expect(screen.getByTestId("twelve-point-toast")).toHaveTextContent("Austria");
```

Replace with:
```tsx
    await waitFor(() =>
      expect(screen.getByTestId("reveal-toast")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent("Bob");
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent("Austria");
```

(Case E will be rewritten in Task 6 — leave it untouched for now. It will currently FAIL after Task 5 wires the new fire condition. That's expected, and Task 6 fixes it.)

- [ ] **Step 3.6: Run the renamed-toast tests + locales test**

```bash
npx vitest run src/components/room/RevealToast.test.tsx src/locales/locales.test.ts
```

Expected: PASS (6 RevealToast tests + 4 locales tests).

- [ ] **Step 3.7: Run AnnouncingView tests (Case A–D should pass; Case E expected to fail)**

```bash
npx vitest run src/components/room/AnnouncingView.test.tsx
```

Expected: most tests PASS. Case E (`Case E — guest + style='full' + announce_next does NOT render TwelvePointToast`) may still pass because Task 5 hasn't wired the new fire condition yet. If it does pass, that's because the fire condition is still gated on `announcementStyle === "short"`. The Case E assertion will be inverted + rewritten in Task 6.

Type-check:
```bash
npm run type-check
```

Expected: PASS — `ToastEvent.points` is now a required field and every push site has been updated.

- [ ] **Step 3.8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(announce): rename TwelvePointToast → RevealToast + add points field

The same toast component now serves both short style (points=12) and
full style (points 1–8/10/12). Locale key 'announce.shortReveal.guest
Toast' renamed to 'announce.revealToast' with a {points} placeholder
and flag/country reordered to {flag} {country} for adjacency. ICU keys
updated across all 5 locale bundles. AnnouncingView import + toast push
updated to carry event.points; existing test mock + Case D assertions
renamed. Case E will be rewritten in the watcher/driver wiring commit.

No behavioural change yet — fire condition still gates on style==='short'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `<StillToGiveLine>` component + RTL tests

**Why fourth:** independent of `<AnnouncingView>` integration; component contract finalised before the mount-site wiring in Task 5.

**Files:**
- Create: `src/components/room/StillToGiveLine.tsx`
- Create: `src/components/room/StillToGiveLine.test.tsx`

- [ ] **Step 4.1: Write the failing test**

Create `src/components/room/StillToGiveLine.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import StillToGiveLine from "./StillToGiveLine";

const messages = {
  announcing: {
    stillToGive: {
      label: "Still to give:",
      aria: "Remaining points to award: {remaining}",
    },
  },
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("StillToGiveLine", () => {
  it("renders the label", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={0} />);
    expect(screen.getByText("Still to give:")).toBeInTheDocument();
  });

  it("renders all 10 points at idx=0, none struck through", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={0} />);
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
      const span = screen.getByTestId(`stg-remaining-${p}`);
      expect(span).toBeInTheDocument();
      expect(span).toHaveTextContent(String(p));
    }
    expect(screen.queryByTestId("stg-given-1")).not.toBeInTheDocument();
  });

  it("strikes through given values and bolds remaining at idx=3", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={3} />);
    for (const p of [1, 2, 3]) {
      const span = screen.getByTestId(`stg-given-${p}`);
      expect(span).toBeInTheDocument();
      expect(span.className).toContain("line-through");
    }
    for (const p of [4, 5, 6, 7, 8, 10, 12]) {
      const span = screen.getByTestId(`stg-remaining-${p}`);
      expect(span).toBeInTheDocument();
      expect(span.className).toContain("font-semibold");
    }
  });

  it("exposes a comma-joined remaining list in aria-label", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={5} />);
    const line = screen.getByLabelText(
      /Remaining points to award: 6, 7, 8, 10, 12/,
    );
    expect(line).toBeInTheDocument();
  });

  it("renders all-given when idx=10 (no remaining spans)", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={10} />);
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
      expect(screen.getByTestId(`stg-given-${p}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("stg-remaining-12")).not.toBeInTheDocument();
  });

  it("clamps negative idx — renders everything as remaining", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={-1} />);
    expect(screen.getByTestId("stg-remaining-1")).toBeInTheDocument();
    expect(screen.queryByTestId("stg-given-1")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Run test, verify it fails for the right reason**

```bash
npx vitest run src/components/room/StillToGiveLine.test.tsx
```

Expected: FAIL with `Cannot find module './StillToGiveLine'`.

- [ ] **Step 4.3: Implement the component**

Create `src/components/room/StillToGiveLine.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { stillToGive } from "@/lib/announce/stillToGive";

export interface StillToGiveLineProps {
  /** Server's current pointer into the per-announcer points queue (0–10). */
  currentAnnounceIdx: number;
}

/**
 * SPEC §10.2 — full-style active-driver "Still to give: 7, 8, 10, 12" line.
 * Renders the canonical 10-point sequence with already-given values
 * struck through and remaining values bolded. Mounted by AnnouncingView
 * only when isActiveDriver && announcementStyle === 'full'.
 */
export default function StillToGiveLine({
  currentAnnounceIdx,
}: StillToGiveLineProps) {
  const t = useTranslations("announcing.stillToGive");
  const { given, remaining } = stillToGive(currentAnnounceIdx);
  return (
    <p
      className="font-mono text-xs tabular-nums text-muted-foreground text-center"
      aria-label={t("aria", { remaining: remaining.join(", ") })}
      data-testid="still-to-give-line"
    >
      <span className="mr-2 text-[10px] uppercase tracking-wider">
        {t("label")}
      </span>
      {given.map((p) => (
        <span
          key={`g-${p}`}
          data-testid={`stg-given-${p}`}
          className="mx-0.5 line-through text-muted-foreground/40"
        >
          {p}
        </span>
      ))}
      {remaining.map((p) => (
        <span
          key={`r-${p}`}
          data-testid={`stg-remaining-${p}`}
          className="mx-0.5 font-semibold text-foreground"
        >
          {p}
        </span>
      ))}
    </p>
  );
}
```

- [ ] **Step 4.4: Run test, verify all pass**

```bash
npx vitest run src/components/room/StillToGiveLine.test.tsx
```

Expected: PASS (6 tests).

- [ ] **Step 4.5: Commit**

```bash
git add src/components/room/StillToGiveLine.tsx src/components/room/StillToGiveLine.test.tsx
git commit -m "$(cat <<'EOF'
feat(announce): StillToGiveLine — full-style remaining-points indicator

Single-line monospace strip showing all 10 full-style point values with
given values rendered line-through + muted, remaining values bolded.
Drives off the pure stillToGive() helper; mounted only on active-driver
phone surface in full style (SPEC §10.2 announcer column "Top"). aria-
label exposes the comma-joined remaining list for screen readers.

6 RTL cases cover render at idx=0/3/5/10, aria-label shape, and the
clamp path for out-of-range indices.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Wire `<AnnouncingView>` — derived surface, mount, gate flash, extract LeaderboardRow

**Why fifth:** all building blocks (helper + component + renamed toast) are in place. This task is the integration that flips the actual behaviour.

**Files:**
- Modify: `src/components/room/AnnouncingView.tsx`

- [ ] **Step 5.1: Add the `<StillToGiveLine>` + `stillToGive` imports**

Find (top of file, after the existing imports — locate `import TwelvePointSplash` for context, line 13-17 in the original; after Task 3's rename the line numbers shift):

```ts
import RevealToast, {
  type ToastEvent,
} from "@/components/room/RevealToast";
```

Insert immediately after:
```ts
import StillToGiveLine from "@/components/room/StillToGiveLine";
```

Note: the `stillToGive` helper isn't imported here — the component reads it internally. Only `StillToGiveLine` is needed in this file.

- [ ] **Step 5.2: Add derived `surface` variable**

Find (around line 172 in the original):
```ts
  const isActiveDriver =
    !!announcement && (isDelegate || (isAnnouncer && !adminHasTakenControl));
```

Insert immediately after:
```ts
  /** SPEC §10.2 — driver sees the big flash card + full-density rows;
   *  watcher sees a top-of-screen toast + compact rows. Derived from
   *  isActiveDriver so the 5-mode pickMode() result stays the header-copy
   *  source of truth (active-announcer / active-delegate / passive-announcer /
   *  owner-watching / guest-watching) while this flag toggles the three
   *  presentational deltas (flash, toast, density). */
  const surface: 'driver' | 'watcher' = isActiveDriver ? 'driver' : 'watcher';
```

- [ ] **Step 5.3: Update the toast fire condition (drop `style === 'short'` gate; pass `points`)**

Find (around lines 228-248 — the `if (event.type === "announce_next")` block):

```tsx
      if (
        announcementStyle === "short" &&
        currentUserId !== event.announcingUserId
      ) {
        const contestant = contestantById.current.get(event.contestantId);
        const announcerName =
          announcement?.announcingDisplayName ??
          t("announcing.fallbackAnnouncerName");
        if (contestant) {
          setToastEvents((prev) => [
            ...prev,
            {
              id: `toast-${event.announcingUserId}-${Date.now()}`,
              announcingUserDisplayName: announcerName,
              country: contestant.country,
              flagEmoji: contestant.flagEmoji,
              points: event.points,
              at: Date.now(),
            },
          ]);
        }
      }
```

Replace with:

```tsx
      // SPEC §10.2 — watchers (not the announcer) get a top-of-screen toast
      // on every announce_next in BOTH styles. The active driver doesn't
      // toast themselves; they see the big JustRevealedFlash card instead.
      if (currentUserId !== event.announcingUserId) {
        const contestant = contestantById.current.get(event.contestantId);
        const announcerName =
          announcement?.announcingDisplayName ??
          t("announcing.fallbackAnnouncerName");
        if (contestant) {
          setToastEvents((prev) => [
            ...prev,
            {
              id: `toast-${event.announcingUserId}-${Date.now()}`,
              announcingUserDisplayName: announcerName,
              country: contestant.country,
              flagEmoji: contestant.flagEmoji,
              points: event.points,
              at: Date.now(),
            },
          ]);
        }
      }
```

- [ ] **Step 5.4: Gate `JustRevealedFlash` block on `isActiveDriver`**

Find (around line 519):

```tsx
        {justRevealed ? (
          <div className="rounded-2xl border-2 border-primary bg-primary/10 px-6 py-5 text-center motion-safe:animate-fade-in">
```

Replace the opening expression:

```tsx
        {isActiveDriver && justRevealed ? (
          <div className="rounded-2xl border-2 border-primary bg-primary/10 px-6 py-5 text-center motion-safe:animate-fade-in">
```

(The closing `) : null}` block stays unchanged.)

- [ ] **Step 5.5: Mount `<StillToGiveLine>` between header and reveal card**

Find (around lines 514-517, the closing of the `<header>` block):

```tsx
            </div>
          ) : null}
        </header>

        {justRevealed ? (
```

After Task 5.4 the block immediately after `</header>` reads `{isActiveDriver && justRevealed ? (...`. Insert the `<StillToGiveLine>` mount **between** the header close and that conditional:

```tsx
            </div>
          ) : null}
        </header>

        {isActiveDriver &&
        announcementStyle === "full" &&
        announcement?.queueLength === 10 ? (
          <StillToGiveLine
            currentAnnounceIdx={announcement.currentAnnounceIdx}
          />
        ) : null}

        {isActiveDriver && justRevealed ? (
```

- [ ] **Step 5.6: Extract `LeaderboardRow` inline + thread `density={surface}`**

Find (lines ~710-735, the leaderboard `<ol>` map block):

```tsx
            <ol className="space-y-1.5">
              {leaderboard.map((entry) => {
                const c = contestantById.current.get(entry.contestantId);
                const country = c?.country ?? entry.contestantId;
                const flag = c?.flagEmoji ?? "🏳️";
                return (
                  <li
                    key={entry.contestantId}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-background text-xs font-semibold text-muted-foreground">
                        {entry.rank}
                      </span>
                      <span className="text-xl" aria-hidden>
                        {flag}
                      </span>
                      <span className="text-sm font-medium">{country}</span>
                    </div>
                    <span className="font-mono text-sm font-bold tabular-nums">
                      {entry.totalPoints}
                    </span>
                  </li>
                );
              })}
            </ol>
```

Replace with:

```tsx
            <ol className="space-y-1.5">
              {leaderboard.map((entry) => (
                <LeaderboardRow
                  key={entry.contestantId}
                  entry={entry}
                  contestant={contestantById.current.get(entry.contestantId)}
                  density={surface}
                />
              ))}
            </ol>
```

Then add the `<LeaderboardRow>` component definition at the bottom of the file (after `pickMode()` and before `ShortStyleRevealCard`). Place it just before the `function HeaderCard` declaration so the helpers cluster sensibly:

```tsx
function LeaderboardRow({
  entry,
  contestant,
  density,
}: {
  entry: LeaderboardEntry;
  contestant: Contestant | undefined;
  density: "driver" | "watcher";
}) {
  const country = contestant?.country ?? entry.contestantId;
  const flag = contestant?.flagEmoji ?? "🏳️";
  const rowCls =
    density === "watcher"
      ? "flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1"
      : "flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2";
  const rankCls =
    density === "watcher"
      ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-background text-[10px] font-semibold text-muted-foreground"
      : "inline-flex items-center justify-center w-6 h-6 rounded-full bg-background text-xs font-semibold text-muted-foreground";
  const countryCls =
    density === "watcher" ? "text-xs font-medium" : "text-sm font-medium";
  const pointsCls =
    density === "watcher"
      ? "font-mono text-xs font-bold tabular-nums"
      : "font-mono text-sm font-bold tabular-nums";
  const flagCls = density === "watcher" ? "text-base" : "text-xl";

  return (
    <li className={rowCls} data-testid={`leaderboard-row-${density}`}>
      <div className="flex items-center gap-2">
        <span className={rankCls}>{entry.rank}</span>
        <span className={flagCls} aria-hidden>
          {flag}
        </span>
        <span className={countryCls}>{country}</span>
      </div>
      <span className={pointsCls}>{entry.totalPoints}</span>
    </li>
  );
}
```

- [ ] **Step 5.7: Run type-check**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 5.8: Run the AnnouncingView tests (Cases A–D still pass; E expected to fail)**

```bash
npx vitest run src/components/room/AnnouncingView.test.tsx
```

Expected: Cases A, B, C, D PASS. Case E FAIL — it currently asserts the toast does NOT render in full style, which is now inverted. Task 6 rewrites Case E plus adds new cases.

- [ ] **Step 5.9: Commit**

```bash
git add src/components/room/AnnouncingView.tsx
git commit -m "$(cat <<'EOF'
feat(announce): driver vs watcher surface split in AnnouncingView

Three coordinated changes inside <AnnouncingView>:

1. JustRevealedFlash card gated on isActiveDriver — watchers no longer
   see the big inline 4.5s flash card. The same flash state still fires
   on every announce_next; only the render path is driver-only.
2. RevealToast fire condition drops the style==='short' gate — full
   style now fires the toast for every watcher on every advance,
   matching SPEC §10.2 surface table for "Other guests' phones".
3. <StillToGiveLine> mounts between header and reveal card on the
   active-driver phone surface, gated on announcementStyle === 'full'
   && queueLength === 10 (defensive — short style has queueLength = 1).
4. Leaderboard row extracted into a local <LeaderboardRow> component
   with a density prop; watcher surface gets py-1 + smaller rank chip
   + text-xs country, driver keeps the existing py-2 + text-sm shape.

Pure presentational. No schema, no API, no realtime payload changes.

AnnouncingView.test.tsx Case E is now expected to fail; rewritten in
the test-update commit alongside the 6 new watcher/driver split cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — AnnouncingView RTL: rewrite Case E + add 6 new cases

**Why sixth:** the implementation is in place; this task rewrites the inverted Case E and adds explicit assertions for the new behaviour split.

**Files:**
- Modify: `src/components/room/AnnouncingView.test.tsx`

- [ ] **Step 6.1: Rewrite Case E to assert toast NOW renders in full style**

Find (lines 1283-1310):

```tsx
  // Case E: guest watching + style='full' (control) — no toast on announce_next
  it("Case E — guest + style='full' + announce_next does NOT render TwelvePointToast", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    // Wait for mount and handler capture
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    // Fire announce_next from the announcer
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 12,
      announcingUserId: ANNOUNCER_ID,
    });
    // Toast should NOT appear under full style
    await waitFor(() =>
      // Wait for refetch to settle (Austria in leaderboard)
      expect(screen.getByText("Austria")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("twelve-point-toast")).not.toBeInTheDocument();
  });
```

Replace with:

```tsx
  // Case E: guest watching + style='full' — toast NOW renders on every
  // announce_next (SPEC §10.2 surface table for "Other guests' phones").
  // Pre-L1-split this assertion was inverted; flipped 2026-05-12.
  it("Case E — guest + style='full' + announce_next renders RevealToast with points", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 5,
      announcingUserId: ANNOUNCER_ID,
    });
    await waitFor(() =>
      expect(screen.getByTestId("reveal-toast")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent(
      "gave 5 to",
    );
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent("Austria");
  });
```

- [ ] **Step 6.2: Add Case F — active announcer does NOT receive a self-toast**

Add immediately after Case E:

```tsx
  // Case F: active announcer receives their own announce_next echo —
  // the big flash card renders for them but no toast fires for self.
  it("Case F — active announcer + announce_next for self renders flash card, NOT toast", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 5,
      announcingUserId: ANNOUNCER_ID,
    });
    await waitFor(() =>
      expect(screen.getByText("Austria")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("reveal-toast")).not.toBeInTheDocument();
    // The "Just revealed" flash card text comes from
    // announcing.justRevealed.label translation key — assert the points
    // value is on screen as the simplest driver-card detection.
    expect(screen.getByText("5 points")).toBeInTheDocument();
  });
```

Note: the assertion `screen.getByText("5 points")` relies on the existing inline-translations mock mapping `announcing.justRevealed.pointsLabel` to `"{points} points"`. Verify this key is already mocked in the test file by searching for `justRevealed.pointsLabel`. If absent, add a translation mock entry inline before running the test:
```ts
"announcing.justRevealed.pointsLabel": params
  ? `${params.points} points`
  : key,
```

- [ ] **Step 6.3: Add Case G — JustRevealedFlash suppressed for watchers**

Add immediately after Case F:

```tsx
  // Case G: guest watcher receiving announce_next sees the toast, NOT
  // the big "Just revealed" flash card. Inverse of Case F.
  it("Case G — guest watcher + announce_next renders toast, NOT flash card", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 5,
      announcingUserId: ANNOUNCER_ID,
    });
    await waitFor(() =>
      expect(screen.getByTestId("reveal-toast")).toBeInTheDocument(),
    );
    // Guests don't see the big driver-side flash card — the "Just revealed"
    // label is suppressed entirely on watcher surface.
    expect(screen.queryByText("5 points")).not.toBeInTheDocument();
  });
```

- [ ] **Step 6.4: Add Case H — `<StillToGiveLine>` renders for full-style active driver**

Add immediately after Case G:

```tsx
  // Case H: full-style active driver sees the StillToGiveLine.
  it("Case H — active driver + style='full' renders StillToGiveLine", async () => {
    const stateAtIdx3: typeof ANNOUNCEMENT_STATE = {
      ...ANNOUNCEMENT_STATE,
      currentAnnounceIdx: 3,
      queueLength: 10,
    };
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={stateAtIdx3}
        announcementStyle="full"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("still-to-give-line")).toBeInTheDocument(),
    );
    // Given values are line-through, remaining are bold — the data-testids
    // distinguish them.
    expect(screen.getByTestId("stg-given-1")).toBeInTheDocument();
    expect(screen.getByTestId("stg-given-3")).toBeInTheDocument();
    expect(screen.getByTestId("stg-remaining-4")).toBeInTheDocument();
    expect(screen.getByTestId("stg-remaining-12")).toBeInTheDocument();
  });
```

- [ ] **Step 6.5: Add Case I — `<StillToGiveLine>` suppressed in short style**

Add immediately after Case H:

```tsx
  // Case I: short-style active driver does NOT see StillToGiveLine
  // (degenerate — short style is always 1 reveal per announcer).
  it("Case I — active driver + style='short' suppresses StillToGiveLine", async () => {
    const shortState: typeof ANNOUNCEMENT_STATE = {
      ...ANNOUNCEMENT_STATE,
      queueLength: 1,
    };
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={shortState}
        announcementStyle="short"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    expect(
      screen.queryByTestId("still-to-give-line"),
    ).not.toBeInTheDocument();
  });
```

- [ ] **Step 6.6: Add Case J — compact leaderboard density on watcher surface**

Add immediately after Case I:

```tsx
  // Case J: leaderboard rows render with density='watcher' for guests
  // and density='driver' for the active announcer.
  it("Case J — watcher renders compact leaderboard rows, driver renders full-density rows", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";

    // Watcher mount
    const { unmount } = render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    // Leaderboard rows are populated by the on-mount refetch; wait for
    // any row to appear, then assert the density attr.
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^leaderboard-row-watcher$/),
      ).not.toHaveLength(0),
    );
    expect(
      screen.queryAllByTestId(/^leaderboard-row-driver$/),
    ).toHaveLength(0);
    unmount();
    cleanup();

    // Driver mount
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^leaderboard-row-driver$/),
      ).not.toHaveLength(0),
    );
    expect(
      screen.queryAllByTestId(/^leaderboard-row-watcher$/),
    ).toHaveLength(0);
  });
```

Note: `cleanup()` is imported from `@testing-library/react` and already used in the file's `afterEach`. The Case J inline `cleanup()` call is belt-and-braces — the `unmount()` should be sufficient.

- [ ] **Step 6.7: Run the full AnnouncingView test suite**

```bash
npx vitest run src/components/room/AnnouncingView.test.tsx
```

Expected: ALL tests PASS (existing cases A–D + rewritten E + new F/G/H/I/J).

If Case F fails because `"announcing.justRevealed.pointsLabel"` isn't mocked, add it to the inline translations mock per the note in Step 6.2 and re-run.

- [ ] **Step 6.8: Commit**

```bash
git add src/components/room/AnnouncingView.test.tsx
git commit -m "$(cat <<'EOF'
test(announce): RTL cases for driver vs watcher surface split

Six new cases pinning the SPEC §10.2 three-surface matrix:

- E (rewritten): full-style guest watcher renders RevealToast with the
  current points value (was: asserts toast suppressed; now inverted).
- F: active announcer sees JustRevealedFlash card on self-echo, no toast
  fires for self.
- G: guest watcher sees the toast, never the big flash card.
- H: full-style active driver renders StillToGiveLine with given/
  remaining split keyed on currentAnnounceIdx.
- I: short-style active driver suppresses StillToGiveLine (degenerate).
- J: leaderboard rows tagged density='watcher' for guests and
  'driver' for the active announcer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Verification

**Why last:** confirm nothing else regressed before opening a PR.

- [ ] **Step 7.1: Run the full vitest suite**

```bash
npm test
```

Expected: PASS — no regressions outside the touched files. Watch for two possible flakes:
- Any test that imported `TwelvePointToast` directly (other than `AnnouncingView.test.tsx` and `RevealToast.test.tsx`) — should be zero per the pre-plan grep; if any surface, they need the same rename treatment.
- Any test that imported the old `announce.shortReveal.guestToast` key — if a test fixture re-declared messages with that key, the test will skip rendering. None known.

- [ ] **Step 7.2: Run type-check**

```bash
npm run type-check
```

Expected: PASS.

- [ ] **Step 7.3: Run lint**

```bash
npm run lint
```

Expected: PASS — no new ESLint findings.

- [ ] **Step 7.4: Manual smoke checklist**

Start the dev server:

```bash
npm run dev
```

Open three browser windows on the same room (use `npm run seed:room announcing-mid-queue-live` to get a deterministic fixture, or set up manually):

| Window | Role | Style |
|---|---|---|
| 1 | Active announcer (the user matching `announcing_user_id`) | full |
| 2 | Owner watching (the user matching `owner_user_id`, but not the announcer) | full |
| 3 | Guest watching (any other room member) | full |

Advance through 3 reveals (window 1 taps "Reveal next point"). Confirm:

| Surface | Still to give line | Reveal moment | Leaderboard density |
|---|---|---|---|
| Window 1 (driver) | ✅ Single-line monospace at top; strike-through advances per reveal | ✅ Big 4.5s flash card (border-2 primary) | Full (`py-2`, larger rank chip) |
| Window 2 (owner-watching) | ❌ Absent | ✅ Top-of-screen toast pill (3s), no flash card | Compact (`py-1`, smaller rank chip) |
| Window 3 (guest-watching) | ❌ Absent | ✅ Top-of-screen toast pill (3s), no flash card | Compact |

Then repeat with `announcement_style = 'short'`:

| Window | Still to give | Reveal | Leaderboard |
|---|---|---|---|
| 1 (driver) | ❌ Absent (degenerate) | Big splash card from `<TwelvePointSplash>` (existing) | Full |
| 2 (owner-watching) | ❌ Absent | Top-of-screen toast pill | Compact |
| 3 (guest-watching) | ❌ Absent | Top-of-screen toast pill | Compact |

Verify in the short-style runs that the previously-double-rendered surfaces are now cleanly split: window 2 + 3 see ONLY the toast (not toast + big flash card together).

- [ ] **Step 7.5: Push the branch**

```bash
git push -u origin feat/l1-watcher-driver-split
```

- [ ] **Step 7.6: Open the PR via `gh pr create`** (separate session — see project workflow). Include the manual smoke checklist results in the PR description.

- [ ] **Step 7.7: Update `TODO.md` once PR merges**

Per the user's persisted preference (`feedback_auto_tick_todo.md`): flip the relevant TODO lines to `[x]` after merge.

Specifically:
- [TODO.md:94](../../../TODO.md#L94) — change from `[~]` to `[x]` (the announcer-phone vs guest-phone differentiation that completes the L1 three-surface matrix); the partial annotation can stay as historical context.
- [TODO.md:162](../../../TODO.md#L162) — change from `[~]` to `[x]` (§10.2 three-surface reveal matrix — L1).

The `feature/l1-l1-three-surface-matrix` line in the ship-floor section (line 470) already calls these out as "L1 partial — turn/next-point indicators + announcer-phone vs guest-phone differentiation" — after this PR merges, only the per-reveal overlay flash item would remain, which the spec already deferred.
