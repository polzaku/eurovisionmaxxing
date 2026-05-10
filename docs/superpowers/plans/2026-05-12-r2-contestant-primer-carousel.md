# R2 #240 Contestant Primer Carousel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Horizontally scrollable card deck in the lobby. Tap a card to flip to its back side showing category hints + optional "Preview on YouTube" link. First flip writes the `emx_hints_seen_{roomId}` localStorage flag (consumed by §8.2 voting hint-collapse default).

**Architecture:** New `<ContestantPrimerCarousel>` component renders `<PrimerCard>` per contestant. CSS 3D transform with `backface-visibility: hidden` provides the flip animation; `motion-safe:` gating ensures reduced-motion users get instant swap. Existing `markSeen` helper from `src/lib/voting/emxHintsSeen.ts` writes the flag idempotently. Adds optional `artistPreviewUrl` field to `Contestant`/`ApiContestant`/`mapApiToContestant`. `<LobbyView>` gains a `contestants: Contestant[]` prop (NEW — page.tsx already has the data, just needs to pass through).

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind, Vitest + RTL with jsdom (per-file `// @vitest-environment jsdom`), `next-intl` for locale strings.

**Spec:** [docs/superpowers/specs/2026-05-12-r2-contestant-primer-carousel-design.md](../specs/2026-05-12-r2-contestant-primer-carousel-design.md)

**Branch:** `feat/r2-contestant-primer-carousel` — currently 1 commit ahead of main (spec doc, `45ca461`). Based on main with R2 #238 (PR #100) and R2 #239 (PR #99) merged.

**Key existing scaffolding:**
- `markSeen(roomId)` at [src/lib/voting/emxHintsSeen.ts](../../../src/lib/voting/emxHintsSeen.ts) — already idempotent, swallows Safari private-mode failures.
- `Contestant` interface at [src/types/index.ts:15](../../../src/types/index.ts#L15) — 9 fields today, gain a 10th.
- `ApiContestant` interface at [src/lib/contestants.ts:21](../../../src/lib/contestants.ts#L21) — already has `[key: string]: unknown` so unknown fields pass through. `isApiContestant` (line 60) needs an optional check. `mapApiToContestant` (line 95) needs to pass the field.
- `<LobbyView>` does NOT currently accept `contestants` — page.tsx has `phase.contestants` available; this slice plumbs it through.
- `LobbyCategory` type in `LobbyView.tsx` is `{ name: string; hint?: string }`.

---

## Task 1: Locale keys

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/{es,uk,fr,de}.json` (empty stubs per parity rule)

- [ ] **Step 1: Add `lobby.primer.*` to en.json**

Find the existing `"lobby"` namespace. Add a new sub-namespace:

```json
"primer": {
  "title": "Tonight's lineup",
  "tapHint": "Tap any card to see category hints",
  "previewSong": "Preview on YouTube",
  "flagAria": "{country} flag"
}
```

Place alphabetically within `lobby.*` (e.g., between `lobby.countdown` and `lobby.refreshContestants`).

- [ ] **Step 2: Add empty stubs to non-en files**

For each of `src/locales/{es,uk,fr,de}.json`, add the same nested structure with empty strings:

```json
"primer": {
  "title": "",
  "tapHint": "",
  "previewSong": "",
  "flagAria": ""
}
```

- [ ] **Step 3: Run locales test**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/locales 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/locales/en.json src/locales/es.json src/locales/uk.json src/locales/fr.json src/locales/de.json
git commit -m "$(cat <<'EOF'
feat(locale): lobby.primer.* keys (R2 #240)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `artistPreviewUrl` to Contestant type + data pipeline (TDD)

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/contestants.ts`
- Modify: `src/lib/contestants.test.ts`
- Modify: `data/contestants/9999/{semi1,semi2,final}.json` (add 1-2 preview URLs to test fixture)

- [ ] **Step 1: Write failing tests**

Add to `src/lib/contestants.test.ts` near existing `parseContestantsJson` / `mapApiToContestant` tests:

```ts
describe("contestants — artistPreviewUrl pass-through (R2 #240)", () => {
  it("preserves artistPreviewUrl on the domain Contestant when JSON includes it", async () => {
    // Test fixture 9999/final has at least one entry with artistPreviewUrl after this task lands.
    const contestants = await fetchContestants(TEST_FIXTURE_YEAR, "final");
    const withPreview = contestants.find((c) => c.artistPreviewUrl);
    expect(withPreview).toBeDefined();
    expect(typeof withPreview!.artistPreviewUrl).toBe("string");
    expect(withPreview!.artistPreviewUrl).toMatch(/^https?:\/\//);
  });

  it("leaves artistPreviewUrl undefined on contestants where the JSON entry omits it", async () => {
    const contestants = await fetchContestants(TEST_FIXTURE_YEAR, "final");
    const withoutPreview = contestants.find((c) => !c.artistPreviewUrl);
    expect(withoutPreview).toBeDefined();
    expect(withoutPreview!.artistPreviewUrl).toBeUndefined();
  });
});
```

These tests will FAIL until: (a) the field exists on the type, (b) it flows through `mapApiToContestant`, (c) the test fixture has at least one preview URL and at least one without.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib/contestants.test.ts 2>&1 | tail -15
```

Expected: 2 FAIL.

- [ ] **Step 3: Add `artistPreviewUrl` to `Contestant` type**

In `src/types/index.ts`, find the `Contestant` interface (around line 15). Add at the end:

```ts
/** Optional external deep-link to a song preview (e.g., YouTube). Surfaced
 * in the lobby contestant primer carousel (SPEC §6.6.3). */
artistPreviewUrl?: string;
```

- [ ] **Step 4: Update `ApiContestant`, `isApiContestant`, `mapApiToContestant`**

In `src/lib/contestants.ts`:

**`ApiContestant` interface** (line 21) — add an optional explicit field for clarity (the index signature already accepts it, but explicit is better):

```ts
interface ApiContestant {
  country: string;
  artist: string;
  song: string;
  runningOrder: number;
  artistPreviewUrl?: string;
  [key: string]: unknown;
}
```

**`isApiContestant`** (line 60) — add an optional-string check:

```ts
function isApiContestant(item: unknown): item is ApiContestant {
  if (typeof item !== "object" || item === null) return false;
  const c = item as Record<string, unknown>;
  return (
    typeof c.country === "string" &&
    typeof c.artist === "string" &&
    typeof c.song === "string" &&
    typeof c.runningOrder === "number" &&
    (c.artistPreviewUrl === undefined ||
      typeof c.artistPreviewUrl === "string")
  );
}
```

**`mapApiToContestant`** (line 95) — pass `artistPreviewUrl` through, only when defined:

```ts
function mapApiToContestant(
  item: ApiContestant,
  year: number,
  event: EventType
): Contestant {
  const code = getCountryCode(item.country);
  const result: Contestant = {
    id: `${year}-${code}`,
    country: item.country,
    countryCode: code,
    flagEmoji: countryCodeToFlagEmoji(code),
    artist: item.artist,
    song: item.song,
    runningOrder: item.runningOrder,
    event,
    year,
  };
  if (item.artistPreviewUrl !== undefined) {
    result.artistPreviewUrl = item.artistPreviewUrl;
  }
  return result;
}
```

(Conditional assignment so consumers can rely on `undefined` not being explicitly set.)

- [ ] **Step 5: Migrate test fixture**

Edit each of `data/contestants/9999/{semi1,semi2,final}.json` to add `artistPreviewUrl` to AT LEAST ONE entry (and leave at least one WITHOUT — the second test case requires both states).

For example, in `data/contestants/9999/final.json`, find the existing `"contestants": [ ... ]` array (post R2 #238 wrapper migration). Edit one entry like:

```json
{ "country": "Sweden", "artist": "Felicia", "song": "My System", "runningOrder": 2, "artistPreviewUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
```

Use a real YouTube placeholder URL (the rickroll one is a classic test placeholder; OR use `"https://www.youtube.com/watch?v=test"` — anything that matches `/^https?:\/\//`).

Edit at least one entry per file (semi1.json, semi2.json, final.json) so the new field exercises through all three. Leave at least one entry per file WITHOUT the field.

- [ ] **Step 6: Run tests to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib/contestants.test.ts 2>&1 | tail -10
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/lib 2>&1 | tail -5
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/lib/contestants.ts src/lib/contestants.test.ts data/contestants/9999/semi1.json data/contestants/9999/semi2.json data/contestants/9999/final.json
git commit -m "$(cat <<'EOF'
feat(contestants): optional artistPreviewUrl per contestant (R2 #240 / closes R2 #241)

Adds artistPreviewUrl?: string to the Contestant type. ApiContestant
shape gains the explicit optional field; isApiContestant rejects
non-string values when present; mapApiToContestant passes through
only when defined (so consumers can rely on `if (artistPreviewUrl)`
checks). Test fixture (year 9999) gains a preview URL on at least
one entry per event so the carousel's conditional render is
exercised.

Closes the second half of TODO #241 (broadcastStartUtc landed in
PR #100). Production JSON files keep their flat shape; operator
backfills artistPreviewUrl per contestant when ready (TODO #242).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: CSS flip-card utilities

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Read globals.css to find a good insertion point**

```bash
cat /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/app/globals.css | head -80
```

Find a section near the end that holds custom utilities (look for other `.emx-*` classes if any exist). If no such section, place the block just before the closing `@layer` directive or at the end of the file.

- [ ] **Step 2: Add the flip-card utilities**

Append (or insert in the appropriate utility section):

```css
.emx-flip-card {
  perspective: 1000px;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
}

.emx-flip-card__inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 400ms ease;
  transform-style: preserve-3d;
}

@media (prefers-reduced-motion: reduce) {
  .emx-flip-card__inner {
    transition: none;
  }
}

.emx-flip-card.is-flipped .emx-flip-card__inner {
  transform: rotateY(180deg);
}

.emx-flip-card__face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.emx-flip-card__back {
  transform: rotateY(180deg);
}
```

- [ ] **Step 3: Type-check + smoke**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
```

Expected: no errors. (CSS doesn't run through tsc, but verifying nothing broke.)

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(styles): .emx-flip-card utilities for primer carousel (R2 #240)

CSS 3D transform with backface-visibility: hidden for the flip
animation. Reduced-motion gated so the rotation animation drops
to instant swap (back-of-card content still surfaces).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<ContestantPrimerCarousel>` component + RTL (TDD)

**Files:**
- Create: `src/components/room/ContestantPrimerCarousel.tsx`
- Create: `src/components/room/ContestantPrimerCarousel.test.tsx`

- [ ] **Step 1: Write failing RTL tests**

`src/components/room/ContestantPrimerCarousel.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const markSeenMock = vi.fn();
vi.mock("@/lib/voting/emxHintsSeen", () => ({
  markSeen: markSeenMock,
}));

import ContestantPrimerCarousel from "./ContestantPrimerCarousel";
import type { Contestant } from "@/types";

function mkContestant(
  code: string,
  country: string,
  runningOrder: number,
  artistPreviewUrl?: string,
): Contestant {
  return {
    id: `9999-${code}`,
    country,
    countryCode: code,
    flagEmoji: "🏳️",
    artist: `Artist of ${country}`,
    song: `Song of ${country}`,
    runningOrder,
    event: "final",
    year: 9999,
    ...(artistPreviewUrl ? { artistPreviewUrl } : {}),
  };
}

const SE = mkContestant("se", "Sweden", 1, "https://youtube.com/watch?v=test");
const UA = mkContestant("ua", "Ukraine", 2);
const FR = mkContestant("fr", "France", 3);

const CATEGORIES = [
  { name: "Vocals", hint: "Pitch + power" },
  { name: "Outfit", hint: "Stage drama" },
  { name: "Choreo" }, // no hint
];

describe("<ContestantPrimerCarousel>", () => {
  beforeEach(() => {
    markSeenMock.mockClear();
  });

  it("renders one card per contestant", () => {
    render(
      <ContestantPrimerCarousel
        contestants={[SE, UA, FR]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    expect(screen.getByTestId(`primer-card-${SE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`primer-card-${UA.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`primer-card-${FR.id}`)).toBeInTheDocument();
  });

  it("renders nothing when contestants array is empty", () => {
    const { container } = render(
      <ContestantPrimerCarousel
        contestants={[]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("front shows running order, country, artist, song", () => {
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    // Running order shown as "№ 1" style.
    expect(screen.getByText(/1/)).toBeInTheDocument();
    expect(screen.getByText(SE.country)).toBeInTheDocument();
    expect(screen.getByText(SE.artist)).toBeInTheDocument();
    expect(screen.getByText(SE.song)).toBeInTheDocument();
  });

  it("tapping a card flips it (data-flipped='true')", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    const card = screen.getByTestId(`primer-card-${SE.id}`);
    expect(card).toHaveAttribute("data-flipped", "false");
    await user.click(card);
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("renders category hints (with hint set) on the back; skips categories without a hint", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );
    const card = screen.getByTestId(`primer-card-${SE.id}`);
    await user.click(card);
    // Vocals (with hint) should appear; Choreo (no hint) should not.
    expect(screen.getByText(/Pitch \+ power/)).toBeInTheDocument();
    expect(screen.getByText(/Stage drama/)).toBeInTheDocument();
    expect(screen.queryByText("Choreo:")).toBeNull();
  });

  it("renders 'Preview on YouTube' link only when artistPreviewUrl is set", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE, UA]}
        categories={CATEGORIES}
        roomId="r-1"
      />,
    );

    // Flip Sweden's card (has artistPreviewUrl).
    const seCard = screen.getByTestId(`primer-card-${SE.id}`);
    await user.click(seCard);
    const seLink = within(seCard).getByText(/lobby\.primer\.previewSong/);
    expect(seLink.closest("a")).toHaveAttribute("href", SE.artistPreviewUrl);
    expect(seLink.closest("a")).toHaveAttribute("target", "_blank");
    expect(seLink.closest("a")).toHaveAttribute("rel", "noopener noreferrer");

    // Flip Ukraine's card (no artistPreviewUrl).
    const uaCard = screen.getByTestId(`primer-card-${UA.id}`);
    await user.click(uaCard);
    expect(within(uaCard).queryByText(/lobby\.primer\.previewSong/)).toBeNull();
  });

  it("calls markSeen(roomId) on first front→back flip", async () => {
    const user = userEvent.setup();
    render(
      <ContestantPrimerCarousel
        contestants={[SE]}
        categories={CATEGORIES}
        roomId="r-42"
      />,
    );
    const card = screen.getByTestId(`primer-card-${SE.id}`);
    await user.click(card);
    expect(markSeenMock).toHaveBeenCalledWith("r-42");
  });
});
```

You'll need to add `import { within } from "@testing-library/react";` and `import { beforeEach } from "vitest";` to imports. Check the existing component test patterns for the exact import shape used by sibling files.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/ContestantPrimerCarousel.test.tsx 2>&1 | tail -15
```

Expected: 7 FAIL (module not found).

- [ ] **Step 3: Implement the component**

`src/components/room/ContestantPrimerCarousel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";
import { markSeen } from "@/lib/voting/emxHintsSeen";

interface PrimerCardCategory {
  name: string;
  hint?: string;
}

interface ContestantPrimerCarouselProps {
  contestants: Contestant[];
  categories: PrimerCardCategory[];
  roomId: string;
}

/**
 * SPEC §6.6.3 — horizontally scrollable card deck shown in the lobby.
 * Tap a card to flip and reveal category hints + an optional
 * "Preview on YouTube" deep-link. First flip writes the
 * `emx_hints_seen_{roomId}` localStorage flag.
 */
export default function ContestantPrimerCarousel({
  contestants,
  categories,
  roomId,
}: ContestantPrimerCarouselProps) {
  const t = useTranslations();

  if (contestants.length === 0) return null;

  const categoriesWithHints = categories.filter((c) => c.hint);

  return (
    <section
      data-testid="contestant-primer-carousel"
      className="space-y-3"
    >
      <header className="space-y-1">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          {t("lobby.primer.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("lobby.primer.tapHint")}
        </p>
      </header>
      <ol
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4"
        role="list"
      >
        {contestants.map((c) => (
          <li
            key={c.id}
            className="flex-none snap-start"
            style={{ minWidth: "200px", maxWidth: "240px" }}
          >
            <PrimerCard
              contestant={c}
              categoriesWithHints={categoriesWithHints}
              onFirstFlip={() => markSeen(roomId)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

interface PrimerCardProps {
  contestant: Contestant;
  categoriesWithHints: PrimerCardCategory[];
  onFirstFlip: () => void;
}

function PrimerCard({
  contestant,
  categoriesWithHints,
  onFirstFlip,
}: PrimerCardProps) {
  const t = useTranslations();
  const [flipped, setFlipped] = useState(false);

  const handleClick = () => {
    setFlipped((prev) => {
      if (!prev) onFirstFlip(); // front → back transition
      return !prev;
    });
  };

  return (
    <button
      type="button"
      className={`emx-flip-card ${flipped ? "is-flipped" : ""} block w-full aspect-[3/4]`}
      onClick={handleClick}
      data-testid={`primer-card-${contestant.id}`}
      data-flipped={flipped ? "true" : "false"}
      aria-pressed={flipped}
    >
      <div className="emx-flip-card__inner">
        {/* Front */}
        <div className="emx-flip-card__face emx-flip-card__front rounded-2xl border-2 border-border bg-card flex flex-col items-center text-center p-4 gap-2 justify-center">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            № {contestant.runningOrder}
          </span>
          <span
            className="text-6xl"
            role="img"
            aria-label={t("lobby.primer.flagAria", {
              country: contestant.country,
            })}
          >
            {contestant.flagEmoji}
          </span>
          <p className="text-lg font-bold leading-tight">{contestant.country}</p>
          <p className="text-sm font-medium">{contestant.artist}</p>
          <p className="text-xs italic text-muted-foreground">
            {contestant.song}
          </p>
        </div>

        {/* Back */}
        <div className="emx-flip-card__face emx-flip-card__back rounded-2xl border-2 border-border bg-card flex flex-col p-4 gap-2 overflow-y-auto">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl" aria-hidden>
              {contestant.flagEmoji}
            </span>
            <span className="text-sm font-semibold truncate">
              {contestant.country}
            </span>
          </div>
          <ul className="space-y-1 text-xs flex-1">
            {categoriesWithHints.map((c) => (
              <li key={c.name}>
                <span className="font-semibold">{c.name}:</span> {c.hint}
              </li>
            ))}
          </ul>
          {contestant.artistPreviewUrl ? (
            <a
              href={contestant.artistPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent underline mt-2"
              onClick={(e) => e.stopPropagation()}
            >
              {t("lobby.primer.previewSong")} ↗
            </a>
          ) : null}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test -- src/components/room/ContestantPrimerCarousel.test.tsx 2>&1 | tail -15
```

Expected: ALL 7 PASS.

- [ ] **Step 5: Type-check + lint**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run lint 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/room/ContestantPrimerCarousel.tsx src/components/room/ContestantPrimerCarousel.test.tsx
git commit -m "$(cat <<'EOF'
feat(lobby): ContestantPrimerCarousel component (R2 #240 / §6.6.3)

Horizontally scrollable card deck — one PrimerCard per contestant in
running order. Tap to flip via .emx-flip-card CSS 3D transform
(motion-safe gated). Front: flag/country/artist/song/running-order.
Back: category hints (skips entries without a hint) + optional
"Preview on YouTube" deep-link. First front→back flip calls
markSeen(roomId) to write the localStorage flag consumed by the
voting hint-collapse default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<LobbyView>` mount + page.tsx wiring + cleanup

**Files:**
- Modify: `src/components/room/LobbyView.tsx`
- Modify: `src/components/room/LobbyView.test.tsx`
- Modify: `src/app/room/[id]/page.tsx`
- Modify: `TODO.md` (tick lines 240 + 241 — local only, gitignored)

- [ ] **Step 1: Add `contestants` prop to `<LobbyView>`**

In `src/components/room/LobbyView.tsx`:

Add the `Contestant` import alongside existing imports:

```ts
import type { Contestant } from "@/types";
```

Add to `LobbyViewProps` interface:

```ts
/** SPEC §6.6.3 — surfaced via the contestant primer carousel.
 * Empty array suppresses the carousel section. */
contestants: Contestant[];
```

Destructure it in the function signature.

- [ ] **Step 2: Mount `<ContestantPrimerCarousel>`**

Add the import at the top:

```ts
import ContestantPrimerCarousel from "@/components/room/ContestantPrimerCarousel";
```

In the JSX, find the "Who's here" section. Insert a new section between "Who's here" and the existing categories preview section:

```tsx
<section className="space-y-3">
  <ContestantPrimerCarousel
    contestants={contestants}
    categories={categories}
    roomId={roomId}
  />
</section>
```

Note: `categories` and `roomId` are already props on `<LobbyView>`. The carousel returns `null` when contestants is empty, so this works gracefully during the brief loading window.

- [ ] **Step 3: Update LobbyView test fixtures**

In `src/components/room/LobbyView.test.tsx`:

Add to the `RenderOpts` interface:

```ts
contestants?: Contestant[];
```

Add to the imports:

```ts
import type { Contestant } from "@/types";
```

In `renderLobby` helper, default the new field and pass it through:

```ts
const ui = (
  <LobbyView
    // ...existing props...
    contestants={opts.contestants ?? []}
  />
);
```

Add a new test case at the bottom:

```ts
describe("<LobbyView> — primer carousel section (R2 #240)", () => {
  it("renders the contestant primer carousel when contestants array is non-empty", () => {
    const fixture: Contestant[] = [
      {
        id: "9999-se",
        country: "Sweden",
        countryCode: "se",
        flagEmoji: "🇸🇪",
        artist: "Felicia",
        song: "My System",
        runningOrder: 1,
        event: "final",
        year: 9999,
      },
    ];
    renderLobby({ contestants: fixture });
    expect(screen.getByTestId("contestant-primer-carousel")).toBeInTheDocument();
  });

  it("hides the carousel section when contestants array is empty", () => {
    renderLobby({ contestants: [] });
    expect(screen.queryByTestId("contestant-primer-carousel")).toBeNull();
  });
});
```

- [ ] **Step 4: Wire `contestants` through page.tsx**

In `src/app/room/[id]/page.tsx`, find the `<LobbyView>` JSX render. `phase.contestants` is already in scope from the room API fetch (R2 #238 path). Add the new prop:

```tsx
<LobbyView
  // ...existing props...
  contestants={phase.contestants}
/>
```

If the existing `phase.ready` shape doesn't have `contestants` yet, look at how the API response is destructured into the phase. The room API at `/api/rooms/{id}` already returns `contestants` (used elsewhere in the room page); just thread it.

- [ ] **Step 5: Run all tests**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm test 2>&1 | tail -5
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run type-check 2>&1 | tail -3
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing && npm run lint 2>&1 | tail -5
```

Expected: ALL PASS — including new LobbyView regression tests.

- [ ] **Step 6: Tick TODO.md**

Local only — TODO.md is gitignored.

Find line 240:

```markdown
- [ ] Contestant primer carousel — horizontally scrollable deck with optional `artistPreviewUrl` deep-link (§6.6.3)
```

Change to:

```markdown
- [x] Contestant primer carousel — horizontally scrollable deck with optional `artistPreviewUrl` deep-link (§6.6.3)  _(landed on `feat/r2-contestant-primer-carousel` — `<ContestantPrimerCarousel>` with `<PrimerCard>` sub-component, CSS 3D flip animation gated by `motion-safe:`, front shows flag/country/artist/song/running-order, back shows category hints + optional "Preview on YouTube" deep-link, first flip writes `emx_hints_seen_{roomId}` via `markSeen`. Closes the second half of TODO #241 — `Contestant.artistPreviewUrl?` shipped through `ApiContestant`/`isApiContestant`/`mapApiToContestant`. Spec: `docs/superpowers/specs/2026-05-12-r2-contestant-primer-carousel-design.md`. Plan: `docs/superpowers/plans/2026-05-12-r2-contestant-primer-carousel.md`.)_
```

Find line 241 (was `[~]` after R2 #238 partial):

```markdown
- [~] Extend `data/contestants/{year}/{event}.json` shape: add optional top-level `broadcastStartUtc` and optional `artistPreviewUrl` per contestant. Update `data/README.md`.  _(broadcastStartUtc half landed on ...)_
```

Change `[~]` to `[x]` and append a note:

```markdown
- [x] Extend `data/contestants/{year}/{event}.json` shape: add optional top-level `broadcastStartUtc` and optional `artistPreviewUrl` per contestant. Update `data/README.md`.  _(broadcastStartUtc half landed on `feat/r2-lobby-countdown` (PR #100); artistPreviewUrl half landed on `feat/r2-contestant-primer-carousel` — `Contestant.artistPreviewUrl?` flows through `ApiContestant`/`isApiContestant`/`mapApiToContestant`. Operator backfills production JSON values per TODO #242 when ready.)_
```

- [ ] **Step 7: Commit (everything except TODO.md)**

```bash
git add src/components/room/LobbyView.tsx src/components/room/LobbyView.test.tsx src/app/room/[id]/page.tsx
git commit -m "$(cat <<'EOF'
feat(lobby): mount ContestantPrimerCarousel in LobbyView (R2 #240)

LobbyView gains contestants: Contestant[] prop; the carousel section
sits between "Who's here" and the categories preview. page.tsx threads
phase.contestants through. Carousel returns null when contestants
array is empty (loading window) so LobbyView keeps working without it.

Closes the R2 lobby chrome trio: presence indicators (#239) +
countdown (#238) + primer carousel (#240). Also closes TODO #241
(JSON shape extension — both broadcastStartUtc and artistPreviewUrl
halves now shipped).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Pause for user push approval**

Push and PR are shared-state mutations. Stop here, summarise commits, and wait for explicit user approval before:

```bash
git push -u origin feat/r2-contestant-primer-carousel
gh pr create --title "feat(lobby): R2 #240 contestant primer carousel + artistPreviewUrl (§6.6.3)" --body ...
```

PR body template:

```
## Summary

- Horizontally scrollable card deck in the lobby — one card per contestant in running order. Tap a card to flip; back shows category hints (from the room template) + optional "Preview on YouTube" deep-link.
- CSS 3D transform with `backface-visibility: hidden`; `motion-safe:` gated so reduced-motion users get instant swap.
- First front→back flip writes `emx_hints_seen_{roomId}` via the existing `markSeen` helper — consumed by the voting hint-collapse default (§8.2).
- Adds optional `artistPreviewUrl?: string` to `Contestant` / `ApiContestant` / `mapApiToContestant`. Test fixture (year 9999) gains a preview URL on at least one entry per event so the carousel's conditional render is exercised.

UI-heavy slice. Closes the R2 lobby chrome trio (presence + countdown + primer) and the second half of TODO #241 (JSON shape extension).

## Closes

- ✅ [TODO.md:240](TODO.md#L240) — Contestant primer carousel.
- ✅ [TODO.md:241](TODO.md#L241) — JSON shape extension. Both halves now done (broadcastStartUtc shipped on PR #100; artistPreviewUrl shipped here).

## Test plan

- [ ] **Verify the carousel renders in dev**: `npm run dev`, create a room with the test fixture (year 9999), open the lobby. Carousel section visible between "Who's here" and the categories preview.
- [ ] **Tap a card → flips smoothly** (CSS animation). Back shows category hints from the room's template + the test "Preview on YouTube" link on cards with `artistPreviewUrl`.
- [ ] **Verify reduced-motion**: enable "Reduce Motion" in OS prefs. Card flip should be instant — no rotation animation.
- [ ] **Verify hints-seen flag**: open dev tools → Application → Local Storage. Flip any card. The key `emx_hints_seen_{roomId}` should be set to `"true"`.
- [ ] **Verify the production fallback**: create a room with year 2026 (no preview URLs in production JSON). Cards still render; "Preview on YouTube" link absent.
- [ ] CI: `npm test`, `npm run type-check`, `npm run lint`.
```

---

## Parallelization map

Strict order: 1 → 2 → 3 → 4 → 5.

- Task 1 (locale keys) is a chokepoint — Task 4's RTL asserts on `lobby.primer.*` keys.
- Task 2 (data layer) is independent of 1/3 in code but Task 4's tests reference `artistPreviewUrl` field on Contestant.
- Task 3 (CSS) is independent of others but Task 4's component references `.emx-flip-card` classes.
- Task 4 (component + RTL) needs 1, 2, 3.
- Task 5 (LobbyView mount + cleanup) needs 4.

Tasks 1 + 2 + 3 could parallelise in theory (different files, no shared state) but each is small enough that serial execution is faster than coordination overhead.

## Self-review checklist

- [ ] `lobby.primer.{title, tapHint, previewSong, flagAria}` keys in en.json + non-en stubs.
- [ ] `Contestant` type has `artistPreviewUrl?: string`.
- [ ] `isApiContestant` rejects non-string `artistPreviewUrl` when present; passes when absent or string.
- [ ] `mapApiToContestant` only sets the field when defined (so `undefined` doesn't pollute the domain object).
- [ ] Test fixture (year 9999) has at least one entry with `artistPreviewUrl` AND at least one without per event file.
- [ ] `.emx-flip-card`, `.emx-flip-card__inner`, `.emx-flip-card__face`, `.emx-flip-card__back`, `.is-flipped` classes added; `prefers-reduced-motion: reduce` cancels the transition.
- [ ] `<ContestantPrimerCarousel>` returns null when contestants is empty.
- [ ] `<PrimerCard>` calls `onFirstFlip()` only on front→back transitions (not back→front).
- [ ] "Preview on YouTube" link uses `target="_blank" rel="noopener noreferrer"` and `onClick={(e) => e.stopPropagation()}` to prevent flipping the card on link tap.
- [ ] `<LobbyView>` accepts `contestants: Contestant[]` prop; mount placed between "Who's here" and categories preview.
- [ ] `npm test` + `npm run type-check` + `npm run lint` all green.
- [ ] TODO.md line 240 ticked from `[ ]` to `[x]`; line 241 ticked from `[~]` to `[x]`.
