# Onboarding screen design — 2026-04-19

Phase 1 item from `TODO.md`: *"Onboarding screen at `/` (or dedicated route): name input (2–24 chars, hyphen/space only), live DiceBear preview (300ms debounce), regenerate-seed tap, 'Join' CTA."* Also satisfies Phase U items **L5** and **L6** (avatar carousel replaces keystroke-driven regeneration once opened).

Authoritative references: `SPEC.md` §4.1 (onboarding), §4.2 (session schema), §21.3 (locale — out of scope here), and `CLAUDE.md` §3.1–3.2.

---

## 1. Goal

A single interactive screen that turns a brand-new visitor into an onboarded user: they pick a display name, pick an avatar, and we persist an `emx_session` in localStorage + create the matching row in `users` via `POST /api/auth/onboard`.

## 2. Route placement

- New client route at **`/onboard`** (`src/app/onboard/page.tsx`).
- Marketing landing at `/` is untouched.
- Query param `?next=<path>` carries the intended destination (e.g. `/create`, `/join`, `/room/{id}`). Sanitized — see §8.
- On mount, if a non-expired `emx_session` exists in localStorage, the page immediately `router.replace(sanitizedNext)` so an already-onboarded user never sees the form.
- `/create`, `/join`, and `/room/[id]` wiring to redirect unauthenticated visitors here is **Phase 2** work, out of scope for this spec.

## 3. File layout

| File | Purpose |
|---|---|
| `src/app/onboard/page.tsx` | Thin client-route wrapper. Reads `next` param, handles the "already onboarded" redirect, renders the form. |
| `src/components/onboarding/OnboardingForm.tsx` | Main interactive piece: name input, avatar preview, carousel trigger, submit. Holds the state machine in §5. |
| `src/components/onboarding/AvatarCarousel.tsx` | Horizontal picker of 4–6 candidate seeds. `role="radiogroup"` with a "Shuffle" control to regenerate the randoms. |
| `src/lib/onboarding/seeds.ts` | `generateCarouselSeeds(currentSeed, rng, count = 6)` — pure. First slot = `currentSeed`, remaining slots = unique random nanoid-style strings. MVP fixes `count = 6`; signature keeps a `count` param (validated in `[4, 6]` per SPEC §4.1) as a future tuning lever. |
| `src/lib/onboarding/safeNext.ts` | `sanitizeNextPath(raw: unknown): string` — pure. Only accepts same-origin paths. See §8. |
| `src/lib/hooks/useDebouncedValue.ts` | Generic `useDebouncedValue<T>(value, delayMs)` hook; used at 300ms for the name preview. |

No new dependencies required (bcryptjs, uuid, supabase client are already present; the nanoid-ish seed string is a short `Math.random().toString(36).slice(2, 8)` — we don't need the `nanoid` package for this).

## 4. User-visible behavior (mapped to SPEC §4.1)

1. Empty state: name input empty, big avatar shows a stable default seed (`"emx-default"`). Carousel not visible.
2. As the user types, a debounced (300ms) name update seeds the preview avatar (`previewSeed = normalizedName || "emx-default"`).
3. The user can **tap the big avatar** *or* tap a **"Shuffle"** button. Either opens the carousel:
   - The carousel slides in below the preview with 6 tiles: the current effective seed in slot 0, then 5 fresh randoms.
   - The tile matching the current effective seed is pre-selected.
4. Tapping a tile updates the selection; the big preview updates immediately to the chosen seed.
5. Tapping **Shuffle again** regenerates slots 1–5 with fresh randoms (slot 0 stays the current effective seed so the current pick is never lost mid-shuffle).
6. **Once the carousel has been opened at least once, keystrokes no longer retrigger avatar regeneration** — this is the SPEC-mandated anti-flash behavior.
7. Submit is enabled only when the normalized name matches `/^[A-Za-z0-9 \-]{2,24}$/`. Tap "Join" → POST, persist session, redirect.

## 5. State machine

```
name            : string      // raw input (preserve user's spacing until submit)
debouncedName   : string      // name, debounced 300ms
previewSeed     : string      // driven by debouncedName while !carouselOpen
carouselOpen    : boolean     // latches true on first open
carouselSeeds   : string[]    // [effectiveSeed-at-open, ...5 randoms]
selectedSeed    : string|null // carousel pick; null => fall through to previewSeed

effectiveSeed = selectedSeed ?? previewSeed
```

### Transitions

| Trigger | Effect |
|---|---|
| `name` changes | After 300ms debounce: if `!carouselOpen`, `previewSeed = normalize(name) || "emx-default"`. Otherwise no-op on previewSeed. |
| Tap big avatar OR tap "Shuffle" (first time) | `carouselOpen = true`; `carouselSeeds = [effectiveSeed, ...5 randoms]`; `selectedSeed = effectiveSeed`. |
| Tap "Shuffle" (already open) | Re-roll slots 1..5; slot 0 stays at current `effectiveSeed`; `selectedSeed` unchanged. |
| Tap a tile | `selectedSeed = tile.seed`. |
| Submit success | `setSession(...)`, `router.push(sanitizedNext)`. |

### Name normalization

```
normalize(raw) = raw.trim().replace(/\s+/g, " ")
```

Identical to the server-side rule in `src/lib/auth/onboard.ts`. Submitted value is the normalized form.

## 6. Submission

Request:

```
POST /api/auth/onboard
Content-Type: application/json

{
  "displayName": "<normalized>",
  "avatarSeed": "<effectiveSeed>"
}
```

On `201`:

```ts
setSession({
  userId:      res.userId,
  rejoinToken: res.rejoinToken,
  displayName: res.displayName,
  avatarSeed:  res.avatarSeed,
  expiresAt:   createExpiryDate(),     // 90 days per src/lib/session.ts
});
router.push(sanitizedNext);
```

`LocalSession.locale` is **not** populated here — the field is not yet in the `LocalSession` interface (`src/types/index.ts`). That wiring belongs to Phase L0 (§21.5) and is out of scope.

## 7. Error handling

| Condition | UI behavior |
|---|---|
| Network / fetch throws | Inline error banner: *"Couldn't create your identity. Try again."* Form state preserved; Join re-enabled. |
| `400 INVALID_DISPLAY_NAME` | Field error under name input referencing the server message; Join stays disabled until user edits. |
| `400 INVALID_AVATAR_SEED` | Treat as a coding bug — generic error + console.error. Should not happen given client validation. |
| `400 INVALID_BODY` | Same generic error — indicates malformed request; shouldn't happen. |
| `500 INTERNAL_ERROR` | Generic retry message. |

Error copy is inlined for now; once Phase L1 migrates to `t('errors.' + code)`, strings move to `en.json`. No pre-emptive i18n plumbing in this spec.

## 8. `sanitizeNextPath` contract

Accept iff all of:

- Input is a string.
- Length ≤ 512.
- Starts with exactly one `/` (`raw[0] === '/' && raw[1] !== '/'`).
- Does not start with `/\` (Windows-style protocol-relative edge case).
- Does not contain control chars (`/[\x00-\x1F]/`).
- No `javascript:`, `data:` etc. — already excluded by the "starts with `/`" rule but we assert explicitly in the test.

Reject fallback → `"/"`.

Rationale: closes the open-redirect footgun. A future e2e test can and will throw random strings at it.

## 9. Validation mirror

Client regex = server regex exactly:

```
/^[A-Za-z0-9 \-]{2,24}$/   applied to normalize(name)
```

If server-side regex is ever relaxed, this code must move. That's a single-source-of-truth concern — noted here so a future reader treats the constant as a copy, not an independent invariant. Export the regex from `src/lib/auth/onboard.ts` (currently a local `const`) so both sides import the same symbol.

## 10. Styling

- Tailwind tokens only (`bg-background`, `bg-primary`, `text-foreground`, `text-accent`, `text-muted-foreground`, `border-border`, `gold`, `hot-pink`, `navy`). No hex literals. If a new shade is needed, add to `globals.css` + `tailwind.config.ts` first.
- Dark-mode default; verify under light too.
- Mobile-first. Big preview 128×128 (`h-32 w-32`). Carousel tiles 72×72 with minimum tap target ≥ 44×44 CSS px.
- Use existing animation utilities: `animate-fade-in` on mount, `animate-score-pop` on tile selection. §3.3 `prefers-reduced-motion` gating is a cross-cutting Phase U concern — we use the existing classes, not invent new ones.

## 11. Accessibility

- `<label htmlFor="displayName">` explicitly tied to input.
- Name input: `inputMode="text"`, `autoComplete="off"`, `autoCapitalize="words"`, `spellCheck={false}`, `maxLength={24}`.
- Avatar carousel: `role="radiogroup"` with `aria-labelledby` pointing at a visually-hidden heading ("Choose your avatar"). Each tile `role="radio"` with `aria-checked`.
- Shuffle button has `aria-label="Shuffle avatars"`.
- Inline errors use `aria-live="polite"` and are referenced by `aria-describedby` on the relevant input.
- Keyboard: tiles navigable via arrow keys (standard radiogroup behavior); Enter/Space to select.

## 12. Testing strategy

The project currently has **no DOM test harness** (vitest only runs pure-logic tests). Rather than pull in `@testing-library/react` + `jsdom` for one screen, we split coverage:

**TDD'd as pure modules:**

- `src/lib/onboarding/seeds.test.ts` — deterministic via injected RNG; first slot equals current seed; no duplicates within the result; count is in `[4, 6]`; all-random variant produces distinct sequences for distinct RNG states.
- `src/lib/onboarding/safeNext.test.ts` — table of accept/reject cases: `/create`, `/room/abc`, `/`, `/create?x=1`, `/foo#bar` → accepted. `null`, `undefined`, `""`, `//evil.com`, `/\\evil.com`, `https://evil.com`, `javascript:alert(1)`, `"/"+"\x00"`, 513-char string → rejected.

**Manual browser verification** via `npm run dev` before marking the TODO item done:

1. Load `/onboard`. Empty name → default avatar visible, Join disabled.
2. Type "Alice" → after ~300ms avatar updates once; avatar stays put during further typing bursts.
3. Tap the avatar → carousel opens with 6 tiles, first is current.
4. Select tile 3 → big preview updates; carousel reflects selection.
5. Type more characters → preview does NOT change (carousel has been opened).
6. Hit Shuffle again → tiles 2–6 change, tile 1 (current) is stable.
7. Submit with "A" (1 char) → Join disabled.
8. Submit with valid name → redirects to `/` (no `?next=`); localStorage has `emx_session` with matching fields.
9. Reload `/onboard?next=/create` → redirects to `/create` without showing the form.
10. Visit `/onboard?next=//evil.com` → redirects to `/` (open-redirect closed).
11. Simulate server error (temporarily flip env to break DB) → error banner appears, state retained, retry works.

**Deferred**: adding `@testing-library/react` + `jsdom` is worth doing before Phase 3 voting UI. It's a small but real change (new devDep, vitest config update, test setup file) and should get its own spec + plan. Not blocking this screen.

## 13. Out of scope (explicit non-goals)

- **Same-name resolver** (SPEC §4.3) — separate Phase 1 TODO.
- **Session expiry refresh on every successful API call** — separate Phase 1 TODO (needs a fetch wrapper).
- **`locale` field on `LocalSession`** — Phase L0.
- **`/create`, `/join`, `/room/[id]` redirect wiring** — Phase 2.
- **i18n of error copy** — Phase L1.

## 14. Definition of done for this slice

- `/onboard` route exists, renders the form, redirects already-onboarded users.
- Debounced typed-name preview works; regeneration stops after first carousel open.
- Carousel shuffles, first tile is always the current effective seed, user can pick any tile.
- Client-side name validation mirrors server regex exactly (both imported from `src/lib/auth/onboard.ts`).
- `?next=` is sanitized; open-redirect attempts land on `/`.
- On successful POST `/api/auth/onboard`, `emx_session` is persisted and the user is routed to the sanitized next path.
- `seeds.ts` and `safeNext.ts` have unit tests covering the cases in §12.
- `npm run type-check` is clean.
- Manual browser verification (§12) has been walked top to bottom.
