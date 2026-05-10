# R2 #240 Contestant primer carousel — design

**Date:** 2026-05-12
**TODO ref:** [TODO.md:240](../../../TODO.md#L240) (carousel) + [TODO.md:241](../../../TODO.md#L241) (artistPreviewUrl half — closes that line)
**SPEC ref:** §6.6.3 (Contestant primer carousel)
**Slice:** R2 lobby surfaces — third and final slice. Closes the lobby chrome trio: presence indicators (R2 #239 ✅), countdown (R2 #238 ✅), primer carousel (this slice). Builds on `parseContestantsJson` from R2 #238 which already supports the wrapper-shape JSON.

## Problem

The lobby gives early-arriving guests a presence indicator, a countdown, and a categories preview — but nothing about the contestants themselves. SPEC §6.6.3 prescribes a horizontally scrollable card deck showing every contestant in running order. Tapping a card flips it to reveal category hints (from the room's selected template) plus an optional "Preview on YouTube" external link.

The carousel also feeds the §8.2 voting hint-collapse default: the first time the user flips any primer card, the client writes `localStorage.emx_hints_seen_{roomId} = true`. The voting card consumes this flag — users who pre-read in the lobby never see hints expanded again on the voting card.

## Goals

- **Horizontally scrollable card deck** in the lobby. Every contestant in running order, one card each.
- **Card front:** flag · running order · country · artist · song.
- **Card back** (after tap): category hints (per room template) + "Preview on YouTube" external link if `artistPreviewUrl` exists.
- **CSS 3D flip animation** with `motion-safe:` gating — reduced-motion users get instant swap, full motion gets the flip.
- **Hints-seen flag write** on first front→back flip via existing `markSeen(roomId)` helper.
- **`artistPreviewUrl` field plumbed through** `Contestant` type, `ApiContestant`, type guard, mapper. Optional everywhere; legacy JSON keeps working.
- **Closes [TODO.md:241](../../../TODO.md#L241)** — the second half of the JSON shape extension (`artistPreviewUrl` per contestant).

## Non-goals

- Operator backfill of `artistPreviewUrl` in production JSON files. Operator action; this slice ships the code path. Test fixture gets a few preview URLs to exercise the conditional.
- Spotify embed / inline audio / autoplay — spec says external link only, no embed.
- Per-card "seen" state (which cards has the user flipped). The hints-seen flag is a single boolean on the room.
- Desktop scroll arrows. Touch-swipe + browser scrollbar is fine for MVP.
- Card-front stagger animation on mount. Pure render.
- Auto-flipping the first card to teach the affordance. The `tapHint` copy text on the first card is the affordance.

## Architecture

Three coordinated additions:

### (a) Data layer — `artistPreviewUrl` per contestant

[src/types/index.ts](../../../src/types/index.ts) — add to `Contestant`:

```ts
export interface Contestant {
  // ...existing fields...
  artistPreviewUrl?: string;
}
```

[src/lib/contestants.ts](../../../src/lib/contestants.ts):

- Extend `ApiContestant` interface with optional `artistPreviewUrl?: string` (or accept the index signature already present and just pass through).
- Extend `isApiContestant` to accept (but not require) the field. Reject only if the field is *present* and non-string.
- Extend `mapApiToContestant` to pass `artistPreviewUrl` through to the domain `Contestant` (only when defined; preserve `undefined` otherwise so consumers can rely on `if (artistPreviewUrl)` checks).

### (b) `<ContestantPrimerCarousel>` component

New component at `src/components/room/ContestantPrimerCarousel.tsx`. Two responsibilities:

1. Render the horizontally scrollable container.
2. Render one `<PrimerCard>` per contestant.

`<PrimerCard>` is an inner component (or a separate file if it grows) handling the flip state + click handler.

Container layout:

```tsx
<section data-testid="contestant-primer-carousel">
  <header>
    <h2>{t("lobby.primer.title")}</h2>
    <p>{t("lobby.primer.tapHint")}</p> {/* visible only above the first card or as a section subtitle */}
  </header>
  <ol className="flex gap-4 overflow-x-auto snap-x snap-mandatory">
    {contestants.map((c, i) => (
      <PrimerCard
        key={c.id}
        contestant={c}
        categories={categories}
        onFirstFlip={() => markSeen(roomId)}
      />
    ))}
  </ol>
</section>
```

Container CSS:
- `overflow-x-auto`, `scroll-snap-type: x mandatory` (Tailwind `snap-x snap-mandatory`).
- `gap-4` between cards.
- `pb-4` so the scrollbar sits below cards.

Card CSS (per card):
- `min-w-[200px] max-w-[240px]` (responsive — adjust as needed).
- `aspect-[3/4]` (portrait orientation).
- `scroll-snap-align: start`.

### (c) Card flip mechanic

Each `<PrimerCard>` owns local `flipped: boolean` state. Click on the card root toggles it. CSS 3D transform + `backface-visibility: hidden`:

```tsx
<button
  type="button"
  className={`emx-flip-card ${flipped ? "is-flipped" : ""}`}
  onClick={handleClick}
  data-testid={`primer-card-${contestant.id}`}
  data-flipped={flipped ? "true" : "false"}
  aria-pressed={flipped}
>
  <div className="emx-flip-card__inner">
    <div className="emx-flip-card__face emx-flip-card__front">
      {/* front content */}
    </div>
    <div className="emx-flip-card__face emx-flip-card__back">
      {/* back content */}
    </div>
  </div>
</button>
```

`handleClick`:
1. Determine new `flipped` value (`!flipped`).
2. If transitioning front→back AND `onFirstFlip` is provided, call it. (The carousel passes `markSeen(roomId)` — idempotent, so calling it on every front→back flip is fine. Could gate to first-time only, but the cost-benefit isn't worth the extra state.)
3. Set state.

CSS utilities (added to [src/app/globals.css](../../../src/app/globals.css)):

```css
.emx-flip-card {
  perspective: 1000px;
  background: transparent;
  border: 0;
  cursor: pointer;
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

### (d) Card content

**Front:**

```tsx
<div className="emx-flip-card__face emx-flip-card__front">
  <div className="flex flex-col items-center text-center p-4 gap-2 h-full justify-center">
    <span className="text-xs uppercase tracking-widest text-muted-foreground">
      № {contestant.runningOrder}
    </span>
    <span
      className="text-6xl"
      role="img"
      aria-label={t("lobby.primer.flagAria", { country: contestant.country })}
    >
      {contestant.flagEmoji}
    </span>
    <p className="text-lg font-bold leading-tight">{contestant.country}</p>
    <p className="text-sm font-medium">{contestant.artist}</p>
    <p className="text-xs italic text-muted-foreground">{contestant.song}</p>
  </div>
</div>
```

**Back:**

```tsx
<div className="emx-flip-card__face emx-flip-card__back">
  <div className="flex flex-col p-4 gap-2 h-full overflow-y-auto">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-2xl" aria-hidden>{contestant.flagEmoji}</span>
      <span className="text-sm font-semibold truncate">{contestant.country}</span>
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
```

`categoriesWithHints` is `categories.filter((c) => c.hint)` — drops any category without a hint to avoid empty list rows.

The `e.stopPropagation()` on the preview link prevents the parent `<button>`'s click handler from also firing (which would flip the card back).

### (e) `<LobbyView>` integration

[src/components/room/LobbyView.tsx](../../../src/components/room/LobbyView.tsx) — mount the carousel between the existing "Who's here" roster section and the categories preview section.

The carousel needs three things from `LobbyView`:
- `contestants: Contestant[]` (NEW prop — `LobbyView` doesn't currently get contestants).
- `categories: LobbyCategory[]` (already a prop).
- `roomId: string` (already a prop from R2 #239).

Add `contestants: Contestant[]` to `LobbyViewProps`. `page.tsx` already has the contestant list in `phase.contestants` — pass it through.

```tsx
<section className="space-y-3">
  <ContestantPrimerCarousel
    contestants={contestants}
    categories={categories}
    roomId={roomId}
  />
</section>
```

If `contestants.length === 0` (e.g., during the brief loading window or contestant-fetch error), the carousel renders nothing — let `LobbyView` keep working without it.

### (f) Locale keys

[src/locales/en.json](../../../src/locales/en.json) — under existing `lobby.*`:

```json
"lobby": {
  ...,
  "primer": {
    "title": "Tonight's lineup",
    "tapHint": "Tap any card to see category hints",
    "previewSong": "Preview on YouTube",
    "flagAria": "{country} flag"
  }
}
```

Non-en stubs (es/uk/fr/de) per existing parity convention.

## Components

### 1. `<ContestantPrimerCarousel>` props

```ts
interface ContestantPrimerCarouselProps {
  contestants: Contestant[];
  categories: { name: string; hint?: string }[];
  roomId: string;
}
```

Renders nothing when `contestants.length === 0`.

### 2. `<PrimerCard>` (inner) props

```ts
interface PrimerCardProps {
  contestant: Contestant;
  categories: { name: string; hint?: string }[];
  /** Called when the user flips the card from front → back.
   * Idempotent — safe to call on every front→back transition. */
  onFirstFlip: () => void;
}
```

Owns local `flipped` state.

### 3. CSS utilities

`src/app/globals.css` gains the `.emx-flip-card*` block (per §Architecture (c) above). Reduced-motion gated.

## Tests

### Unit

- **`contestants.test.ts` extension** (~3 cases):
  1. JSON with `artistPreviewUrl` parses correctly; field surfaces on the domain `Contestant`.
  2. JSON without `artistPreviewUrl` parses correctly; field is `undefined` on the domain.
  3. JSON with non-string `artistPreviewUrl` (e.g., number) is rejected by `isApiContestant`.

### RTL — `<ContestantPrimerCarousel>` (~6 cases)

```tsx
// @vitest-environment jsdom
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, p?: any) =>
    p ? `${k}:${JSON.stringify(p)}` : k,
}));
vi.mock("@/lib/voting/emxHintsSeen", () => ({
  markSeen: vi.fn(),
}));

it("renders one card per contestant in running order", ...);
it("front shows flag, country, artist, song, running order", ...);
it("tapping a card flips it (data-flipped=true)", ...);
it("back shows category hints from the categories prop", ...);
it("renders 'Preview on YouTube' link only when artistPreviewUrl is set", ...);
it("calls markSeen(roomId) on first front→back flip", ...);
```

### RTL — `<LobbyView>` regression

1 case asserting the carousel renders within `<LobbyView>` when `contestants` is non-empty.

### No new orchestrator tests, no Playwright

UI-only slice; pure render + click behaviour fully captured by RTL.

## Slice plan (one PR, ~5 tasks)

1. Locale keys (`lobby.primer.*` + non-en stubs).
2. `Contestant` / `ApiContestant` / `mapApiToContestant` extension + tests + test fixture migration to add a couple of `artistPreviewUrl` values for dev smoke.
3. CSS utilities in `globals.css` (the `.emx-flip-card*` block).
4. `<ContestantPrimerCarousel>` + `<PrimerCard>` + RTL.
5. `<LobbyView>` mount + regression test + final cleanup.

UI-heavy slice. ~full day.

## Risks

- **Card-flip animation jank on low-end devices.** Mitigated by GPU-accelerated CSS transform + `motion-safe:` reduced-motion gate. Acceptable for MVP.
- **Long category names overflow the back of the card.** Cards are constrained to ~240 px wide; long category names wrap. The `overflow-y-auto` on the back face lets users scroll within the card if hint text is very long. If it becomes a real problem, truncate with `line-clamp` in a follow-up.
- **`artistPreviewUrl` linking to broken YouTube videos.** Out of our control — we just deep-link to whatever the JSON says. Operator responsibility to verify the URL works. If a card's link is dead, the user gets a YouTube 404 page; not our problem.
- **`stopPropagation()` on the preview link.** Without it, clicking the link would also flip the card back. Verified pattern but worth a manual check during smoke.
- **`markSeen` running on every flip.** Idempotent (`localStorage.setItem` is a no-op when the value is unchanged). Tiny perf cost; KISS over micro-optimizing the "is this the first time?" check.
- **Layout shift when the carousel mounts.** The carousel takes ~250 px vertical space; needs to be reserved before contestants load to avoid CLS. Mitigated by the wrapper section having a fixed `min-height` matching the card aspect ratio. If in practice the layout still jumps, add a skeleton placeholder during the loading window.
