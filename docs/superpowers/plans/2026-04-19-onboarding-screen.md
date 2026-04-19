# Onboarding Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/onboard` — a new-user screen with a display-name input, live DiceBear avatar preview (300ms debounced, seeded from the typed name), and a 6-tile avatar carousel (tap-avatar or Shuffle) that latches keystroke-driven regeneration off once opened; on submit, persists `emx_session` in localStorage via `POST /api/auth/onboard` and redirects to a sanitized `?next=` path.

**Architecture:** Server-rendered route `/onboard` wraps a `"use client"` form component in a `<Suspense>` boundary (required by Next 14 App Router for `useSearchParams`). Form state is a small machine whose `effectiveSeed = selectedSeed ?? previewSeed`; pure modules handle carousel-seed generation and `?next=` sanitization and are fully unit-tested. No new dependencies.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript (strict), Tailwind (repo palette), vitest (node env, pure-logic tests only), existing `POST /api/auth/onboard`, existing `src/lib/session.ts` and `src/components/ui/Avatar.tsx`.

**Spec reference:** [docs/superpowers/specs/2026-04-19-onboarding-screen-design.md](../specs/2026-04-19-onboarding-screen-design.md). `SPEC.md` §4.1, §4.2. `CLAUDE.md` §3.1–3.2.

---

## File structure

Files to **create**:

| Path | Responsibility |
|---|---|
| `src/lib/onboarding/safeNext.ts` | `sanitizeNextPath(raw: unknown): string` — pure URL-safety filter |
| `src/lib/onboarding/safeNext.test.ts` | Table test of accept/reject cases |
| `src/lib/onboarding/seeds.ts` | `generateCarouselSeeds(currentSeed, rng, count=6)` — pure |
| `src/lib/onboarding/seeds.test.ts` | Deterministic-RNG tests |
| `src/lib/hooks/useDebouncedValue.ts` | Generic `useDebouncedValue<T>(value, delayMs)` hook |
| `src/components/onboarding/AvatarCarousel.tsx` | Presentational radiogroup of seed tiles + Shuffle |
| `src/components/onboarding/OnboardingForm.tsx` | `"use client"` — state machine, submit flow, redirect logic |
| `src/app/onboard/page.tsx` | Server route; renders `<Suspense>` + `<OnboardingForm />` |

Files to **modify**:

| Path | Why |
|---|---|
| `src/lib/auth/onboard.ts` | Export the existing `DISPLAY_NAME_REGEX` so the client can import the exact same regex |

No edits to: `src/lib/session.ts`, `src/lib/avatars.ts`, `src/lib/api-errors.ts`, `src/app/api/auth/onboard/route.ts`, `src/types/index.ts`, `src/app/page.tsx`.

---

## Task 1: Export `DISPLAY_NAME_REGEX` from the auth lib

**Files:**
- Modify: `src/lib/auth/onboard.ts:5`

The client form will validate input with the *exact* same regex the server uses. Exporting it from the existing module makes that a single source of truth (spec §9).

- [ ] **Step 1: Change the regex from local const to exported const**

In `src/lib/auth/onboard.ts`, replace line 5:

```typescript
const DISPLAY_NAME_REGEX = /^[A-Za-z0-9 \-]{2,24}$/;
```

with:

```typescript
export const DISPLAY_NAME_REGEX = /^[A-Za-z0-9 \-]{2,24}$/;
```

(Leave `AVATAR_SEED_MAX_LEN` alone — not needed externally.)

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm run test -- src/lib/auth/onboard.test.ts`
Expected: all existing onboard tests pass (no behavioral change).

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/onboard.ts
git commit -m "Export DISPLAY_NAME_REGEX for client-side mirror"
```

---

## Task 2: `sanitizeNextPath` — TDD

**Files:**
- Create: `src/lib/onboarding/safeNext.ts`
- Test:   `src/lib/onboarding/safeNext.test.ts`

Closes the open-redirect footgun on `?next=`. Pure function, zero React.

- [ ] **Step 1: Write the failing test**

Create `src/lib/onboarding/safeNext.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sanitizeNextPath } from "@/lib/onboarding/safeNext";

describe("sanitizeNextPath", () => {
  describe("accepts valid same-origin paths", () => {
    const valid = [
      "/",
      "/create",
      "/join",
      "/room/abc",
      "/create?year=2026",
      "/room/abc#results",
      "/a/b/c",
    ];
    for (const p of valid) {
      it(`accepts ${JSON.stringify(p)}`, () => {
        expect(sanitizeNextPath(p)).toBe(p);
      });
    }
  });

  describe("rejects dangerous or invalid input", () => {
    const invalid: Array<[string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
      ["empty string", ""],
      ["non-slash-start", "create"],
      ["protocol-relative //", "//evil.com"],
      ["protocol-relative /\\", "/\\evil.com"],
      ["absolute http", "http://evil.com"],
      ["absolute https", "https://evil.com"],
      ["javascript: scheme", "javascript:alert(1)"],
      ["data: scheme", "data:text/html,<script>"],
      ["control char in path", "/foo\x00bar"],
      ["newline in path", "/foo\nbar"],
      ["too long (>512)", "/" + "a".repeat(512)],
    ];
    for (const [label, raw] of invalid) {
      it(`rejects ${label} → "/"`, () => {
        expect(sanitizeNextPath(raw)).toBe("/");
      });
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- src/lib/onboarding/safeNext.test.ts`
Expected: FAIL — `Cannot find module '@/lib/onboarding/safeNext'` (or the described import error).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/onboarding/safeNext.ts`:

```typescript
const MAX_LEN = 512;
const CONTROL_CHAR_RE = /[\x00-\x1F]/;

export function sanitizeNextPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (raw.length === 0 || raw.length > MAX_LEN) return "/";
  if (raw[0] !== "/") return "/";
  // Block protocol-relative URLs ("//evil" and "/\\evil")
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  if (CONTROL_CHAR_RE.test(raw)) return "/";
  return raw;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- src/lib/onboarding/safeNext.test.ts`
Expected: all cases PASS.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/onboarding/safeNext.ts src/lib/onboarding/safeNext.test.ts
git commit -m "Add sanitizeNextPath for ?next= open-redirect safety"
```

---

## Task 3: `generateCarouselSeeds` — TDD

**Files:**
- Create: `src/lib/onboarding/seeds.ts`
- Test:   `src/lib/onboarding/seeds.test.ts`

Pure seed generator. First slot is always the current effective seed; remaining slots are unique random strings. RNG is injected so tests are deterministic.

- [ ] **Step 1: Write the failing test**

Create `src/lib/onboarding/seeds.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateCarouselSeeds, type Rng } from "@/lib/onboarding/seeds";

function seededRng(seed: number): Rng {
  // mulberry32 — deterministic pseudorandom for tests
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("generateCarouselSeeds", () => {
  it("puts currentSeed in slot 0", () => {
    const seeds = generateCarouselSeeds("Alice", seededRng(1));
    expect(seeds[0]).toBe("Alice");
  });

  it("returns exactly `count` seeds (default 6)", () => {
    expect(generateCarouselSeeds("Alice", seededRng(1))).toHaveLength(6);
    expect(generateCarouselSeeds("Alice", seededRng(1), 4)).toHaveLength(4);
    expect(generateCarouselSeeds("Alice", seededRng(1), 5)).toHaveLength(5);
  });

  it("contains no duplicates", () => {
    const seeds = generateCarouselSeeds("Alice", seededRng(42));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("is deterministic for a given RNG state", () => {
    const a = generateCarouselSeeds("Alice", seededRng(7));
    const b = generateCarouselSeeds("Alice", seededRng(7));
    expect(a).toEqual(b);
  });

  it("produces distinct sequences for distinct RNG states", () => {
    const a = generateCarouselSeeds("Alice", seededRng(1));
    const b = generateCarouselSeeds("Alice", seededRng(2));
    // slot 0 must match; at least one of slots 1..5 must differ
    expect(a[0]).toBe(b[0]);
    expect(a.slice(1)).not.toEqual(b.slice(1));
  });

  it("random seeds are non-empty and within a reasonable length", () => {
    const seeds = generateCarouselSeeds("Alice", seededRng(3));
    for (const s of seeds.slice(1)) {
      expect(s.length).toBeGreaterThanOrEqual(4);
      expect(s.length).toBeLessThanOrEqual(16);
    }
  });

  it("throws when count is outside [4, 6]", () => {
    expect(() => generateCarouselSeeds("Alice", seededRng(1), 3)).toThrow(RangeError);
    expect(() => generateCarouselSeeds("Alice", seededRng(1), 7)).toThrow(RangeError);
  });

  it("still returns count seeds even if a random collides with currentSeed", () => {
    // Pathological RNG: every number is 0. randomSeed() falls back to a
    // deterministic-but-unique sequence via the retry loop.
    const rng: Rng = () => 0;
    const seeds = generateCarouselSeeds("abc123", rng, 6);
    expect(seeds).toHaveLength(6);
    expect(new Set(seeds).size).toBe(6);
    expect(seeds[0]).toBe("abc123");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- src/lib/onboarding/seeds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/onboarding/seeds.ts`:

```typescript
export type Rng = () => number; // returns a value in [0, 1)

const MIN_RANDOM_LEN = 4;
const MAX_ATTEMPTS = 32;

function randomSeed(rng: Rng, salt: number): string {
  // Encode the RNG draw as base36. Mix in `salt` so that a pathological
  // RNG (e.g. always returns 0) still produces unique strings across calls.
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const raw = Math.floor(rng() * 0xffffffff) ^ (salt + i);
    const s = (raw >>> 0).toString(36);
    if (s.length >= MIN_RANDOM_LEN) return s;
  }
  // Deterministic fallback — guaranteed non-empty, unique per salt.
  return `s${salt.toString(36)}`;
}

export function generateCarouselSeeds(
  currentSeed: string,
  rng: Rng,
  count: number = 6,
): string[] {
  if (count < 4 || count > 6) {
    throw new RangeError(`count must be in [4, 6], got ${count}`);
  }
  const seeds: string[] = [currentSeed];
  const seen = new Set<string>([currentSeed]);
  let salt = 0;
  while (seeds.length < count) {
    const s = randomSeed(rng, salt++);
    if (!seen.has(s)) {
      seen.add(s);
      seeds.push(s);
    }
  }
  return seeds;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- src/lib/onboarding/seeds.test.ts`
Expected: all PASS.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/onboarding/seeds.ts src/lib/onboarding/seeds.test.ts
git commit -m "Add generateCarouselSeeds with injected RNG"
```

---

## Task 4: `useDebouncedValue` hook

**Files:**
- Create: `src/lib/hooks/useDebouncedValue.ts`

Small generic hook used by the form to debounce the typed name before it drives the avatar preview. No unit test — the project has no DOM test harness (see spec §12); correctness is verified via the form's manual browser pass.

- [ ] **Step 1: Write the hook**

Create `src/lib/hooks/useDebouncedValue.ts`:

```typescript
import { useEffect, useState } from "react";

/**
 * Returns `value` after it has been stable for `delayMs` milliseconds.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks/useDebouncedValue.ts
git commit -m "Add useDebouncedValue hook"
```

---

## Task 5: `AvatarCarousel` component

**Files:**
- Create: `src/components/onboarding/AvatarCarousel.tsx`

Presentational radiogroup of seed tiles + Shuffle button. Accepts `seeds`, `selectedSeed`, `onSelect`, `onShuffle`. Does not own any state. Tailwind tokens only.

- [ ] **Step 1: Write the component**

Create `src/components/onboarding/AvatarCarousel.tsx`:

```tsx
"use client";

import Avatar from "@/components/ui/Avatar";

interface AvatarCarouselProps {
  seeds: string[];
  selectedSeed: string;
  onSelect: (seed: string) => void;
  onShuffle: () => void;
}

export default function AvatarCarousel({
  seeds,
  selectedSeed,
  onSelect,
  onShuffle,
}: AvatarCarouselProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="avatar-carousel-label" className="text-sm font-semibold text-foreground">
          Choose your avatar
        </h2>
        <button
          type="button"
          onClick={onShuffle}
          aria-label="Shuffle avatars"
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          Shuffle
        </button>
      </div>

      <div
        role="radiogroup"
        aria-labelledby="avatar-carousel-label"
        className="grid grid-cols-3 gap-3 sm:grid-cols-6"
      >
        {seeds.map((seed) => {
          const selected = seed === selectedSeed;
          return (
            <button
              key={seed}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(seed)}
              className={[
                "flex aspect-square items-center justify-center rounded-xl border-2 p-1 transition-all",
                "min-h-11 min-w-11",
                selected
                  ? "border-primary bg-primary/10 animate-score-pop"
                  : "border-border hover:border-accent",
              ].join(" ")}
            >
              <Avatar seed={seed} size={64} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/AvatarCarousel.tsx
git commit -m "Add AvatarCarousel presentational component"
```

---

## Task 6: `OnboardingForm` — the state machine & submit flow

**Files:**
- Create: `src/components/onboarding/OnboardingForm.tsx`

Holds the name/debounce/carousel state, handles the submit POST, writes `emx_session`, and navigates to the sanitized `next` path. Also runs the "already onboarded → redirect away" check.

- [ ] **Step 1: Write the component**

Create `src/components/onboarding/OnboardingForm.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/ui/Avatar";
import AvatarCarousel from "@/components/onboarding/AvatarCarousel";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { generateCarouselSeeds } from "@/lib/onboarding/seeds";
import { sanitizeNextPath } from "@/lib/onboarding/safeNext";
import { DISPLAY_NAME_REGEX } from "@/lib/auth/onboard";
import { createExpiryDate, getSession, setSession } from "@/lib/session";

const DEFAULT_SEED = "emx-default";
const NAME_DEBOUNCE_MS = 300;

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function browserRng(): number {
  return Math.random();
}

interface OnboardResponse {
  userId: string;
  rejoinToken: string;
  displayName: string;
  avatarSeed: string;
}

interface ApiErrorShape {
  error: { code: string; message: string; field?: string };
}

export default function OnboardingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => sanitizeNextPath(searchParams.get("next")),
    [searchParams],
  );

  // Already onboarded? Skip the form.
  const [redirectChecked, setRedirectChecked] = useState(false);
  useEffect(() => {
    if (getSession()) {
      router.replace(nextPath);
      return;
    }
    setRedirectChecked(true);
  }, [router, nextPath]);

  const [name, setName] = useState("");
  const debouncedName = useDebouncedValue(name, NAME_DEBOUNCE_MS);

  const [carouselOpen, setCarouselOpen] = useState(false);
  const [carouselSeeds, setCarouselSeeds] = useState<string[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null);
  const [previewSeed, setPreviewSeed] = useState<string>(DEFAULT_SEED);

  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Keystroke-driven regeneration — disabled once carousel has been opened.
  useEffect(() => {
    if (carouselOpen) return;
    const normalized = normalizeName(debouncedName);
    setPreviewSeed(normalized.length > 0 ? normalized : DEFAULT_SEED);
  }, [debouncedName, carouselOpen]);

  const effectiveSeed = selectedSeed ?? previewSeed;

  function openOrShuffleCarousel() {
    const seeds = generateCarouselSeeds(effectiveSeed, browserRng);
    setCarouselSeeds(seeds);
    setSelectedSeed(effectiveSeed);
    setCarouselOpen(true);
  }

  function onPickTile(seed: string) {
    setSelectedSeed(seed);
  }

  const normalized = normalizeName(name);
  const nameValid = DISPLAY_NAME_REGEX.test(normalized);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setGeneralError(null);
    if (!nameValid) {
      setFieldError("Use 2–24 letters, numbers, spaces, or hyphens.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: normalized,
          avatarSeed: effectiveSeed,
        }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as OnboardResponse;
        setSession({
          userId: data.userId,
          rejoinToken: data.rejoinToken,
          displayName: data.displayName,
          avatarSeed: data.avatarSeed,
          expiresAt: createExpiryDate(),
        });
        router.push(nextPath);
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiErrorShape | null;
      if (res.status === 400 && body?.error?.code === "INVALID_DISPLAY_NAME") {
        setFieldError(body.error.message);
      } else {
        setGeneralError("Couldn't create your identity. Try again.");
      }
    } catch {
      setGeneralError("Couldn't create your identity. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!redirectChecked) {
    return null;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-md space-y-8 px-6 py-10 animate-fade-in"
    >
      <div className="flex flex-col items-center space-y-4">
        <button
          type="button"
          onClick={openOrShuffleCarousel}
          aria-label="Change avatar"
          className="rounded-full border-2 border-border p-1 transition-colors hover:border-accent"
        >
          <Avatar seed={effectiveSeed} size={128} />
        </button>
        <p className="text-sm text-muted-foreground">Tap your avatar to change it.</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="displayName" className="text-sm font-semibold text-foreground">
          Your display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={24}
          aria-invalid={fieldError != null}
          aria-describedby={fieldError ? "displayName-error" : undefined}
          className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          placeholder="e.g. Alice"
        />
        {fieldError && (
          <p
            id="displayName-error"
            role="alert"
            aria-live="polite"
            className="text-sm text-hot-pink"
          >
            {fieldError}
          </p>
        )}
      </div>

      {carouselOpen && (
        <AvatarCarousel
          seeds={carouselSeeds}
          selectedSeed={effectiveSeed}
          onSelect={onPickTile}
          onShuffle={openOrShuffleCarousel}
        />
      )}

      {generalError && (
        <p role="alert" aria-live="polite" className="text-sm text-hot-pink">
          {generalError}
        </p>
      )}

      <button
        type="submit"
        disabled={!nameValid || submitting}
        className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
      >
        {submitting ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/OnboardingForm.tsx
git commit -m "Add OnboardingForm with debounced preview + carousel"
```

---

## Task 7: `/onboard` route with Suspense

**Files:**
- Create: `src/app/onboard/page.tsx`

Next 14 requires a `<Suspense>` boundary around any client component that uses `useSearchParams` (otherwise the build emits a `bail out to client-side rendering` warning and tree-shake breaks). The page is a server component that does nothing but render the boundary + the client form.

- [ ] **Step 1: Write the route**

Create `src/app/onboard/page.tsx`:

```tsx
import { Suspense } from "react";
import OnboardingForm from "@/components/onboarding/OnboardingForm";

export const metadata = {
  title: "Join — eurovisionmaxxing",
};

export default function OnboardPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <Suspense fallback={null}>
        <OnboardingForm />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: all tests pass (existing + the two new pure-logic suites).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: builds successfully with no `useSearchParams without Suspense` warning. If the warning appears, the Suspense boundary wasn't applied correctly — do not proceed.

- [ ] **Step 5: Commit**

```bash
git add src/app/onboard/page.tsx
git commit -m "Add /onboard route with Suspense boundary"
```

---

## Task 8: Manual browser verification

**Files:** none (exercise only)

The form has no component tests (deliberate — see spec §12). These checks are the acceptance gate before marking the TODO item done.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Open `http://localhost:3000/onboard` in a fresh browser profile (or clear `localStorage` first).

- [ ] **Step 2: Walk the matrix from spec §12**

Tick each as it passes:

- [ ] Empty name → default avatar visible, Join button **disabled**.
- [ ] Type `Al` → after ~300ms avatar updates once. Type a fast burst (`Alice is typing`) → preview updates at most every 300ms, not on every keystroke.
- [ ] Tap the big avatar → carousel appears with 6 tiles; slot 0 is the current avatar and is pre-selected.
- [ ] Tap tile 3 → big preview switches to tile 3's avatar; tile 3 now shows the selected border.
- [ ] Type additional characters → preview does **not** change (keystroke-regen is latched off).
- [ ] Tap **Shuffle** → slots 2–6 change; slot 1 (your current selection) is stable.
- [ ] Clear the name to `A` (1 char) → Join becomes **disabled**; typing a second char re-enables it.
- [ ] Type `!!` in the name → inline field error appears; Join stays disabled.
- [ ] Submit with valid name (e.g. `Alice`) → button shows `Joining…`, then redirects.
  - Default `next` → lands on `/` (marketing).
  - Open DevTools Application → Local Storage: `emx_session` exists with `userId`, `rejoinToken`, `displayName`, `avatarSeed`, `expiresAt` ~90 days out.
- [ ] Visit `/onboard?next=/create` in the same profile → **form never renders**; URL replaces to `/create`.
- [ ] Clear localStorage, visit `/onboard?next=//evil.com` → after submit, lands on `/` (open-redirect closed).
- [ ] Clear localStorage, visit `/onboard?next=/create` → after submit, lands on `/create`.

- [ ] **Step 3: Server-error resilience**

Temporarily break the API by renaming the Supabase URL env var (`NEXT_PUBLIC_SUPABASE_URL`) to something invalid in `.env.local`, restart `npm run dev`, submit the form:

- [ ] Inline error banner *"Couldn't create your identity. Try again."* appears.
- [ ] Name input still contains the typed value; Join button re-enables.
- [ ] Restore `.env.local`, restart dev server, submit again → succeeds.

- [ ] **Step 4: Dark/light mode sanity**

Toggle OS-level `prefers-color-scheme` both directions with the form open. No hardcoded colours; palette tokens should carry the theme switch.

- [ ] **Step 5: Keyboard & screen-reader spot-check**

- [ ] Tab order: avatar button → name input → (Shuffle, tiles when open) → Join.
- [ ] VoiceOver / NVDA reads the name label, the error live region, and "radio / selected" on the chosen tile.

- [ ] **Step 6: Update TODO.md**

Open `TODO.md` and tick the Phase 1 item:

```
- [x] Onboarding screen at `/` (or dedicated route): name input (2–24 chars, hyphen/space only), live DiceBear preview (300ms debounce), regenerate-seed tap, "Join" CTA
```

Also tick the two Phase U items this design subsumes:

```
- [x] §4.1 — onboarding avatar carousel of 4–6 candidate seeds; stop keystroke-driven regeneration once carousel has been opened — L5 / L6
```

(`TODO.md` is gitignored — do not commit.)

- [ ] **Step 7: Final pre-push**

Run: `npm run pre-push`
Expected: `tsc --noEmit` + full vitest suite both clean. Do not push with failures.

---

## Self-review notes

**Spec coverage:**
- §1 Goal → Task 6+7 build the screen; Task 2 protects `?next=`; Task 3 powers the carousel.
- §2 Route placement → Task 7.
- §3 File layout → every file in the spec has a task; the only modified file (`src/lib/auth/onboard.ts`) is Task 1.
- §4 User-visible behavior → all 7 points exercised in Task 8 Step 2.
- §5 State machine → encoded in Task 6 component.
- §6 Submission → Task 6 `onSubmit`.
- §7 Error handling → Task 6 status-code switch; Task 8 Step 3 exercises it.
- §8 `sanitizeNextPath` contract → Task 2 test table covers every listed accept/reject case.
- §9 Validation mirror → Task 1 exports the regex; Task 6 imports it.
- §10 Styling → Task 5/6 use only repo tokens; Task 8 Step 4 checks both themes.
- §11 Accessibility → Task 5 `role=radiogroup`/`radio`, Task 6 label/`aria-describedby`; Task 8 Step 5 checks keyboard + SR.
- §12 Testing strategy → Tasks 2, 3 TDD pure modules; Task 8 is the manual matrix.
- §13 Non-goals → not implemented; not referenced in any task.
- §14 Definition of done → Task 8 Step 7 + the manual checklist closes out.

**Placeholder scan:** No TBDs / TODOs / "add error handling" stubs. Every code step has complete code.

**Type consistency:**
- `DISPLAY_NAME_REGEX`: defined Task 1, imported in Task 6 — same name.
- `generateCarouselSeeds(currentSeed, rng, count)`: same signature in Tasks 3 and 6.
- `sanitizeNextPath(raw: unknown): string`: same signature in Tasks 2 and 6.
- `LocalSession` fields written in Task 6 match `src/types/index.ts` exactly (`userId, rejoinToken, displayName, avatarSeed, expiresAt`).
- `OnboardResponse` shape in Task 6 matches the 201 body emitted by `src/app/api/auth/onboard/route.ts:36` (`{ userId, rejoinToken, displayName, avatarSeed }`).
