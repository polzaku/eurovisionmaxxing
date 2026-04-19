# i18n Phase A — infrastructure + existing-string extraction — 2026-04-19

Implementation slice of `SPEC.md` §21 (Localization). Phase A ships the i18n plumbing (`next-intl@^3`), extracts every currently-hardcoded user-facing string into `en.json`, and refactors auth API errors to the stable-`code` shape. **No non-English copy ships in Phase A** and **no language switcher UI ships in Phase A**.

Authoritative parent: `SPEC.md` §21 (file layout §21.3, detection §21.4, stable category/award keys §21.6, API conventions §21.7, schema §21.8, testing §21.9). Where this doc and SPEC §21 disagree, SPEC §21 wins — open a follow-up to align this doc.

---

## 1. Goal

Establish the i18n convention as load-bearing infrastructure **before** the voting / scoring / announcement / awards / results screens are built, so every future PR uses `t()` from day one. Ship a complete `en.json` for the screens that already exist (onboarding flow, landing page, auth API errors, voting templates), so the convention has real call sites that future contributors will see and pattern-match against.

Non-goals (deferred to Phase B+):
- Language switcher UI component
- Population of `es.json` / `uk.json` / `fr.json` / `de.json` (per Q1 → infra-only)
- `users.preferred_locale` DB column (per Q4a — no writer until switcher lands)
- `getLocaleForUser(userId)` server helper (per SPEC §21.3 — no caller until present screen is implemented)
- Date / relative-time / number formatting helpers (no call sites yet)
- Ukrainian plural smoke test (no count-sensitive strings exist yet)

## 2. File layout

| File | Purpose |
|---|---|
| `src/i18n/config.ts` | Exports `SUPPORTED_LOCALES = ['en', 'es', 'uk', 'fr', 'de'] as const`, `DEFAULT_LOCALE = 'en'`, `LOCALE_COOKIE = 'NEXT_LOCALE'`, `LOCALE_STORAGE_KEY = 'emx_locale'`, type `SupportedLocale`. |
| `src/i18n/request.ts` | `next-intl` `getRequestConfig` — reads `NEXT_LOCALE` cookie via `next/headers`, validates against `SUPPORTED_LOCALES`, falls back to `DEFAULT_LOCALE`, dynamic-imports `src/locales/{locale}.json`. |
| `src/i18n/provider.tsx` | Client `<IntlProvider>` wrapper. On mount, mirrors `NEXT_LOCALE` cookie → `localStorage[emx_locale]`. Re-renders children on locale change (Phase B). |
| `src/locales/en.json` | All ~69 keys populated (see §4). |
| `src/locales/{es,uk,fr,de}.json` | `{}` — empty stubs. Present so future PRs have a target file; locale-parity test in §6 skips empty files. |
| `src/locales/locales.test.ts` | Per SPEC §21.9 — see §6. |
| `src/lib/api/errors.ts` | `apiError(code, opts?)` helper returning `Response` with `{ error: { code, message?, params? } }`. |
| `src/lib/api/errors.test.ts` | Unit tests for `apiError`. |
| `middleware.ts` (root) | On request: if `NEXT_LOCALE` cookie absent, parse `Accept-Language`, pick best supported subtag, write cookie. Idempotent — does nothing if cookie already valid. |
| `middleware.test.ts` (root, alongside file) | Unit tests for the cookie-setting behavior. |

**Modified files** (extraction only — see §4):
- `src/app/page.tsx` — landing copy
- `src/app/layout.tsx` — `<title>` and `<meta description>` (Next.js metadata API)
- `src/app/onboard/page.tsx` — page metadata
- `src/components/onboarding/OnboardingForm.tsx`
- `src/components/onboarding/AvatarCarousel.tsx`
- `src/lib/templates.ts` — gains stable `key` / `nameKey` / `hintKey` per SPEC §21.6
- `src/lib/auth/onboard.ts` and `src/app/api/auth/onboard/route.ts` — refactor to `apiError`
- `src/lib/auth/rejoin.ts` and `src/app/api/auth/rejoin/route.ts` — refactor to `apiError`

## 3. Locale resolution flow

1. **First visit (no cookie).** Root `middleware.ts` reads `Accept-Language`, calls a small `pickLocale(header, SUPPORTED_LOCALES)` helper that walks the prioritized language list, matches by primary subtag (`es-AR` → `es`), falls back to `en`. Writes `NEXT_LOCALE` cookie (1-year expiry, `SameSite=Lax`, `Path=/`).
2. **Server render.** `getRequestConfig` in `src/i18n/request.ts` reads the cookie via `cookies()` from `next/headers`, dynamic-imports the matching JSON, returns `{ locale, messages }` to `next-intl`. Server components render the right text on the very first paint — no flash.
3. **Client hydration.** `<IntlProvider>` mounts and writes the resolved locale to `localStorage[emx_locale]`. localStorage becomes the canonical client store per SPEC §21.4.
4. **Future locale change** (Phase B switcher). One write site updates both `localStorage[emx_locale]` and `NEXT_LOCALE` cookie atomically, then router-refreshes.

**Why cookie + localStorage (and not localStorage alone):** App Router renders server-side first; localStorage is unavailable on the server. Cookie gives the server a readable source of truth so the first paint is always in the user's locale. localStorage remains canonical client-side per SPEC §21.4 — the cookie is a server-side mirror, not a duplicate state machine.

## 4. Namespace and key map

Per SPEC §21.3 namespaces: `common`, `onboarding`, `voting`, `templates`, `categories`, `awards`, `countries`, `errors`, `present`. Phase A populates **5 of 9**; the others stay reserved (their JSON sub-objects don't exist yet — they'll be added when their feature lands).

### `common` (~7 keys)

```
common.app.name           "eurovisionmaxxing"
common.app.tagline        "The group-chat way to watch Eurovision"
common.app.description    "Turn the contest into your own voting game…"
common.app.metaDescription "Eurovision watch party voting app — vote, announce, crown the winner."
common.cta.startRoom      "Start a room"
common.cta.joinRoom       "Join a room"
common.tagline.feature    "Vote live · Any device · Jury-style reveal"
```

### `onboarding` (~12 keys)

```
onboarding.metaTitle           "Join — eurovisionmaxxing"
onboarding.displayName.label   "Your display name"
onboarding.displayName.placeholder "e.g. Alice"
onboarding.displayName.hint    "Use 2–24 letters, numbers, spaces, or hyphens."
onboarding.avatar.title        "Choose your avatar"
onboarding.avatar.tapHint      "Tap your avatar to change it."
onboarding.avatar.shuffleAria  "Shuffle avatars"
onboarding.avatar.shuffleLabel "Shuffle"
onboarding.avatar.changeAria   "Change avatar"
onboarding.submit.idle         "Join"
onboarding.submit.busy         "Joining…"
onboarding.submit.error        "Couldn't create your identity. Try again."
```

### `templates` (8 keys)

```
templates.classic.name         "The Classic"
templates.classic.description  "For fans who want to be fair and thorough"
templates.spectacle.name       "The Spectacle"
templates.spectacle.description "For when you want to reward the unhinged"
templates.bangerTest.name      "The Banger Test"
templates.bangerTest.description "For when the group wants to find the actual best song"
templates.custom.name          "Custom"
templates.custom.description   "Build your own categories from scratch"
```

Stable `key` values: `classic`, `spectacle`, `bangerTest`, `custom`. The `templates.ts` data file gains `key`, `nameKey`, `hintKey` per SPEC §21.6 — see §5 below.

### `categories` (30 keys — final list confirmed during extraction)

15 distinct categories across the 3 predefined templates × `{name, hint}`. Naming convention: `categories.{slug}.name`, `categories.{slug}.hint`. Slugs are lowercase-snake versions of the existing English `name` values from `src/lib/templates.ts` (e.g. `vocals`, `drama`, `catchiness`, `vibes`, `quotability`, `originality`). The implementation plan locks the exact slug list by reading `templates.ts` — they are not enumerated here because the file is the source of truth and re-stating them risks divergence.

### `errors` (12 keys — auth API only)

ICU placeholders shown in `{braces}`.

```
errors.body_invalid_onboard       "Request body must include displayName and avatarSeed strings."
errors.display_name_invalid       "displayName must be 2–24 characters and contain only letters, numbers, spaces, or hyphens."
errors.avatar_seed_too_long       "avatarSeed must be 1–{limit} characters."
errors.onboard_failed             "Could not create user. Please try again."
errors.body_invalid_rejoin        "Request body must include userId and rejoinToken strings."
errors.rejoin_token_too_long      "rejoinToken must be at most {limit} characters."
errors.room_id_invalid            "roomId must be a string when present."
errors.user_id_invalid            "userId must be a UUID v4."
errors.rejoin_failed_verify       "Could not verify session. Please try again."
errors.no_user                    "No user matches this session."
errors.token_mismatch             "Session token does not match."
errors.rejoin_failed_refresh      "Could not refresh session. Please try again."
```

## 5. `templates.ts` enrichment (per SPEC §21.6)

Each template entry gains `key`. Each category entry gains `key`, `nameKey`, `hintKey`. `name` and `hint` are retained as English fallbacks — required by SPEC §21.6 for older clients and stable vote-key resolution.

```ts
// Before
{ name: "Vocals", hint: "Pitch, control, range." }

// After
{
  key: "vocals",
  nameKey: "categories.vocals.name",
  hintKey: "categories.vocals.hint",
  name: "Vocals",       // English fallback per SPEC §21.6
  hint: "Pitch, control, range.",
  weight: <existing weight>,
}
```

**Vote-key resolution stays as SPEC §21.6 prescribes:** `votes.scores` is keyed by `category.key ?? category.name`. Since predefined categories now carry `key`, their vote keys become the stable slug (`vocals`) regardless of what locale the voter sees. Custom categories continue to key by typed `name`. **No vote data migration required** — old rooms have no `key` field and continue to key by `name` (English), which is unchanged.

## 6. Testing

### `src/locales/locales.test.ts`

```
For each locale L in SUPPORTED_LOCALES \ {DEFAULT_LOCALE}:
  Load src/locales/{L}.json
  If keys(L) is empty: skip (treated as not-yet-translated)
  Else: assert keys(L) ⊇ keys(en) — fail listing missing keys
```

Phase A: every non-en file is empty, so the test runs but skips all of them. As soon as a locale gains its first key in Phase B+, the test starts enforcing parity for that locale automatically.

### `src/lib/api/errors.test.ts`

- `apiError('display_name_invalid')` returns `Response` with status 400 (default), JSON body `{ error: { code: 'display_name_invalid' } }`.
- `apiError('avatar_seed_too_long', { params: { limit: 64 } })` includes `params.limit` in the body.
- `apiError('onboard_failed', { status: 500 })` overrides status.
- A backward-compat `message` field is included when the route opts into it (used during gradual client migration; not relied on by the new client code).

### `middleware.test.ts`

- `Accept-Language: es-AR,es;q=0.9,en;q=0.5` → cookie `NEXT_LOCALE=es`.
- `Accept-Language: pt-BR,en;q=0.5` → cookie `NEXT_LOCALE=en` (pt unsupported, en is the next match).
- `Accept-Language: zh-CN` → cookie `NEXT_LOCALE=en` (default fallback).
- Existing `NEXT_LOCALE=fr` cookie present → middleware does nothing.
- Invalid existing `NEXT_LOCALE=xyz` cookie → middleware overwrites with detected/default.

### One render smoke test (JSDOM)

Mount a tiny client component using `useTranslations('onboarding')` inside the provider; assert it renders `"Join"` for the `en` locale.

## 7. Acceptance criteria

1. `pnpm dev` renders all currently-implemented pages identically to today for an `en` user (visual parity).
2. Setting cookie `NEXT_LOCALE=es` then reloading any page leaves the page rendered in English (every key falls back to `en` because `es.json` is empty) — proves the cookie path works without surfacing untranslated content.
3. `POST /api/auth/onboard` with an invalid display name returns HTTP 400 with body `{ error: { code: "display_name_invalid", message: "<English fallback>" } }`.
4. `POST /api/auth/rejoin` errors follow the same shape with the codes listed in §4 `errors`.
5. `OnboardingForm` renders error toast text via `t('errors.' + code)` (English in Phase A).
6. All tests in §6 pass.
7. Each modified UI file (landing, layout, onboard page, OnboardingForm, AvatarCarousel) calls `useTranslations`/`getTranslations` for every user-visible string — verified by reviewer, not grep (auth lib/route files use `apiError(code, …)` instead; `templates.ts` is data and is consumed via `t(template.nameKey)` at the call site).
8. No regressions in existing test suite.

## 8. Open questions / risks

- **`templates.ts` data structure migration.** If any test or code path currently destructures `{ name }` from a template/category, it keeps working (the field is preserved). If anything checks shape strictly (e.g. JSON schema), it'll need an update. Surface during extraction.
- **`next-intl@3` App Router quirks.** The `getRequestConfig` API requires a specific export shape; the request file lives at a path declared in `next.config.js` via `createNextIntlPlugin`. The implementation plan must include the `next.config` change.
- **Cookie + ESM dynamic imports.** Some Next.js versions evaluate middleware in the Edge runtime where `next/headers` cookie API differs from server components. Verify the chosen approach during implementation; fallback is to use `request.cookies` in middleware and `cookies()` from `next/headers` in `getRequestConfig`.
- **Server-side error fallback.** Server still emits an English `message` field alongside `code` for the gradual transition window. After all clients are confirmed to use `code` for translation, the `message` field can be removed in a follow-up.
