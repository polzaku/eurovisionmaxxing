# PR B — Short live reveal surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing live surfaces for SPEC §10.2.2 short reveal. Announcer phone gets a compressed "Reveal 12 points" CTA. Present TV gets a 3-second splash overlay on each 12-point tap. Guest phones get a transient 3-second toast. PR A's server orchestrator + broadcasts are already in place.

**Architecture:** Two new presentational components (`TwelvePointSplash`, `TwelvePointToast`). New short-style render branches inside the existing `AnnouncingView` and `PresentScreen` components, gated on a new `announcementStyle` prop. The page-level subscribers (`/room/[id]/page.tsx` and `/room/[id]/present/page.tsx`) feed `splashEvent` data down when `announce_next` lands. Listening for `score_batch_revealed` triggers a refetch (no new local state needed).

**Tech Stack:** React 18, next-intl, Tailwind, Vitest + RTL with jsdom.

**Product spec of record:** SPEC §10.2.2 surface table (lines 1004–1008) + the post-tap behaviour at line 1006.

---

### Task 1: Propagate `announcementStyle` through props

**Files:**
- Modify: `src/app/room/[id]/page.tsx`
- Modify: `src/app/room/[id]/present/page.tsx`
- Modify: `src/components/room/AnnouncingView.tsx` (props interface only — render changes in Task 5)
- Modify: `src/components/present/PresentScreen.tsx` (props interface only — render changes in Task 6)

- [ ] **Step 1: Confirm fetchRoomData already returns announcementStyle**

Run: `Grep "announcementStyle" src/lib/room/api.ts src/lib/rooms/get.ts -n` — should show it in the mapped Room return. PR A's `mapRoom` change wired this.

If missing from `src/lib/room/api.ts`'s response interface, add it (the runtime data is already there from PR A; only the TypeScript surface might need updating).

- [ ] **Step 2: Extend `RoomShape` in `src/app/room/[id]/page.tsx`**

Find the `RoomShape` (or equivalent) interface used in the room page. Add `announcementStyle: 'full' | 'short'`. Pass `announcementStyle={room.announcementStyle}` to the `<AnnouncingView />` mount.

- [ ] **Step 3: Extend `RoomShape` in `src/app/room/[id]/present/page.tsx`**

Add `announcementStyle?: 'full' | 'short'` to the local `RoomShape` interface (around line 16). Default to `'full'` when missing for safety. Pass `announcementStyle={phase.room.announcementStyle ?? 'full'}` to `<PresentScreen />`.

- [ ] **Step 4: Add prop to AnnouncingView**

In `src/components/room/AnnouncingView.tsx`'s `AnnouncingViewProps`, add:
```ts
announcementStyle?: 'full' | 'short';
```
Default to `'full'` in the destructure. The prop is consumed by Task 5; for now, just accept it and route it into a local variable.

- [ ] **Step 5: Add prop to PresentScreen**

In `src/components/present/PresentScreen.tsx`'s `PresentScreenProps`, add:
```ts
announcementStyle?: 'full' | 'short';
```
Default to `'full'`. Consumed by Task 6.

- [ ] **Step 6: Type-check + lint + tests**

Run: `npm run type-check && npm run lint && npm run test`
Expected: clean. Existing tests pass (the new prop is optional).

- [ ] **Step 7: Commit**

```bash
git add src/app/room/[id]/page.tsx src/app/room/[id]/present/page.tsx \
  src/components/room/AnnouncingView.tsx src/components/present/PresentScreen.tsx \
  src/lib/room/api.ts  # only if it needed an update
git commit -m "feat(announce): plumb announcementStyle through to views (R4 §10.2.2)

Type-only propagation: page → AnnouncingView and page → PresentScreen
now accept announcementStyle. Render branches land in subsequent
commits. Defaults to 'full' everywhere so existing rooms render
identically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Locale keys (en + 4 stubs)

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`
- Modify: `src/locales/uk.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/de.json`

- [ ] **Step 1: Read en.json to find the existing `announce.*` namespace**

Run: `Grep "\"announce\"" src/locales/en.json -A 3` to locate.

- [ ] **Step 2: Add the `announce.shortReveal` block to en.json**

Inside the existing `"announce": { ... }` block (or at top level if no `announce` namespace exists; check `Grep "announce" src/locales/en.json -n` first), add:

```json
"shortReveal": {
  "cta": "Reveal 12 points",
  "ctaMicrocopy": "Tap when you say it",
  "revealed": "Revealed ✓",
  "awaitingTwelve": "Awaiting their 12 points…",
  "guestToast": "{name} gave 12 to {country} {flag}"
}
```

- [ ] **Step 3: Mirror the same shape into es.json, uk.json, fr.json, de.json with empty-string values**

For each of the 4 locale files, add the same `shortReveal` block but with empty strings:
```json
"shortReveal": {
  "cta": "",
  "ctaMicrocopy": "",
  "revealed": "",
  "awaitingTwelve": "",
  "guestToast": ""
}
```

This satisfies the locales parity test (`src/locales/locales.test.ts`) without committing to translation copy — L3 translation pass happens separately.

- [ ] **Step 4: Run the locale parity test**

Run: `npx vitest run src/locales/locales.test.ts`
Expected: pass. If it fails, the parity test is comparing key shapes — ensure the JSON structure matches across all 5 files exactly.

- [ ] **Step 5: Type-check + full test**

Run: `npm run type-check && npm run test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/locales/{en,es,uk,fr,de}.json
git commit -m "feat(locale): announce.shortReveal namespace + 4-language stubs (R4 §10.2.2)

5 new keys for the short live reveal surfaces: cta, ctaMicrocopy,
revealed (✓), awaitingTwelve (TV ticker), guestToast (transient
toast). en.json is the authoritative copy; es/uk/fr/de carry empty
stubs for parity (L3 translation deferred to Phase L).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `TwelvePointSplash` component + RTL tests

**Files:**
- Create: `src/components/room/TwelvePointSplash.tsx`
- Create: `src/components/room/TwelvePointSplash.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/room/TwelvePointSplash.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import TwelvePointSplash from "./TwelvePointSplash";
import type { Contestant } from "@/types";

const messages = {
  announce: {
    shortReveal: {
      revealed: "Revealed ✓",
    },
  },
};

const sampleContestant: Contestant = {
  id: "2026-se",
  country: "Sweden",
  countryCode: "se",
  flagEmoji: "🇸🇪",
  artist: "Test Artist",
  song: "Test Song",
  runningOrder: 1,
  event: "final",
  year: 2026,
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("TwelvePointSplash", () => {
  it("renders flag + country + artist + song in fullscreen size", () => {
    renderWithIntl(
      <TwelvePointSplash contestant={sampleContestant} size="fullscreen" />,
    );
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Test Artist")).toBeInTheDocument();
    expect(screen.getByText("Test Song")).toBeInTheDocument();
    expect(screen.getByText("🇸🇪")).toBeInTheDocument();
  });

  it("renders all content in card size", () => {
    renderWithIntl(
      <TwelvePointSplash contestant={sampleContestant} size="card" />,
    );
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Test Artist")).toBeInTheDocument();
  });

  it("calls onDismiss after dismissAfterMs", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderWithIntl(
      <TwelvePointSplash
        contestant={sampleContestant}
        size="fullscreen"
        onDismiss={onDismiss}
        dismissAfterMs={3000}
      />,
    );
    vi.advanceTimersByTime(2999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("renders without artist/song when fields are missing (degenerate)", () => {
    const partial: Contestant = {
      ...sampleContestant,
      artist: "",
      song: "",
    };
    renderWithIntl(
      <TwelvePointSplash contestant={partial} size="card" />,
    );
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    // No crash; artist/song absent or empty but country still renders.
  });
});
```

- [ ] **Step 2: Run tests — expect RED (component doesn't exist)**

Run: `npx vitest run src/components/room/TwelvePointSplash.test.tsx`
Expected: FAIL (file not found).

- [ ] **Step 3: Implement the component**

Create `src/components/room/TwelvePointSplash.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import type { Contestant } from "@/types";

interface TwelvePointSplashProps {
  contestant: Contestant;
  /** 'fullscreen' for /present TV; 'card' for announcer phone post-tap. */
  size: "fullscreen" | "card";
  /** Optional callback fired after dismissAfterMs (default 3000). */
  onDismiss?: () => void;
  dismissAfterMs?: number;
}

/**
 * SPEC §10.2.2 — large country flag emoji + country name + artist + song
 * splash shown when the announcer reveals their 12-point pick. Same
 * content on /present (fullscreen variant) and the announcer's phone
 * (card variant, scaled down).
 */
export default function TwelvePointSplash({
  contestant,
  size,
  onDismiss,
  dismissAfterMs = 3000,
}: TwelvePointSplashProps) {
  useEffect(() => {
    if (!onDismiss) return;
    const timer = setTimeout(onDismiss, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [onDismiss, dismissAfterMs]);

  const isFullscreen = size === "fullscreen";

  return (
    <div
      data-testid="twelve-point-splash"
      data-size={size}
      className={`flex flex-col items-center justify-center motion-safe:animate-fade-in ${
        isFullscreen
          ? "w-full px-12 py-12 text-center"
          : "w-full rounded-2xl border-2 border-primary bg-primary/10 px-6 py-8 text-center"
      }`}
    >
      <span
        aria-hidden
        className={isFullscreen ? "text-[20vw] leading-none" : "text-7xl"}
      >
        {contestant.flagEmoji}
      </span>
      <p
        className={`mt-4 font-extrabold ${
          isFullscreen ? "text-[8vw] leading-tight" : "text-4xl"
        }`}
      >
        {contestant.country}
      </p>
      {contestant.artist ? (
        <p
          className={`mt-3 font-semibold ${
            isFullscreen ? "text-[3vw]" : "text-xl"
          }`}
        >
          {contestant.artist}
        </p>
      ) : null}
      {contestant.song ? (
        <p
          className={`mt-1 italic text-muted-foreground ${
            isFullscreen ? "text-[2.5vw]" : "text-lg"
          }`}
        >
          {contestant.song}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect GREEN**

Run: `npx vitest run src/components/room/TwelvePointSplash.test.tsx`
Expected: 4 PASS.

- [ ] **Step 5: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/room/TwelvePointSplash.tsx src/components/room/TwelvePointSplash.test.tsx
git commit -m "feat(announce): TwelvePointSplash component (R4 §10.2.2)

Shared splash for the 12-point reveal: large flag emoji + country
name + artist + song. Two size variants: 'fullscreen' for /present TV
(viewport-scaled type), 'card' for announcer phone post-tap (fixed
sizes inside a bordered container). Internal 3-second auto-dismiss
timer via useEffect callback. Reduced-motion safe via
motion-safe:animate-fade-in (no-op under prefers-reduced-motion).

4 RTL tests cover both sizes, dismiss timer, degenerate
artist/song-missing input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `TwelvePointToast` component + RTL tests

**Files:**
- Create: `src/components/room/TwelvePointToast.tsx`
- Create: `src/components/room/TwelvePointToast.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/components/room/TwelvePointToast.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import TwelvePointToast, { type ToastEvent } from "./TwelvePointToast";

const messages = {
  announce: {
    shortReveal: {
      guestToast: "{name} gave 12 to {country} {flag}",
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

describe("TwelvePointToast", () => {
  it("renders the most recent event with name + country + flag", () => {
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        at: Date.now(),
      },
    ];
    renderWithIntl(<TwelvePointToast events={events} />);
    expect(screen.getByText(/Alice gave 12 to Sweden/)).toBeInTheDocument();
  });

  it("auto-dismisses after dismissAfterMs", () => {
    vi.useFakeTimers();
    const events: ToastEvent[] = [
      {
        id: "1",
        announcingUserDisplayName: "Alice",
        country: "Sweden",
        flagEmoji: "🇸🇪",
        at: Date.now(),
      },
    ];
    renderWithIntl(<TwelvePointToast events={events} dismissAfterMs={3000} />);
    expect(screen.queryByText(/Alice gave 12/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText(/Alice gave 12/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders nothing when events is empty", () => {
    renderWithIntl(<TwelvePointToast events={[]} />);
    expect(screen.queryByText(/gave 12/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — expect RED**

Run: `npx vitest run src/components/room/TwelvePointToast.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

Create `src/components/room/TwelvePointToast.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export interface ToastEvent {
  id: string;
  announcingUserDisplayName: string;
  country: string;
  flagEmoji: string;
  at: number;
}

interface TwelvePointToastProps {
  events: ToastEvent[];
  /** Default 3000ms per SPEC §10.2.2 surface table. */
  dismissAfterMs?: number;
}

/**
 * SPEC §10.2.2 — transient toast for guest phones (non-announcer, non-
 * owner-watching) when the announcer reveals their 12-point pick.
 * Shows the latest event; auto-dismisses after 3s.
 */
export default function TwelvePointToast({
  events,
  dismissAfterMs = 3000,
}: TwelvePointToastProps) {
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
      data-testid="twelve-point-toast"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm rounded-full bg-primary/95 px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg motion-safe:animate-fade-in"
    >
      {t("announce.shortReveal.guestToast", {
        name: visible.announcingUserDisplayName,
        country: visible.country,
        flag: visible.flagEmoji,
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect GREEN**

Run: `npx vitest run src/components/room/TwelvePointToast.test.tsx`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/room/TwelvePointToast.tsx src/components/room/TwelvePointToast.test.tsx
git commit -m "feat(announce): TwelvePointToast component (R4 §10.2.2)

Transient 3-second toast shown on guest phones (non-announcer,
non-owner-watching) when the announcer reveals their 12-point pick.
Latest event wins; older events superseded. Polite aria-live for
screen-readers.

3 RTL tests cover render, auto-dismiss, empty-events no-op.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `AnnouncingView` short-style branches

**Files:**
- Modify: `src/components/room/AnnouncingView.tsx`
- Modify: `src/components/room/AnnouncingView.test.tsx`

- [ ] **Step 1: Re-read AnnouncingView.tsx to identify integration points**

Critical sections:
- `useRoomRealtime` subscriber (line ~207) — add a `score_batch_revealed` handler that calls `refetch()`, and ALSO captures the 12pt info on `announce_next` for non-driver users to feed the toast.
- The `isActiveDriver && announcement?.pendingReveal` JSX branch (around line 514) — gate the existing full-style tap-zone on `announcementStyle !== 'short'` and add a new short-style block.
- After the `justRevealed` flash card (around line 479) — wrap the existing flash render in a `style !== 'short'` guard so it doesn't double-up with the splash. Actually, the existing flash card IS effectively the splash; under short style we want to render the splash component instead. Decide based on visual review during implementation.

- [ ] **Step 2: Add toast event state**

Near the existing `useState` declarations, add:
```ts
const [toastEvents, setToastEvents] = useState<ToastEvent[]>([]);
```

Import `ToastEvent` from `@/components/room/TwelvePointToast`.

- [ ] **Step 3: Extend the `useRoomRealtime` handler**

Add two cases inside the existing switch-like chain:

```ts
if (event.type === "score_batch_revealed") {
  void refetch();
  return;
}
```

And modify the existing `announce_next` case to ALSO push a toast event when style=short AND current user is NOT the active driver:

```ts
if (event.type === "announce_next") {
  setJustRevealed({
    contestantId: event.contestantId,
    points: event.points,
    announcingUserId: event.announcingUserId,
    timestamp: Date.now(),
  });
  // Guest toast (non-driver under short style)
  if (announcementStyle === "short" && currentUserId !== event.announcingUserId) {
    const contestant = contestantById.current.get(event.contestantId);
    const announcerMember = members?.find((m) => m.userId === event.announcingUserId);
    if (contestant && announcerMember) {
      setToastEvents((prev) => [
        ...prev,
        {
          id: `toast-${event.announcingUserId}-${Date.now()}`,
          announcingUserDisplayName: announcerMember.displayName,
          country: contestant.country,
          flagEmoji: contestant.flagEmoji,
          at: Date.now(),
        },
      ]);
    }
  }
  void refetch();
  return;
}
```

Note: `members` is currently optional and only passed for owner views. If it's missing for non-owner guests, the toast won't render. Fix by ALWAYS passing `members` from `/room/[id]/page.tsx` (a small but real prop-flow tweak). If page.tsx already passes `members` unconditionally, no change needed; otherwise extend.

Alternatively, look up the announcer's display name from `announcement.announcingDisplayName` in the AnnouncementState (already present on the state and refetched). Use that to avoid the `members` dependency entirely:

```ts
if (announcementStyle === "short" && currentUserId !== event.announcingUserId) {
  const contestant = contestantById.current.get(event.contestantId);
  const announcerName = announcement?.announcingDisplayName ?? "Someone";
  if (contestant) {
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
  }
}
```

This is preferable — `announcement` is the source of truth for the current announcer.

- [ ] **Step 4: Render the toast inside the view**

Near the top of the return (alongside `<SkipBannerQueue />`), add:
```tsx
<TwelvePointToast events={toastEvents} />
```

Import: `import TwelvePointToast, { type ToastEvent } from "@/components/room/TwelvePointToast";`

- [ ] **Step 5: Add the short-style active-driver render branch**

Replace the existing `{isActiveDriver && announcement?.pendingReveal ? (...) : null}` block with:

```tsx
{isActiveDriver && announcement?.pendingReveal && announcementStyle === "short" ? (
  <ShortStyleRevealCard
    onReveal={handleReveal}
    submitting={advanceState.kind === "submitting"}
    error={advanceState.error}
    contestant={pendingContestant ?? null}
    justRevealedContestant={
      justRevealed
        ? contestantById.current.get(justRevealed.contestantId) ?? null
        : null
    }
    isDelegate={isDelegate}
    announcerName={announcerName}
    handoffState={handoffState}
    onHandoffBack={() => handleTakeControl(false)}
  />
) : isActiveDriver && announcement?.pendingReveal ? (
  /* the existing full-style tap-zone block — unchanged */
  ...existing JSX...
) : null}
```

Define `ShortStyleRevealCard` as an internal function in the same file (below the existing `renderHeader` function):

```tsx
function ShortStyleRevealCard({
  onReveal,
  submitting,
  error,
  contestant,
  justRevealedContestant,
  isDelegate,
  announcerName,
  handoffState,
  onHandoffBack,
}: {
  onReveal: () => void;
  submitting: boolean;
  error?: string;
  contestant: Contestant | null;
  justRevealedContestant: Contestant | null;
  isDelegate: boolean;
  announcerName: string;
  handoffState: { kind: "idle" | "submitting"; error?: string };
  onHandoffBack: () => void;
}) {
  const t = useTranslations();
  // After tap: the rank-1 row marked announced → refetch → pendingReveal is null
  // → justRevealedContestant carries the splash data.
  if (justRevealedContestant) {
    return (
      <div className="space-y-4">
        <p className="text-center text-sm font-semibold text-primary">
          {t("announce.shortReveal.revealed")}
        </p>
        <TwelvePointSplash contestant={justRevealedContestant} size="card" />
      </div>
    );
  }
  return (
    <div className="rounded-2xl border-2 border-accent/60 bg-accent/5 px-5 py-6 space-y-4 text-center">
      <button
        type="button"
        onClick={onReveal}
        disabled={submitting || !contestant}
        className="w-full rounded-xl bg-primary px-6 py-5 text-2xl font-bold text-primary-foreground transition-all hover:scale-[1.01] hover:emx-glow-gold active:scale-[0.99] disabled:opacity-60"
      >
        {submitting ? "…" : t("announce.shortReveal.cta")}
      </button>
      <p className="text-xs text-muted-foreground">
        {t("announce.shortReveal.ctaMicrocopy")}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {isDelegate ? (
        <button
          type="button"
          onClick={onHandoffBack}
          disabled={handoffState.kind === "submitting"}
          className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-medium transition-all hover:border-accent disabled:opacity-60"
        >
          {handoffState.kind === "submitting"
            ? "Releasing…"
            : `Give back control to ${announcerName}`}
        </button>
      ) : null}
    </div>
  );
}
```

Import `TwelvePointSplash` and `useTranslations`:
```ts
import TwelvePointSplash from "@/components/room/TwelvePointSplash";
import { useTranslations } from "next-intl";
```

- [ ] **Step 6: Write the 5 RTL test cases**

Read the existing `AnnouncingView.test.tsx` to find the mock pattern (likely `NextIntlClientProvider` with messages, props built around the existing `AnnouncementState` fixture). Add a new `describe("short-style (SPEC §10.2.2)", () => { ... })` block with:

- **Case A:** active announcer + style='short' renders the "Reveal 12 points" CTA + microcopy, does NOT render the existing "Up next" tap-zone (assert by querying for the "tap anywhere to reveal" substring — should be absent).
- **Case B:** active announcer + style='full' (control) renders the existing tap-zone, no short CTA (query for the short CTA copy — should be absent).
- **Case C:** active announcer + style='short' + a `justRevealed` event applied: renders `data-testid="twelve-point-splash"` with `data-size="card"` and the right contestant content; does NOT render the CTA button.
- **Case D:** guest watching + style='short' + an `announce_next` realtime event fired with a known contestant ID: a toast appears with copy "{announcerName} gave 12 to {country} {flag}". Use the `useRoomRealtime` mock pattern.
- **Case E:** guest watching + style='full' (control): announce_next fires, no toast appears.

For events: the existing tests likely mock `useRoomRealtime` to capture the handler and invoke it manually. Follow the existing pattern.

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/components/room/AnnouncingView.test.tsx`
Expected: existing tests + 5 new = all green.

- [ ] **Step 8: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/room/AnnouncingView.tsx src/components/room/AnnouncingView.test.tsx
git commit -m "feat(announce): short-style render branches in AnnouncingView (R4 §10.2.2)

Active driver under short style sees a single full-width 'Reveal 12
points' CTA with 'Tap when you say it' microcopy, replacing the
verbose 1→12 tap-zone. After tap, the CTA card swaps to a 'Revealed ✓'
header + TwelvePointSplash (card variant) showing the contestant.

Non-driver users under short style receive a transient TwelvePointToast
on each announce_next broadcast — 'Name gave 12 to Country flag',
auto-dismiss 3s. Toast suppressed for the active driver (they already
see the splash).

score_batch_revealed subscriber fires a refetch so the leaderboard
re-renders with the 9 newly-revealed rows.

5 new RTL cases cover: active driver short renders CTA, full control
renders existing tap-zone, post-tap splash, guest toast on announce_next,
guest no-toast under full style.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `PresentScreen` short-style + `/present` page wiring

**Files:**
- Modify: `src/app/room/[id]/present/page.tsx`
- Modify: `src/components/present/PresentScreen.tsx`
- Modify: `src/components/present/PresentScreen.test.tsx`

- [ ] **Step 1: Re-read PresentScreen.tsx and /present/page.tsx to map state flow**

The page currently subscribes to `status_changed`, `voting_ending`, `batch_reveal_started`, `announce_skip`. It POLLS `/api/results` every 2s instead of subscribing to point-by-point. For short style, we need the splash to fire immediately on `announce_next` — polling is too slow.

- [ ] **Step 2: Extend the page's realtime subscriber**

Add a new state in the page:
```ts
const [splashEvent, setSplashEvent] = useState<{
  contestantId: string;
  triggerKey: number;
} | null>(null);
```

In the `useRoomRealtime` handler, add:
```ts
if (event.type === "announce_next") {
  // Only the short-style page consumes this; the full-style version
  // polls and renders via the standard "Up next" card.
  setSplashEvent({
    contestantId: event.contestantId,
    triggerKey: Date.now(),
  });
  // Also accelerate the next poll cycle.
  void load();
  return;
}
```

Pass to PresentScreen:
```tsx
<PresentScreen
  ...existing props...
  announcementStyle={phase.room.announcementStyle ?? "full"}
  splashEvent={splashEvent}
  onSplashDismiss={() => setSplashEvent(null)}
/>
```

(The `announcementStyle` prop was added in Task 1; just wire the value here.)

- [ ] **Step 3: Add the new props to `PresentScreen`**

In `PresentScreenProps`:
```ts
splashEvent?: { contestantId: string; triggerKey: number } | null;
onSplashDismiss?: () => void;
```

(`announcementStyle` was added in Task 1.)

- [ ] **Step 4: Render the short-style ticker + splash**

In the `announcing` branch of PresentScreen (locate via Grep `data-status="announcing"`), add ABOVE the existing leaderboard markup:

```tsx
{announcementStyle === "short" && splashEvent ? (
  <TwelvePointSplash
    contestant={contestantById.get(splashEvent.contestantId)!}
    size="fullscreen"
    onDismiss={onSplashDismiss}
    dismissAfterMs={3000}
  />
) : null}
```

Guard against `contestantById.get(splashEvent.contestantId)` returning undefined — render null in that case to avoid a crash.

For the bottom ticker (visible between turns under short style, when there's an active announcer but no splash):

```tsx
{announcementStyle === "short" &&
 status === "announcing" &&
 announcerDisplayName &&
 !splashEvent ? (
  <p
    data-testid="present-short-ticker"
    className="mt-6 text-3xl text-muted-foreground motion-safe:animate-pulse text-center"
  >
    {t("announce.shortReveal.awaitingTwelve")}
  </p>
) : null}
```

Import `TwelvePointSplash` at the top.

- [ ] **Step 5: Write the 4 RTL test cases**

In `PresentScreen.test.tsx`, add a new describe block:

- **Case A:** status='announcing' + style='short' + announcerDisplayName set + splashEvent=null: renders the "Awaiting their 12 points…" ticker (testid `present-short-ticker`).
- **Case B:** style='short' + splashEvent set: renders `TwelvePointSplash` with the right contestant; ticker is NOT rendered.
- **Case C:** style='full' (control): no ticker, no splash, existing leaderboard renders.
- **Case D:** style='short' + splashEvent set but contestant ID is unknown: doesn't crash; the splash silently skips render. (Defensive guard.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/components/present/PresentScreen.test.tsx`
Expected: existing + 4 new green.

- [ ] **Step 7: Run full suite + type-check + lint**

Run: `npm run pre-push`
Expected: green; new test count = base + 16 (4 splash + 3 toast + 5 view + 4 present = 16).

- [ ] **Step 8: Commit**

```bash
git add src/app/room/[id]/present/page.tsx \
  src/components/present/PresentScreen.tsx \
  src/components/present/PresentScreen.test.tsx
git commit -m "feat(announce): PresentScreen short-style splash + ticker (R4 §10.2.2)

/present subscribes to announce_next, captures the splash event, and
passes it through to PresentScreen. Under style='short' + announcing,
the TV renders:
  - Between turns: a 'Awaiting their 12 points…' ticker beneath the
    leaderboard (pulse animation, motion-safe).
  - On tap: a TwelvePointSplash overlay (fullscreen variant: viewport-
    scaled flag + country + artist + song). Auto-dismisses 3s.

Defensive: splash silently no-ops when contestantId is unknown.

4 new RTL cases cover ticker visibility, splash render, full-mode
control, and the unknown-contestant guard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## After all tasks

- [ ] **Manual smoke (optional, recommended):** Start `npm run dev`. UPDATE a test room to `announcement_style='short'`. Open /room/{id} on a phone-shaped browser viewport AND /room/{id}/present on a TV-shaped viewport. Step through a turn. Confirm:
  - Announcer sees the compressed CTA.
  - Tap → splash appears on both surfaces.
  - Splash auto-dismisses after 3s.
  - Leaderboard updates correctly via score_batch_revealed broadcast.
  - Guest viewport sees the toast (open a third tab as a guest user).
- [ ] **Run `npm run pre-push`** — final validation.
- [ ] **Hold for user push approval.** Per the established pattern, don't push until user says push.
- [ ] **On approval:** push + open PR with body templated from PR A (#104).
