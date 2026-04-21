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
| `src/locales/en.json` | All ~63 keys populated (7 common + 12 onboarding + 8 templates + 30 categories + 6 errors — see §4). |
| `src/locales/{es,uk,fr,de}.json` | `{}` — empty stubs. Present so future PRs have a target file; locale-parity test in §6 skips empty files. |
| `src/locales/locales.test.ts` | Per SPEC §21.9 — see §6. |
| ~~`src/lib/api/errors.ts`~~ | **Already exists** at `src/lib/api-errors.ts` with the spec's target shape. Modified — not created — to add an optional `params?: Record<string, unknown>` field on `ApiErrorBody.error` and an `params?` argument to `apiError()`. The existing `code, message, field?` fields stay unchanged. |
| `src/lib/api-errors.test.ts` | New unit tests for the modified `apiError` (no test file exists today). |
| `middleware.ts` (root) | On request: if `NEXT_LOCALE` cookie absent, parse `Accept-Language`, pick best supported subtag, write cookie. Idempotent — does nothing if cookie already valid. |
| `middleware.test.ts` (root, alongside file) | Unit tests for the cookie-setting behavior. |

**Modified files** (extraction + small enrichment — see §4):
- `src/app/page.tsx` — landing copy → `useTranslations`
- `src/app/layout.tsx` — `<title>` / `<meta description>` via the Next.js metadata API + `getTranslations` (server)
- `src/app/onboard/page.tsx` — page metadata via `getTranslations`
- `src/components/onboarding/OnboardingForm.tsx` — `useTranslations('onboarding')` + render error toast via `t('errors.' + error.code, error.params)` with `error.message` fallback
- `src/components/onboarding/AvatarCarousel.tsx` — `useTranslations('onboarding')`
- `src/lib/templates.ts` — gains stable `key` / `nameKey` / `hintKey` per SPEC §21.6
- `src/lib/api-errors.ts` — add optional `params?: Record<string, unknown>` field (see §4 errors)
- `src/lib/auth/onboard.ts` — pass `params: { limit: AVATAR_SEED_MAX_LEN }` to the `INVALID_AVATAR_SEED` failure
- `src/lib/auth/rejoin.ts` — pass `params: { limit: REJOIN_TOKEN_MAX_LEN }` to the rejoinToken-too-long `INVALID_BODY` failure
- Existing `src/app/api/auth/{onboard,rejoin}/route.test.ts` — extend assertions to cover new `params` field in the relevant failure responses

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
common.app.featuresLine   "Vote live · Any device · Jury-style reveal"
common.cta.startRoom      "Start a room"
common.cta.joinRoom       "Join a room"
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

15 distinct categories across the 3 predefined templates × `{name, hint}`. Naming convention: `categories.{slug}.name`, `categories.{slug}.hint`. Slugs are camelCase (matching JS property convention used elsewhere in the codebase) — single-word slugs are lowercase (`vocals`, `drama`, `catchiness`, `vibes`, `quotability`, `originality`); multi-word slugs camelCase (`stagePerformance`, `costumeCommitment`, `stagingChaos`, `gayPanicLevel`). The implementation plan locks the exact slug list by reading `templates.ts` — they are not enumerated here because the file is the source of truth and re-stating them risks divergence.

### `errors` (6 keys — matches existing `ApiErrorCode` union)

Naming is **SCREAMING_SNAKE** (matches the existing `ApiErrorCode` type in `src/lib/api-errors.ts`). Splitting `INVALID_BODY` into more specific codes is **out of scope** for Phase A — six existing route-test assertions hard-code the current code names, and that refactor is API-design work that belongs to its own task.

ICU placeholders shown in `{braces}`.

```
errors.INVALID_BODY            "Something about your request was invalid."
errors.INVALID_DISPLAY_NAME    "Display name must be 2–24 characters: letters, numbers, spaces, or hyphens."
errors.INVALID_AVATAR_SEED     "Avatar identifier must be 1–{limit} characters."
errors.USER_NOT_FOUND          "We couldn't find that session."
errors.INVALID_TOKEN           "Your session has expired. Please rejoin."
errors.INTERNAL_ERROR          "Something went wrong on our end. Please try again."
```

**`INVALID_BODY` translation tradeoff.** Six different validation failures share this code, each with a unique English `message` from the server. The translation here is intentionally generic. Clients render with this fallback chain:

```ts
const translated = t(`errors.${error.code}`, error.params)
const display = translated === `errors.${error.code}`
  ? error.message   // translation key missed — fall back to server's English
  : translated
```

Future Phase B+ work can split `INVALID_BODY` into `INVALID_BODY_REJOIN_TOKEN_TOO_LONG`, `INVALID_BODY_ROOM_ID`, etc., adding one new key + translation per split. Doing it now would require updating six test assertions for marginal benefit before the switcher even ships.

### `apiError` helper extension

The existing `src/lib/api-errors.ts` becomes:

```ts
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    field?: string
    params?: Record<string, unknown>   // NEW — optional ICU params for client-side translation
  }
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
  params?: Record<string, unknown>,  // NEW — optional, defaults undefined
): NextResponse<ApiErrorBody>
```

Adding a 5th positional argument (`params`) is additive and preserves the existing call shape. Two routes update to pass `params`:

- `INVALID_AVATAR_SEED` → `params: { limit: AVATAR_SEED_MAX_LEN }`
- `INVALID_BODY` (rejoinToken too long) → `params: { limit: REJOIN_TOKEN_MAX_LEN }`

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

### `src/lib/api-errors.test.ts` (new file alongside existing helper)

- `apiError('INVALID_DISPLAY_NAME', 'msg', 400)` returns 400 with body `{ error: { code: 'INVALID_DISPLAY_NAME', message: 'msg' } }` (no `field`, no `params`).
- `apiError('INVALID_AVATAR_SEED', 'msg', 400, 'avatarSeed', { limit: 64 })` includes both `field: 'avatarSeed'` and `params: { limit: 64 }`.
- Status code is honored (200, 400, 401, 404, 500 spot-checked).
- Existing `route.test.ts` files in `src/app/api/auth/{onboard,rejoin}/` continue to pass against the modified helper (additive change only). New assertions cover that the relevant failure responses now include `params.limit`.

### `middleware.test.ts`

- `Accept-Language: es-AR,es;q=0.9,en;q=0.5` → cookie `NEXT_LOCALE=es`.
- `Accept-Language: pt-BR,en;q=0.5` → cookie `NEXT_LOCALE=en` (pt unsupported, en is the next match).
- `Accept-Language: zh-CN` → cookie `NEXT_LOCALE=en` (default fallback).
- Existing `NEXT_LOCALE=fr` cookie present → middleware does nothing.
- Invalid existing `NEXT_LOCALE=xyz` cookie → middleware overwrites with detected/default.

### Provider/component smoke testing — out of scope for Phase A

`vitest.config.ts` is configured with `environment: "node"` and the repo currently has zero `.test.tsx` files. Adding a JSDOM smoke test for the `<IntlProvider>` would mean introducing `jsdom` (or `happy-dom`) as a devDependency and either flipping the global vitest environment or using per-file `// @vitest-environment jsdom` directives. That's a test-infrastructure change that should be its own task — not bundled into the i18n PR.

Manual verification per the acceptance criteria in §7 covers the provider render path for Phase A; future component-test infra would unlock automated coverage for this and many other client components in one go.

## 7. Acceptance criteria

1. `pnpm dev` renders all currently-implemented pages identically to today for an `en` user (visual parity).
2. Setting cookie `NEXT_LOCALE=es` then reloading any page leaves the page rendered in English (every key falls back to `en` because `es.json` is empty) — proves the cookie path works without surfacing untranslated content.
3. `POST /api/auth/onboard` with an invalid display name returns HTTP 400 with body `{ error: { code: "INVALID_DISPLAY_NAME", message: "<English>", field: "displayName" } }` — unchanged from today.
4. `POST /api/auth/onboard` with an oversized avatar seed returns the same shape **plus** `params: { limit: 64 }`. `POST /api/auth/rejoin` with an oversized rejoinToken returns `code: "INVALID_BODY"` plus `params: { limit: 512 }`.
5. `OnboardingForm` renders error toast text via the fallback chain in §4 (`t('errors.' + code, params)` with `error.message` fallback) — English in Phase A; future locale work transparently translates.
6. All tests in §6 pass.
7. Each modified UI file (landing, layout, onboard page, OnboardingForm, AvatarCarousel) calls `useTranslations`/`getTranslations` for every user-visible string — verified by reviewer, not grep (auth lib/route files use `apiError(code, …)` instead; `templates.ts` is data and is consumed via `t(template.nameKey)` at the call site).
8. No regressions in existing test suite.

## 8. Open questions / risks

- **`templates.ts` data structure migration.** If any test or code path currently destructures `{ name }` from a template/category, it keeps working (the field is preserved). If anything checks shape strictly (e.g. JSON schema), it'll need an update. Surface during extraction.
- **`next-intl@3` App Router quirks.** The `getRequestConfig` API requires a specific export shape; the request file lives at a path declared in `next.config.js` via `createNextIntlPlugin`. The implementation plan must include the `next.config.js` change.
- **Cookie + ESM dynamic imports.** Some Next.js versions evaluate middleware in the Edge runtime where `next/headers` cookie API differs from server components. Verify the chosen approach during implementation; fallback is to use `request.cookies` in middleware and `cookies()` from `next/headers` in `getRequestConfig`.
- **`INVALID_BODY` overloading.** Six distinct validation failures share this single code today. Phase A keeps that shape (with a generic translation + per-failure English `message` fallback). A Phase B refactor that splits it into specific codes (e.g. `INVALID_BODY_REJOIN_TOKEN_TOO_LONG`) is straightforward but touches the existing route tests; defer until there is concrete user-facing motivation.
- **No automated client-component test coverage.** Phase A relies on manual verification of the provider + form behaviors per §7. A separate task to add `@testing-library/react` + `jsdom` to the vitest harness would unlock automated coverage and benefit many components beyond i18n.
