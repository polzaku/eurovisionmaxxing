# eurovisionmaxxing — full MVP product & engineering spec

> This document is the single source of truth for the MVP. It is written to be handed directly to a code implementation session. All decisions are final unless marked `[open]`.

---

## 1. Product overview

**eurovisionmaxxing** is a mobile-web-first Eurovision watch party voting app. A group of friends joins a shared room, votes on each country's performance using configurable scoring categories, and at the end experiences a Eurovision-style points announcement with leaderboards and personality awards.

**Primary use case:** 3–15 friends on their phones watching Eurovision together on TV. The host (admin) controls the room. The announce screen is designed to be AirPlayed or screen-mirrored to the TV.

**URL:** `eurovisionmaxxing.com` (or `.app`, `.tv` — TBD)

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14, App Router, TypeScript strict mode | Single codebase for frontend + API routes |
| Styling | Tailwind CSS, dark-mode-first | `dark:` variants throughout; follows device `prefers-color-scheme` |
| Database | Supabase (PostgreSQL) | Free tier; RLS (Row Level Security) enabled on all tables |
| Realtime | Supabase Realtime (WebSocket broadcast + presence) | Room state, voting progress, live announcement |
| Hosting | Vercel hobby plan | Auto-deploy from `main` branch; no CI/CD pipeline needed |
| Eurovision data | EurovisionAPI + hardcoded JSON fallback | See §5 for full cascade |
| Avatars | DiceBear `fun-emoji` style | `https://api.dicebear.com/7.x/fun-emoji/svg?seed={seed}` |
| QR codes | `qrcode` npm package | Client-side generation, no external service |
| Auth | Anonymous (no OAuth) | UUID stored in localStorage; Google OAuth deferred to V2 |

**Required npm dependencies** (see `package.json`):
- Runtime: `next@^14.2`, `react@^18.3`, `react-dom@^18.3`, `@supabase/supabase-js@^2.45`, `@supabase/ssr@^0.5`, `bcryptjs@^2.4`, `qrcode@^1.5`, `uuid@^10`
- Dev/types: `typescript@^5.5`, `tailwindcss@^3.4`, `postcss`, `autoprefixer`, `eslint` + `eslint-config-next`, and the `@types/*` packages for node, react, bcryptjs, qrcode, uuid

**No CI/CD for MVP.** Vercel's GitHub integration handles deploys. Required scripts in `package.json`:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "type-check": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "pre-push": "npm run type-check && npm run test",
  "prepare": "git config core.hooksPath .githooks || true"
}
```

**`next.config.js`** must whitelist DiceBear as a remote image host so the avatar SVGs can be rendered via `next/image`:
```js
module.exports = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.dicebear.com" }
    ]
  }
};
```

### 2.1 Environment variables

The app is configured entirely through environment variables — no hardcoded endpoints. Required in `.env.local` (development) and in Vercel project settings (Production/Preview/Development):

| Variable | Scope | Source | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase Project Settings → Data API | e.g. `https://abcdefgh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client | Supabase Project Settings → API Keys → "Publishable and secret API keys" tab | **New-format** key, starts with `sb_publishable_...`. Do NOT use legacy `anon` JWT keys. |
| `SUPABASE_SECRET_KEY` | server only | Same panel, "Reveal" → copy | **New-format** key, starts with `sb_secret_...`. Used by `createServiceClient()` in `src/lib/supabase/server.ts`; bypasses RLS. |
| `NEXT_PUBLIC_APP_URL` | client + server | Manual | e.g. `https://eurovisionmaxxing.com`. Used for share links and QR code URLs. |

---

## 3. Color scheme & theming

- **Default:** dark mode. Follow device `prefers-color-scheme` on first visit. A manual override is available from the header (see §3.4) — users on a light-mode device during daytime pre-show can opt into dark, and vice versa.
- No hardcoded hex values in components — use Tailwind semantic classes (`bg-background`, `text-foreground`, etc.) wired to CSS variables.
- Eurovision-adjacent palette: deep navy base, gold/amber accents, hot pink highlights.
- All text must pass WCAG AA contrast on both light and dark backgrounds.

### 3.1 Concrete palette (CSS variables in `src/app/globals.css`)

All tokens are defined as CSS variables on `:root`, with a dark-mode override inside `@media (prefers-color-scheme: dark)`. Tailwind's theme (`tailwind.config.ts`) maps these variables to utility classes.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#f8f8fc` | `#0a0a14` |
| `--foreground` | `#0a0a14` | `#e8e8f0` |
| `--card` | `#ffffff` | `#12122a` |
| `--primary` (gold) | `#d4a017` | `#f0c040` |
| `--secondary` (navy) | `#1a1a3e` | `#1e1e4a` |
| `--muted` | `#e8e8f0` | `#1a1a30` |
| `--muted-foreground` | `#6b6b80` | `#8888a0` |
| `--accent` (hot pink) | `#e91e8c` | `#ff3eaa` |
| `--destructive` | `#dc2626` | `#ef4444` |
| `--border` | `#d0d0e0` | `#2a2a50` |
| `--ring` | `#d4a017` | `#f0c040` |

Additional named tokens exposed as Tailwind classes: `gold`, `hot-pink`, `navy` (map to the same palette).

### 3.2 Animations

Defined in `tailwind.config.ts` and used throughout voting/results/announce screens:

| Class | Keyframes | Use |
|---|---|---|
| `animate-score-pop` | scale 1 → 1.3 → 1 over 0.3s | Score button press / points reveal |
| `animate-rank-shift` | translateY(var(--shift-from)) → 0 over 0.3s | Live leaderboard row reorder |
| `animate-fade-in` | opacity 0 + translateY(8px) → full over 0.3s | Card/award reveal |
| `animate-shimmer` | backgroundPosition −200% → 200% looping 2s | Loading placeholders |

Score buttons (§8.2) inherit the shared `bg-primary` / `bg-muted` tokens; no global `input[type="range"]` styling is needed (no slider in the MVP).

### 3.3 Reduced motion

All animations in §3.2 are gated on `prefers-reduced-motion: no-preference` at the CSS layer. For users with `prefers-reduced-motion: reduce`:
- `animate-score-pop` is disabled (score updates instantly).
- `animate-rank-shift` becomes an instant reorder (no transition).
- `animate-fade-in` becomes an instant opacity flip.
- `animate-shimmer` is replaced with a static `bg-muted`.

### 3.4 Manual theme toggle

A compact theme toggle lives in the shared header alongside the locale switcher (§21.4). Three states cycle on tap: **System → Light → Dark → System**. The current state is shown as an icon (☼ / 🌙 / 🖥).

- Persists to `localStorage.emx_theme` with value `"system" | "light" | "dark"`. Default is `"system"`.
- When set to `"system"`, the app respects `prefers-color-scheme` at all times (matches MVP default behaviour).
- When set to `"light"` or `"dark"`, the app applies that theme via a `data-theme` attribute on `<html>` that takes precedence over the media query.
- The toggle is **suppressed on `/room/{id}/present`** — the TV surface is always dark (§10.3) to avoid blinding viewers mid-show.

No server persistence — theme is device-local. Rationale: users may use the app on multiple devices with different ambient-light contexts.

---

## 4. User identity & session management

### 4.1 Onboarding
New users (no valid localStorage token) see a single onboarding screen:
- Text input: display name (2–24 chars, trimmed, no special chars except spaces/hyphens)
- **Avatar:** DiceBear `fun-emoji` seeded initially from the typed name (300ms debounce) to give an instant personal preview. Once the user taps the avatar or the "Shuffle" control, a **carousel of 4–6 pre-generated candidate seeds** is displayed horizontally; the user taps one to pick. The carousel remains visible and the user can re-open it by tapping their current avatar. Keystrokes **after the carousel has been opened** do not retrigger avatar regeneration (prevents flashing while typing).
- "Join" button creates the user record and stores session in localStorage

### 4.2 Session storage schema (localStorage key: `emx_session`)
```typescript
interface LocalSession {
  userId: string          // UUID v4
  rejoinToken: string     // UUID v4, server-generated
  displayName: string
  avatarSeed: string      // the seed string used for DiceBear
  locale: string          // one of SUPPORTED_LOCALES (§21.1); defaults to detected locale
  expiresAt: string       // ISO 8601, 90 days from creation
}
```

The `locale` field is a SUPPORTED_LOCALES code (§21.1); see §21 for the full localization spec.

**Expiry:** 90 days. Refreshed (reset to 90 days from now) on every successful API interaction. If expired, user re-onboards — no data loss, they just get a fresh session. Old votes remain in the DB associated with the old userId.

### 4.3 Rejoin logic

The rejoin token identifies the **user**, not a specific room. The same user can join multiple rooms across the season with the same identity.

**Same device:**
1. On any room URL, check localStorage for `emx_session`
2. If found and not expired → silently call `POST /api/auth/rejoin` with `{ userId, rejoinToken, roomId }`
3. Server validates token, returns session confirmation
4. User lands directly on their in-progress voting card — no re-onboarding

**Different device (no localStorage token):**
1. User sees onboarding screen with name input
2. On submit, server checks for existing users in that room with a matching name (case-insensitive, trimmed)
3. If match(es) found → show **avatar-first confirmation UI**: *"Someone with that name is already in this room. Tap your avatar to rejoin, or create a new identity."* Display the candidate avatar(s) only — display names are not re-rendered until the user picks one (avoids leaking other guests' names to anyone who can guess a name).
4. If multiple matches (same name) → show all matching avatars side-by-side, user picks the one that's theirs.
5. **"Create new" escape hatch** is always present below the avatar picker, in case none match (e.g. a previous device for the same name belonged to someone else with the same name). Choosing it treats the user as new (step 6).
6. On avatar pick → merge session, inherit all previous votes. New localStorage token issued.
7. If no match → treat as new user

**Note:** The rejoin token is stored hashed (bcrypt) in the database. The localStorage holds the plaintext token; the server hashes and compares on rejoin.

---

## 5. Eurovision contestant data

### 5.1 Fetch cascade (runtime, called at room creation)

```
1. Attempt fetch from EurovisionAPI:
   GET https://eurovisionapi.runasp.net/api/contests/{year}/events/{apiEventName}/contestants
   
   The internal `event` code must be translated to the API's slug:
     semi1 → "first-semi-final"
     semi2 → "second-semi-final"
     final → "grand-final"
   
2. Validate response:
   - HTTP 200
   - Array with length > 0
   - Each item has: country (string), artist (string), song (string), runningOrder (number)
   - If any check fails → log warning, proceed to step 3

3. Fallback to hardcoded JSON:
   Load from /data/contestants/{year}/{event}.json (bundled in repo)
   - Apply same validation
   - If valid → use this data, log that fallback was used
   - If invalid or file missing → throw ContestDataError("Contest data not found for {year} {event}")

4. On ContestDataError:
   Show user-facing error: "We couldn't load contestant data for this event.
   The admin can try again or select a different year/event."
```

Next.js fetch should cache the API response for 1 hour (`fetch(url, { next: { revalidate: 3600 } })`) so repeated room creations in the same lineup don't hammer the upstream API.

### 5.1a Country code + flag derivation

Hardcoded JSON only needs `country`, `artist`, `song`, `runningOrder`. The server derives the remaining fields in `src/lib/contestants.ts`:

- `countryCode` — lookup in a `COUNTRY_CODES` map keyed by English country name (must cover all standard Eurovision participants: Albania, Armenia, Australia, Austria, Azerbaijan, Belgium, Bulgaria, Croatia, Cyprus, Czech Republic/Czechia, Denmark, Estonia, Finland, France, Georgia, Germany, Greece, Iceland, Ireland, Israel, Italy, Latvia, Lithuania, Luxembourg, Malta, Moldova, Montenegro, Netherlands, North Macedonia, Norway, Poland, Portugal, Romania, San Marino, Serbia, Slovenia, Spain, Sweden, Switzerland, Ukraine, United Kingdom). Unknown names fall back to the first two letters lowercased.
- `flagEmoji` — computed by offsetting each upper-case letter of the country code by `0x1F1E6 − 'A'` and concatenating the two regional-indicator code points.
- `id` — `"{year}-{countryCode}"`.

Contestants are returned sorted ascending by `runningOrder`.

### 5.1b Hardcoded data scope shipped with MVP

The repo must ship the following fallback JSON files under `data/contestants/`:

- `2025/semi1.json`, `2025/semi2.json`, `2025/final.json` — populated with the 2025 Eurovision lineup
- `2026/final.json` — placeholder/initial lineup for the current cycle; `semi1` / `semi2` added once drawn

A `data/README.md` documents the minimal JSON shape (four fields) and the fact that the other fields are derived at runtime.

**Pre-show requirement (2026 season):** before the Grand Final ship cut-off, `2026/final.json` MUST be populated with the actual finalised lineup (running order, country, artist, song). An empty or stub file is a critical bug: the upstream EurovisionAPI cascade is best-effort, and the moment it returns 4xx/5xx during a show, every room falls through to this file. An empty fallback yields a room with zero contestants, which is a blank voting screen on TV. The fetch path is documented in §5.1c — running the refresh script and spot-checking the JSON is part of the pre-show checklist.

### 5.1c Operational runbook for contestant data refresh

The hardcoded fallback is load-bearing whenever the EurovisionAPI lags behind the public announcement. A documented refresh process prevents show-night surprises.

**Owner:** repo maintainer (currently the original author). On-call backup must be named in `SUPABASE_SETUP.md` before the first show of the season.

**Triggers:**
- Eurovision **allocation draw** (running order announcement) for each semi-final — typically ~2 weeks before that semi airs.
- Contestant **withdrawal** announcement — can happen any time between draw and show.
- **Opening show day** for each event — final verification within 24 h of broadcast.

**Process (≤5 min):**
1. Run `npm run fetch-contestants -- --year=YYYY --event=semi1|semi2|final`. The script hits EurovisionAPI with the current cascade (§5.1) and writes the normalised JSON to `data/contestants/{year}/{event}.json`.
2. If the API returns empty / invalid, the script exits non-zero. Fall back to manual transcription from [eurovision.tv](https://eurovision.tv) official announcements — paste into the JSON using the 4-field shape from §5.2.
3. Diff-check: `git diff data/contestants/` must show only expected changes (running order, new artist, spelling fix). Unexpected deletions require manual review before commit.
4. Commit with message `Update {year}/{event} running order — {source}` where source is `api` or `manual-{yyyy-mm-dd}`.
5. Vercel auto-deploys on push to `main`. No further action.

**Verification:** the `/api/contestants?year=YYYY&event=EVENT` endpoint must return the fresh data within 1 min of deploy. A smoke query against the production URL is included in the PR template.

### 5.1d Admin-driven contestant refresh (lobby only)

Running orders can change between room creation and showtime — e.g. a contestant withdraws. Admins need a non-destructive way to pull the latest data without tearing down the room (losing the PIN, existing memberships, and lobby bets — §22).

**Endpoint:** `POST /api/rooms/{id}/refresh-contestants` (admin-only).

**Preconditions:**
- `rooms.status = 'lobby'`. Any other status → HTTP 409 `{ code: "room_not_in_lobby" }`.
- Caller must be `rooms.owner_user_id` or a co-admin (§6.7). Otherwise 403.

**Behaviour:**
- Re-runs the §5.1 cascade (cache-bypassed: `fetch(url, { next: { revalidate: 0 } })`).
- Compares the returned list with the in-memory cached list for the room. If the new list has **different `runningOrder`, added contestants, or removed contestants**, the room's server-side cached contestant snapshot is replaced.
- Broadcasts `contestants_refreshed` on `room:{roomId}` — clients reload the contestant list.
- Response body: `{ added: string[], removed: string[], reordered: string[] }` (arrays of country codes) so the admin can see what changed.

**Does not affect:** votes (none yet in lobby), bets (re-validated only if a bet references a removed contestant; none do in the catalog per §22, so no special handling).

**Rate limit:** 1 refresh per 30 s per room to prevent mash-tap spam.

### 5.1e Loading state during contestant fetch

In the `/create` wizard Step 1 (§6.1) and on any admin-triggered refresh (§5.1d), the fetch may take 2–10 s on bad networks. The UI must communicate progress so users don't perceive the app as frozen.

- Fetch fires **on year/event selection change** (auto, debounced 300 ms to collapse rapid changes). No explicit "Load" button.
- While in flight:
  - Preview area renders a shimmer placeholder with the copy *"Loading contestants…"* (locale key `create.contestantsLoading`).
  - The wizard's **"Next" button is disabled** and shows a faded state.
- On success: render count + first 5 flags, e.g. *"17 countries loaded 🇦🇱 🇦🇷 🇦🇹 🇧🇪 🇭🇷 …"* (locale key `create.contestantsLoaded` with ICU `{count, plural}`). "Next" enables.
- If the fetch is **still running at 5 s**: swap placeholder copy to *"Still loading — EurovisionAPI can be slow."* (locale key `create.contestantsSlow`). Keep the shimmer.
- **Hard timeout at 10 s** → treat as API failure → proceed to §5.1 step 2 (hardcoded fallback) silently. Log `fallback_reason: "api_timeout_10s"` server-side.
- The fetch is abortable via `AbortController`. Changing year or event mid-flight cancels the previous request (prevents race-condition lists from clobbering the preview).
- If the final outcome is §5.1 step 4 (`ContestDataError`): render the §6.1 Step 1 inline error *"We couldn't load contestant data for this event. Try a different year or event."* with the "Back" CTA.

### 5.2 Hardcoded JSON structure
Files live at `data/contestants/{year}/{event}.json`. Updated manually once per season when lineup confirms. Filename convention: `data/contestants/2026/semi1.json`, `semi2.json`, `final.json`.

```typescript
interface Contestant {
  id: string              // "{year}-{countryCode}" e.g. "2026-gb"
  country: string         // "United Kingdom"
  countryCode: string     // ISO 3166-1 alpha-2, lowercase: "gb"
  flagEmoji: string       // "🇬🇧"
  artist: string          // "Remember Monday"
  song: string            // "What The Hell Just Happened?"
  runningOrder: number    // 1-indexed, as performed
  event: "semi1" | "semi2" | "final"
  year: number
}
```

### 5.3 Year and event selection (room creation)
- Default year: current calendar year
- Admin can select any year from 2000 to current (dropdown)
- On year change, fetch available events from API (or derive from hardcoded data)
- Events available: Semi-Final 1, Semi-Final 2, Grand Final (not all years had semis — validate)
- Contestants display in running order by default

**Allocation-draw-lag caveat (current season):** Semi-final running orders are published only after the **allocation draw**, typically ~2 weeks before each semi airs and ~6–8 weeks before the grand final. Before that draw, the EurovisionAPI will often return either (a) an empty list, (b) a list without `runningOrder`, or (c) alphabetical ordering that is NOT the broadcast order. Consequences for the MVP:
- At room creation for a semi whose draw hasn't happened, §5.1 step 2 fails validation (missing/invalid `runningOrder`) → cascades to hardcoded JSON → cascades to `ContestDataError` if the JSON also isn't yet populated.
- Admins attempting to create a current-season semi room before allocation draw see the §6.1 Step 1 inline error. They must wait, or choose Grand Final (which has a longer-published lineup), or choose a past year for practice rooms.
- Maintainers populate `data/contestants/{year}/{event}.json` within 24 h of the official announcement per §5.1c.

### 5.4 Flag display
Use `flagEmoji` field (unicode flag emoji derived from `countryCode`). Render at 24px on voting cards, 32px on results. No external flag image CDN needed.

### 5.5 Integration smoke test (CI)

A GitHub Action `contestant-api-smoke.yml` runs on a daily schedule (`0 6 * * *` UTC) and on PRs that touch `src/lib/contestants.ts` or the `/api/contestants` route. It hits the real EurovisionAPI against a **known-good historical fixture** (2025 grand final) and asserts:

- HTTP 200
- Array length ≥ 25
- Every row has the four required fields (`country`, `artist`, `song`, `runningOrder`)
- A spot-check: the country with `runningOrder = 1` matches the committed `data/contestants/2025/final.json` row at index 0.

On failure, the job posts a notification to the repo's GitHub Issues (label `api-upstream`) and does **not** block PRs — the fallback cascade exists precisely so upstream flakiness doesn't break us. The job's value is surfacing slow rot in the upstream schema before show night.

---

## 6. Room management

### 6.1 Room creation flow
Admin goes through a **2-step wizard**, then lands directly in the lobby (`/room/{id}`). The previous "Step 3 — Room ready" page (PIN + QR + share affordances) was removed on 2026-05-02 because it duplicated the lobby and added a useless extra tap before the admin reached the page everyone else would join from. **The lobby itself surfaces the PIN, QR code, and share affordances** — see "Lobby chrome" below.

**Step 1: Event selection**
- Year (default: current year)
- Event: Semi-Final 1 / Semi-Final 2 / Grand Final
- Preview of contestant count once loaded (e.g. "17 countries loaded")
- If both the EurovisionAPI call **and** the hardcoded-JSON fallback fail (§5.1 step 4), the wizard renders an inline error: *"We couldn't load contestant data for this event. Try a different year or event."* with a "Back" CTA that returns to year/event selection (it does not silently fail).

**Step 2: Voting configuration**
- Template selection: four **compact** cards (Classic / Spectacle / Banger Test / Custom). Each card collapses to **template name + one-line tagline + ⓘ icon** by default; the whole card surface is the click target for selection (`selected` state shown via `border-primary` + ring). Rationale: the long category + hint list under every card produced too much vertical text for a hurried admin scanning the wizard, and a separate textual CTA inside a card whose body is already the click target was redundant noise. Detail moves behind the ⓘ.
  - **ⓘ behaviour:** tap ⓘ → categories + hints expand inline beneath the card (same content as the previous "expand the card" UX, just gated). Tap ⓘ again → collapse. Only one card's detail is open at a time within Step 2 (opening a second auto-collapses the first). Tapping ⓘ never selects the card; tapping the card body never expands it.
  - The Custom card's ⓘ shows a short *"Build your own categories from scratch"* explainer; the actual builder opens once the card is selected and the wizard advances.
- Announcement mode: **two compact radio cards** — each shows a one-line tagline + ⓘ. Tap ⓘ → the longer plain-language explainer expands inline.
  - **Live:** *"Take turns announcing your points, Eurovision-style."* (ⓘ: *"Great with a TV. Each user reveals their 1 → 12 in turn.")*
  - **Instant:** *"Reveal the winner in one shot."* (ⓘ: *"Great if you're short on time. Everyone marks themselves ready, then the leaderboard appears.")*
  - When **Live** is selected, a third compact radio appears beneath it for the **announcement style** (`announcement_style` on `rooms`, default `full`):
    - **Full reveal** *(default)*: the 1 → 12 reveal flow described in §10.2.
    - **Short reveal — Eurovision style** *(faithful to the Eurovision 2025 broadcast)*: 1–8 and 10 are added to the scoreboard automatically; only the 12-point reveal is live and per-user. See §10.2.2 for the full three-surface mechanic.
- **Room bets (optional, off by default)** — toggle *"Add a betting sidegame"*. When enabled, the admin picks **exactly 3 bets** from the catalog in §22.1, or taps **"Surprise me"** for 3 random picks. Bets lock at the `lobby → voting` transition. Separate leaderboard from the main Eurovision-points game. Full mechanic in §22.
- **"Now performing" broadcast** (internal name: `allow_now_performing`) — when enabled, the admin can tap the currently-performing country. Guests see an opt-in *"Jump to [Country]"* pill at the top of their voting view (not a forced snap). The `/present` screen always follows the broadcast. Off by default. Info icon copy: *"Shows guests a pill to jump; it never auto-snaps them while they're scoring."* See §6.5.
  - **Implementation status (2026-05-16):** the wizard checkbox is **hidden in the UI** (JSX commented out in `src/components/create/VotingConfig.tsx`) because the voting-state surfaces described in §6.5 (admin tap-to-broadcast panel + guest opt-in pill) are not yet built. The `allow_now_performing` prop, API field, and DB column remain wired end-to-end at the default `false`, so the contract is unchanged; re-enable the checkbox once the §6.5 UI ships (TODO.md Phase R10).

**On wizard submit:** the room is created (`POST /api/rooms`) and the admin is **redirected immediately to `/room/{roomId}`** — the lobby. No interstitial "Room ready" page.

**Lobby chrome (admin view, `rooms.status = 'lobby'`):**
The lobby is the canonical share surface. The chrome the old Step 3 carried lives here, visible to the owner (and co-admins per §6.7):

- Room PIN (6 alphanumeric chars, uppercase, excluding O/0/I/1 for readability) rendered prominently.
- QR code pointing to the room URL, **minimum 256×256 CSS px** (reliable scanning across a room). Fills to natural container above that.
- Shareable link: `eurovisionmaxxing.com/room/{roomId}`.
- **"Copy link"** and **"Copy PIN"** buttons. On tap, each shows a transient *"Copied!"* toast or inline label for ~2 seconds.
- **"Start voting"** button — transitions `lobby → voting` and broadcasts `status_changed`.

Guest view of the lobby shows the participant roster + the PIN (so they can read it aloud) but not the start-voting CTA.

**Editing after creation (admin-only, in-lobby):**
While `rooms.status = 'lobby'`, the admin can re-open a limited wizard from the lobby view to change **categories** (add, remove, rename, edit weight/hint, **drag-reorder** via the same grip-handle UX as §7.2), **announcement mode**, the **now-performing toggle**, and the **room bets** (swap/replace/toggle off — see §22.2). Year and event are **not** editable post-creation (contestant data and PIN don't change; for contestant-list updates after an allocation-draw update, use §5.1d). All edits lock permanently once status transitions to `voting`. The lobby view surfaces the entry point as an "Edit room" control, visible only to the owner (and co-admins, §6.7). The lobby-edit surface uses the **same compact + ⓘ template-card and announcement-mode UX** as Step 2 above — no second design.

### 6.2 Room PIN generation
- 6 chars from charset: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no O, 0, I, 1)
- Check uniqueness against active rooms before assigning
- Collision retry up to 5 times, then expand to 7 chars

### 6.3 Room lifecycle states
```
lobby → voting → scoring → announcing → done
```
- `lobby`: users joining, admin sees participant list
- `voting`: all users can vote; admin can press "End voting"
- `scoring`: server computes all scores (brief transition, typically <1s). All client surfaces render a **"Tallying results…" overlay** with `animate-shimmer` so this state is never a blank flash. The overlay clears as soon as the `status_changed` broadcast for `announcing` arrives.
- `announcing`: either live or instant mode
- `done`: results frozen, shareable link active

State transitions are admin-only actions. State is stored in `rooms.status` and broadcast via Supabase Realtime to all room subscribers. All connected clients react to state changes immediately.

#### 6.3.1 "End voting" undo window

"End voting" is a high-consequence tap that kicks off scoring and freezes every guest's vote. The admin must have a safety net for accidental taps (common on phones held loosely while shouting across a room).

**Flow:**
1. Admin taps "End voting" on their control panel.
2. Server transitions `rooms.status` → `voting_ending` (new intermediate state) and writes `rooms.voting_ends_at = now() + 5 seconds`.
3. All clients receive a `voting_ending` broadcast and render a **5-second countdown toast** at the top of the screen: *"Voting ends in 5… 4… 3… Undo"* with a large "Undo" button visible to the admin only.
4. If the admin taps **Undo** before the countdown elapses: server reverts `rooms.status` back to `voting`, broadcasts `status_changed` with `voting`, and the toast dismisses. Guest voting resumes seamlessly (no local state lost).
5. If the countdown elapses without an undo: server transitions `rooms.status` → `scoring` and the §9 pipeline runs.
6. If the admin leaves the app during the countdown, the countdown continues server-side — this is a server-authoritative timer, not a client timer. Refresh-proof.

**State machine addition:**
```
lobby → voting ⇄ voting_ending → scoring → announcing → done
                  ↑____undo____|
```

`voting_ending` is added to the `rooms.status` CHECK constraint. Guest voting is still permitted during `voting_ending` (votes aren't locked yet — only the state is in a "committing" phase). The 5-second window is not user-adjustable in MVP.

#### 6.3.2 Late joiners during `voting`

Common case: a friend arrives 30 min late and wants to join the room. Spec:

- Users may join a room in any status except `scoring`, `announcing`, or `done`. For `voting`, join succeeds; the user is added to `room_memberships` with `joined_at = now()`.
- On first load, late joiners see a **one-time info card** at the top of their voting view: *"You joined mid-show. Catch up by scoring the songs you've seen — skip the rest, or mark them 'I missed this'."* The card is dismissible.
- **Bets are locked** for late joiners — they see the room's 3 bets as read-only with their personal pick set to *"No opinion (joined after bets locked)"* per §22.3. No retroactive picks permitted.
- Late joiners' votes are scored identically to everyone else's — no weighting or penalty. The `joined_at` timestamp is informational only.
- If `joined_at` is within 10 minutes of `rooms.voting_ends_at` (the admin has already triggered "End voting"), they are **still accepted into voting** but the server surfaces a warning toast: *"Voting ends in under a minute — score quickly."*
- Attempts to join during `scoring`, `announcing`, or `done` return HTTP 409 `{ code: "room_voting_closed" }` — the join-by-pin route (§6.4) already rejects `announcing`/`done` and must be extended to reject `scoring` / `voting_ending`.

### 6.4 Room join by PIN
Route: `eurovisionmaxxing.com/join`

**Input pattern:** one underlying `<input>` element with `inputmode="text" autocapitalize="characters" autocomplete="one-time-code" maxlength="6" pattern="[A-HJKMNP-Z2-9]{6}"` styled with a **visual slot overlay** — six segmented boxes render the typed characters, but the DOM target is a single input. Rationale: this preserves the speakable "A… B… J…" look while getting clipboard paste, password manager autofill, iOS SMS-code autofill, and natural backspace-to-correct for free. Six-slot DOM-input implementations break all four of those.

- Auto-uppercase via `autocapitalize="characters"` + a JS transform on input to enforce the charset.
- On six valid characters: auto-submit `POST /api/rooms/join-by-pin` → redirect to room URL on success.
- Error states: room not found, room already in `scoring` / `announcing` / `voting_ending` / `done`. Errors render inline below the input and **do not clear the entered characters** (user can correct a typo).
- Error copy: locale keys `errors.room_not_found` and `errors.room_voting_closed` (mapped from server error codes per §21.7).

**Fallback visual (optional enhancement):** keep a non-interactive six-slot row below the input for speakable display. Both layouts share the same input value via React state. If the single-input pattern causes issues on any tested browser, switch to the legacy six-DOM-input pattern behind a feature flag.

### 6.5 "Now performing" mode
When enabled by admin at room creation (see §6.1 Step 2, "Now performing" broadcast):

- Admin sees a "Now performing" control panel with a list of all contestants. For MVP the admin taps each act manually as the show progresses (no auto-follow-running-order). Auto-queue is deferred to V2.
- Tapping a contestant broadcasts `now_performing: contestantId` to all room subscribers.

**Guest phones (opt-in pill, never auto-snap):**
- Non-admin users on a *different* card than the currently-performing one see a prominent pill at the **top of their voting view**: *"🎤 Now performing: [Country flag] [Country] — [Song] → Jump"*. Tapping the pill navigates to that contestant's card. Tapping the **×** dismisses the pill for that broadcast only (next `now_performing` event re-shows it).
- The pill is **suppressed on the performing card itself** (no duplication).
- Guests are never force-navigated. Rationale: a user mid-score on a different act should not be interrupted. The pill is a discoverable affordance; the choice to jump is theirs.

**Admin's own phone:** same pill pattern as guests (admin is also a scorer). The admin tapping "Now performing: [X]" broadcasts the event but does not force-snap the admin's own view.

**`/room/{id}/present` (TV screen):** **always follows the broadcast** — the TV auto-snaps to the performing country's card so the room-view on the TV stays synchronised with the show. This is the place where automatic sync belongs (shared context, no individual interaction state to disrupt).

### 6.6 Lobby experience

The lobby is no longer a dead "waiting for admin" screen. Guests arrive 20–30 min before showtime; the lobby surface should reward early arrival, orient late arrivals, and tee up the night.

**6.6.1 Show countdown**
- Prominent countdown to the event's broadcast start time, when known. Format: `DD:HH:MM:SS` collapsing to `HH:MM:SS` in the final 24 h.
- Broadcast start times for each `{year, event}` are shipped alongside the contestant fallback JSON (`data/contestants/{year}/{event}.json` gains a top-level `broadcastStartUtc` field). Backfilled for 2025; populated with the 2026 schedule when announced.
- If `broadcastStartUtc` is missing (e.g. a practice room on past-year data), countdown is suppressed and replaced with *"Ready whenever you are."*

**6.6.2 "Who's here" roster**
- Every room member's avatar + display name rendered as an always-visible roster, live-updated via the `user_joined` / `user_left` broadcasts (§15). Grey-out on presence loss (>30 s since last broadcast ping on `room:{roomId}`).
- Roster is visible to **everyone** in the lobby, not just admin — helps guests see "who's already here?" at a glance and reduces "am I alone?" anxiety for early arrivers.
- The roster moves to a compact header strip once voting starts (§8.x), continuing to show presence throughout the show.

**6.6.3 Contestant primer carousel**
- Horizontally scrollable card deck showing every contestant in running order: flag · country · song · artist. Tapping a card flips it to reveal the category hints that will apply (pulled from the selected template) plus a "Preview song" external link to YouTube if available (deep-link only — no embed, no media rights required).
- Deep-link source: the `artistPreviewUrl` optional field on the hardcoded JSON (`data/contestants/{year}/{event}.json`). When absent, the "Preview song" link is hidden.
- Useful for late joiners who missed early acts, and for early arrivers who want to warm up.
- **Hints-seen signal.** The first time the user flips any primer card to read hints, the client writes `localStorage.emx_hints_seen_{roomId} = true`. This flag is consumed by the voting card's hint-collapse default (§8.2): users who pre-read in the lobby never see hints expanded again on the voting card.

**6.6.4 Room bets preview**
- If the admin enabled bets (§6.1 Step 2, §22), the three bet questions render as a read-only card in the lobby showing what will be asked when bets open. Guests can place their picks from this card (see §22.3 interaction). Un-picked bets remain in a guest's *"Still to pick"* list.
- Lobby closes for bet picks at the `lobby → voting` transition. Late joiners see a greyed-out version with the *"Bets locked"* banner per §6.3.2.

**6.6.5 Lobby admin controls**
- Room PIN and QR code (from §6.1 Step 3) remain visible for mid-lobby joiners.
- "Start voting" primary CTA (admin only).
- "Edit room" secondary (admin + co-admins, §6.7).
- Co-admin promotion drawer accessible from the roster (§6.7).

### 6.7 Admin transfer and co-admins

A single admin's phone dying mid-show is a real risk over a 4-hour event. The MVP supports lightweight redundancy without introducing user roles or complex permissioning.

**Data model:**
- `rooms.owner_user_id` remains the primary admin (the room's "owner") — immutable for the room's lifetime (used for present-screen locale §21.4, and for audit).
- New `room_memberships.is_co_admin BOOLEAN DEFAULT FALSE` flag — a co-admin has the same authority as the owner for every admin-gated action **except transferring ownership** (reserved for the owner).
- Zero, one, or many co-admins per room. No UI limit in MVP (friend groups self-limit).

**Promotion flow:**
- Any time before `done`, the owner opens the roster (§6.6.2 in lobby; header roster during voting/announcing) and long-presses / right-taps a member → modal: *"Make [Name] a co-admin?"* with confirm/cancel.
- Server validates caller == owner, sets `is_co_admin = true`, broadcasts `co_admin_changed` so the promoted user's UI surfaces admin controls without a refresh.

**Demotion:**
- Same flow, reverse label. Owner only.

**Ownership transfer (owner-initiated):**
- Owner opens roster → long-press on an existing co-admin → *"Hand over ownership to [Name]?"* with a confirm dialog: *"You'll become a co-admin. Only they can transfer ownership back."*
- On confirm: server sets `rooms.owner_user_id = newOwnerId`, sets old owner's `is_co_admin = true`, broadcasts `ownership_transferred`. The new owner's `preferred_locale` now drives the `/present` screen (§21.4) from the next render.

**Automatic promotion-on-absence (fallback):**
- If the owner has been absent from `room:{roomId}` presence for **>5 minutes** during `voting` / `voting_ending` / `scoring` / `announcing`, the server auto-promotes the **longest-tenured co-admin** (earliest `room_memberships.joined_at` among co-admins) to owner and broadcasts `ownership_transferred` with `reason: "owner_absent_5m"`.
- If there are no co-admins at the 5-minute mark, the server does nothing (no random non-admin promotion — that's a V2 design).
- On owner return, ownership does **not** automatically revert. The new owner may choose to transfer back.

**Authorization recap:**
- Owner-only: transfer ownership, promote/demote co-admins, delete the room (V2).
- Admin-or-co-admin (any row-mutating admin action elsewhere in the spec): status transitions, now-performing broadcasts, hot-take moderation (§8.7), bet resolution (§22), announcer handoff (§10.2), contestant refresh (§5.1d), room edits in lobby (§6.1).

All "admin-only" mentions throughout this document are shorthand for "owner or co-admin" unless explicitly scoped to the owner.

---

## 7. Voting categories & templates

> Template display names, category names, and category hints in this section are translated at render time via the stable keys defined in §21. The English text shown here is the source-of-truth copy.

### 7.1 Predefined templates

**Template 1 — "The Classic"**
*For fans who want to be fair and thorough.*
| Category | Weight | Hint |
|---|---|---|
| Vocals | 1 | Technical delivery and control — not just whether you like the style |
| Music | 1 | Composition, arrangement, and production quality |
| Outfit | 1 | The look. Does it serve? Does it commit? |
| Stage performance | 1 | Movement, energy, use of the stage |
| Vibes | 1 | The ineffable. How did it make you feel? |

**Template 2 — "The Spectacle"**
*For when you want to reward the unhinged.*
| Category | Weight | Hint |
|---|---|---|
| Drama | 1 | How much did it make you gasp, clutch pearls, or lean forward? |
| Costume commitment | 1 | Not just nice — how hard did they go? Full send? |
| Staging chaos | 1 | Was it controlled insanity or just confused? Reward the former. |
| Gay panic level | 1 | The campness. The queerness. The iconography. |
| Quotability | 1 | Will you still be referencing this in November? |

**Template 3 — "The Banger Test"**
*For when the group wants to find the actual best song.*
| Category | Weight | Hint |
|---|---|---|
| Catchiness | 1 | Could you hum it 10 minutes later? |
| Danceability | 1 | Did your body move involuntarily? |
| Production | 1 | Sound design, mixing, studio quality |
| Lyrics | 1 | What are they actually saying? Does it hold up? |
| Originality | 1 | Has Eurovision heard this before? |

**Template 4 — "Custom"**
Admin builds from scratch. See §7.2.

### 7.2 Custom category builder
- Add up to 8 categories
- Each category:
  - Name: required, 2–24 chars, no special characters. Duplicate names (case-insensitive, trimmed) within the same room are rejected.
  - Weight: optional integer input, blank = 1, min 1, max 5, step 1. (Half-unit weights deferred to V2.)
  - Hint: optional, max 80 chars. Rendered inline below the category name on the voting card, **collapsed by default behind a ⓘ icon** per the hint-collapse rules in §8.2. Not a hover tooltip. (Lobby-time hint reading uses the primer carousel from §6.6.3, not the voting card.)
- Reorder via a dedicated drag handle (grip icon on the left of each row); touch-and-hold (300ms) to activate dragging on mobile.
- **Percentage is the primary display** next to each category name — e.g. "Vocals · 33%". Weights are the underlying input (1–5); percentages are computed live as `weight[i] / Σ(weights)` and always sum to 100%.
  - Examples: 5 categories of equal weight 1 → 20% each. Vocals=2 with four others at 1 → Vocals = 33%, others = 17% each.
- Validation: at least 1 category required before room can be created.

### 7.3 Score scale anchors
All categories use a 1–10 integer scale. Three anchor labels are rendered below the score-button row (§8.2), under buttons **1**, **5**, and **10**:
- **1** — Devastating. A moment I will try to forget.
- **5** — Fine. Watched it. Won't remember it.
- **10** — Absolute masterpiece. My 12 points. Iconic.

These anchors appear on every voting card regardless of template. Anchor copy is translated via `t('voting.anchor1' | 'voting.anchor5' | 'voting.anchor10')`; see §21.

---

## 8. Voting interface

### 8.1 Layout (mobile-first)
- Full-screen single-contestant view. Designed to fit on iPhone 12+ (390×750 CSS px) **without vertical scroll** with a typical 5-category template + collapsed hints + collapsed hot-take. Older iPhone SE (568 px tall) may scroll one row — accepted MVP trade-off.
- Header:
  - Left: contestant flag emoji + country name + song title + artist name.
  - Right: a compact progress cluster — the running-order label `3/17` stacked above a thin **progress bar** (`bg-muted` track, `bg-primary` fill) whose fill ratio is `scoredCount / totalContestants`, with the smaller label `2 scored` underneath the bar. Rationale: progress-bar + one numeric label communicates both "where am I in the running order" and "how far through voting am I" without two competing integer labels as in earlier drafts.
  - **Scale ⓘ icon** next to the progress cluster: tap → bottom-sheet (or popover) showing the three anchor labels — `1 — Devastating`, `5 — Fine`, `10 — Iconic` (locale keys `voting.scale.1|5|10`). Supersedes the earlier "global scale strip" line above the category rows. Rationale: most users only need to see the anchors once; keeping them on every card consumed scarce vertical space.
  - **Calibration drawer button** (icon: ⚖️ or list-icon, locale label `voting.calibration.openButton`) — opens the per-user vote-review drawer described in §8.10.
  - **Lock chip** — when the user has tapped *"Lock my scores"* the chip reads `🔒 Locked` (tap → unlock); otherwise the lock affordance lives at the bottom of the calibration drawer. See §8.10.
- Body: category score rows per §8.2 (hints collapsed under ⓘ on each category row).
- Footer: a slim icon-bar — **Prev** (←) · **Missed** (👻 / "I missed this", §8.3) · **Jump-to** (☰) · **Next** (→). Icon-only; labels render via `aria-label` for screen readers and as tooltips on long-press. Reduces the previous three-button text footer to ~44 px tall.
- Hot-take area is a single pill button *"+ Add a hot take"* below the score rows by default; tap → expands inline into the §8.7 input. Once a hot-take exists, the rendered text + edit/delete affordances replace the pill (no extra "+" tap to edit).
- Jump-to: drawer of all countries (flag + name + per-contestant **scored-chip** from §8.8), tapping any navigates directly.

### 8.2 Category score bar

Each category renders as a **single-row fill-bar of 10 tappable segments** labelled 1 through 10. Cumulative-fill metaphor: selecting N fills segments 1..N gold, like a strength meter. Supersedes the earlier 5×2 button grid, which wrapped on narrow viewports and communicated less at a glance.

- **Values:** integer 1–10. Each segment represents one discrete value; selecting it also fills every lower segment.
- **Touch targets:** each segment is at least 32×44 CSS px (width × height). The horizontal dimension is relaxed from the 44-px accessibility floor because the whole bar is a single thumb-reachable strip — mistaps land on an adjacent value rather than a destructive action. Vertical dimension keeps the 44-px floor. 10 × 32 = 320 px → fits iPhone SE width with no scroll.
- **Visible numbers inside every segment.** Each segment shows its value (1–10) as the primary label. Text is the cue to scale; fill length alone is not enough — users would not reliably count bars. Font weight + colour update based on state (see below).
- **Single row always.** The bar never wraps to two rows. On viewports narrower than 320 px (vanishingly rare), the bar gets `overflow-x: auto` with a subtle scroll cue. No two-row fallback.
- **Category row header (single line):** category **name** + ⓘ icon (only when a hint exists) + optional weight badge — left-aligned. The status label is **inline with the name**, separated by a middle dot:
  - *Unscored* → `Vocals · Not scored` in `text-muted-foreground` (locale key `voting.status.unscored`).
  - *Scored* → `Vocals · ✓ scored N` with the *Vocals* portion in `text-foreground` and the suffix in `text-primary` (gold) (locale key `voting.status.scored` with `{value}`).
  - Rationale: collapsing the row header from a two-baseline layout to a single line saves ~16 px per row. Replaces the earlier right-aligned status pill.
- **Weight badge (only when weights are non-uniform):** when the room's category weights are not all equal, categories with `weight > 1` render a pill next to their name: `counts 2×` (or `counts 3×`, etc., locale key `voting.weight.badge` with `{multiplier}`). Categories with `weight = 1` render no badge. For rooms where **every** category has `weight = 1` (all predefined templates by default), the badge is suppressed entirely — no visual noise in the common case. Percentages (§7.2 admin builder) remain the primary authoring display; **voters see weight as a multiplier, not a percentage**.
- **Hint (collapsed-by-default behind ⓘ):** the category hint renders inline below the category name **only when expanded**. The ⓘ icon next to the category name is the toggle. Default state on each voting card:
  - If `localStorage.emx_hints_seen_{roomId} === true` (set by either the lobby primer carousel, §6.6.3, or by completing the first voting card's onboarding below) → all hints **collapsed** by default.
  - Else, on the **first voting card the user lands on**, hints render **expanded** as one-time onboarding. Tapping any segment to score, navigating to the next card, or tapping any hint's ⓘ to collapse it sets `emx_hints_seen_{roomId} = true`; from then on, all subsequent cards default to collapsed.
  - Once collapsed, expanding a hint on one card does NOT keep it expanded on the next card — the per-card state is independent. Users can re-open ⓘ any time.
  - Rationale: combines the original *"hint always visible"* educational intent with a no-scroll vertical budget. Power users skip the hints entirely; first-time voters get one card of "training wheels" on whichever contestant they enter on.
- **Unset state:** no segments filled. All segments render with `bg-muted` fill + `text-muted-foreground` numerals.
- **Selected state (score = N):** segments 1..N fill with `bg-primary` (gold) and their numerals flip to `text-primary-foreground`; segments N+1..10 stay `bg-muted` with muted numerals. The tapped segment (N) fires `animate-score-pop` on press — not the whole bar, just the segment the user touched, so the animation reinforces the tap point.
- **Interaction:**
  - Tapping segment N while unscored → score becomes N (1..N fill).
  - Tapping segment M while score is N (M ≠ N) → score becomes M. If M > N, additional segments fill; if M < N, segments M+1..N clear.
  - Tapping segment N while score is N → **clears** the score (returns to unset). Rationale: no separate "clear" control needed; matches the previous grid's tap-to-clear affordance.
- **Scored definition:** a category is considered scored whenever any segment is in the filled state. The progress bar in §8.1 and the per-contestant chip in §8.8 count only categories in this state.
- **No per-row anchors:** the 1/5/10 anchor copy lives behind the §8.1 header **scale ⓘ** icon, not under every row. Removes ~15 lines of repeated text per voting card for a 5-category template.
- **Why the change from the 5×2 grid:**
  1. *Single row on every viewport* — the 5×2 wrap made narrow screens feel cramped and broke the "scale" mental model by splitting 5 and 6.
  2. *Cumulative fill communicates "N out of 10" at a glance* — closer to how humans think about scores ("I'd give it a 7") than a discrete checkbox grid.
  3. *Numbers stay visible inside segments* — viewers never have to count bars, avoiding the common failure mode of pure progress-bar-style pickers.
  4. *Same tap semantics and same reducer* — the underlying `nextScore(current, clicked)` function from the grid implementation ports directly; only the render changes.

### 8.3 "I missed this" button
- Shown per-contestant in the footer.
- Tap → contestant is **immediately** marked `missed: true` (no modal — modals interrupt live-viewing flow). A bottom-of-screen toast confirms: *"Marked missed — we'll estimate your scores as ~[projected average]. Undo"*. The toast's "Undo" reverts the action for 5 seconds; after the toast dismisses, the user can still leave the missed state via a **"Rescore" button on the missed-state card**.
- Card shows a distinct "missed" state with the estimated score displayed as `~7` (with tilde prefix, dimmed/italic).
- The projected-average shown in the toast is the user's mean score across their non-missed categories at that moment, rounded to 1dp — matches the live value in §8.4. If the user has no other votes yet, it shows as `~5`.
- "Missed" state is visually clear but not shameful — just a fact.

### 8.4 Projected score display
- Visible **only** on entries marked `missed: true`
- Computed as: user's average score per category across all their non-missed votes
  - e.g. if user has voted on 5 entries and their avg vocals is 6.2 → projected vocals = 6 (rounded)
- If user has voted on 0 entries: all projected scores default to 5
- Shown inline on the missed card, clearly labelled "Estimated" with `~` prefix
- Updated live as the user votes on more entries (Supabase Realtime subscription on own votes table). When a projected value changes, the cell fires `animate-score-pop` and a small inline label *"updated from your recent votes"* fades in for ~2s — so the user understands the number shifted because of their own activity, not a server error.
- Once voting closes, projected scores are finalised as the actual filled values — displayed without the `~` in results

### 8.5 Autosave
- Every score-button press (§8.2) or other voting-state change (missed toggle, hot-take edit) triggers a debounced save (500ms) via `UPSERT` to `votes` table.
- **Save indicator** in the header corner is a three-state chip:
  - `Saving…` — request in flight (visible while the debounced request is unresolved).
  - `Saved` — all changes in sync (persistent, not a 1s fade). Small check icon.
  - `Offline — changes queued` — client could not reach the server. Offline queue is held in memory (V1) and on `localStorage.emx_offline_queue` (survives tab reload within the same session).
- **Offline UX:**
  - A one-line banner appears at the top of the voting view when `navigator.onLine === false` *or* three consecutive saves have failed: *"You're offline — changes will sync when you reconnect."* The voting UI remains fully interactive.
  - On reconnect: drain the offline queue in order (oldest first). Each queued write carries the contestant id, the category (or missed/hot-take flag), the client-side timestamp, and a `queuedAtRoomStatus` snapshot.
  - Banner and chip clear once the queue drains successfully.

**8.5.1 Conflict reconciliation (server-wins, consolidated UX):**
- A conflict = a queued write whose `updated_at` is earlier than the server's current `updated_at` for the same `(room_id, user_id, contestant_id)` row. Server value wins; the queued delta is discarded.
- **Consolidated toast** replaces per-conflict toasts. When the drain completes, the client surfaces a single summary toast if any conflicts occurred: *"N offline edits couldn't be applied (newer values on the server). Tap for details."* Tapping opens a modal listing the contestant + category for each skipped write. Rationale: a reconnect after 15 queued edits should not trigger 15 stacked toasts.
- If **zero conflicts** during drain: no toast. The `Saved` chip is signal enough.
- Queued writes of *"I missed this"* or *"hot-take edit"* follow the same reconciliation path — any later server-side value wins.

**8.5.2 Offline queue vs. room status transitions:**
While the client was offline, the admin may have transitioned the room out of `voting`. The queued writes target a state that no longer accepts them.
- On drain, each write validates the current `rooms.status`:
  - If status is `voting` or `voting_ending`: write proceeds through normal UPSERT + conflict check.
  - If status is `scoring` / `announcing` / `done`: the server **rejects the write with HTTP 409** `{ code: "room_voting_closed" }`. Client discards the queued entry.
  - If `queuedAtRoomStatus` was `voting` and current is `announcing` (i.e. the user missed the end-of-voting entirely): the entire drain is aborted after the first 409, and a single *"Voting ended while you were offline — your unsaved changes for this room were discarded"* toast is shown. The offline queue is cleared for that `roomId`. The user's already-submitted pre-offline votes are retained (they're on the server). Rationale: trying to drain 10 locked writes is noisy and useless.
- Writes for a different `roomId` (unlikely but possible) drain normally.

**8.5.3 Queue size limits:**
- Max 200 queued operations per room. On overflow, the oldest entries are evicted and a persistent banner warns *"Too many offline changes — oldest may be lost. Reconnect to save."* Unlikely in practice but prevents unbounded localStorage growth.

### 8.6 Navigation
- **Slim icon footer (~44 px tall):** four icon-only controls in order — `← Prev` · `👻 I missed this` · `☰ Jump-to` · `Next →`. Each carries an `aria-label` for screen readers and reveals a tooltip on long-press; no inline text in the default state. Replaces the earlier text-button row to claw back vertical space (§8.1 no-scroll target).
- Swipe gesture also works (left = next, right = prev).
- **Swipe only activates outside the category score-button area** — horizontal swipes initiated on a score row do not trigger navigation (prevents accidental nav while users are selecting scores). The header, footer, between-row gaps, and hot-take area are all valid swipe origins.
- Running order determines default sequence.
- If admin broadcasts "now performing", UI shows the opt-in pill per §6.5; user can navigate back.
- Progress indicator: number of scored entries / total entries shown in header (see §8.1 for the separation from the running-order indicator).

### 8.7 Hot takes
- Optional per-contestant free-text field below the score rows (§8.2).
- **Collapsed by default behind a *"+ Add a hot take"* pill button.** Tap → the input expands inline with focus and the keyboard opens. Once a hot-take is written and saved, the pill is replaced by the rendered hot-take text + a small edit/delete affordance row (§8.7.1, §8.7.2) — no extra "+" tap needed to edit. Rationale: ~80 px of vertical space reclaimed on the typical voting card where most users skip the hot-take.
- 140 character limit, emoji-aware (emoji count as 2 chars). A live counter renders below the input as `120 / 140`; the counter switches to `text-accent` (hot pink) once the user is within 10 characters of the limit, and the input visibly clamps at 140 (extra keystrokes do nothing).
- Placeholder: *"Your one-liner"*.
- Shown in results screen next to user's avatar.
- Can be left blank; shown only if filled.

**8.7.1 Editing after submission:**
- A hot-take's author can edit their hot-take at any point until room status leaves `voting` / `voting_ending`. Edits debounce-save identically to scores (§8.5).
- Each edit updates `votes.hot_take_edited_at` (new column, §13). If `hot_take_edited_at > hot_take_created_at`, the hot-take renders with a small trailing tag *"edited"* (locale key `results.hotTake.edited`) on both the results screen and any mid-show surface that displays it.
- Once the room transitions to `scoring`, hot-takes are frozen — no further edits. Rationale: published text shown to the group shouldn't change silently.

**8.7.2 Deletion by author or admin:**
- The hot-take's **author** can tap a small trash icon next to their own hot-take (visible only in edit mode on the voting card) to delete it. Confirmation: *"Delete this hot-take?"* with Cancel/Delete. Deletion sets `votes.hot_take = NULL`, leaves the rest of the row intact, and clears `hot_take_edited_at`.
- The **room owner or co-admin** (§6.7) can delete any hot-take from the results screen or mid-show from the hot-takes drawer. A trash icon appears on hover/tap for admin-eyed rows. Confirmation modal: *"Delete [User]'s hot-take? They won't be notified."* — matching the user's "silently" directive.
- Admin deletions log `deleted_by_user_id` and `deleted_at` in a new optional column pair (§13). No separate audit table in MVP.
- Once deleted, the hot-take is gone — no "deleted hot-take" placeholder renders. The user's avatar still shows their scored points as normal.
- Deletion is permitted during `voting`, `voting_ending`, `scoring`, `announcing`, and `done`. Rationale: moderation needs to work at any point, including post-show on the shareable results link.

### 8.8 Per-contestant "scored by N / M" chip

Every contestant card (and every row in the jump-to drawer from §8.1) shows a compact chip indicating how many room members have scored that contestant in every category:

- Chip format: `N / M scored` where `N` = number of members with all categories scored (not counting `missed`), `M` = total room members.
- Placement: top-right of the contestant's card content area, and at the right edge of each row in the jump-to drawer.
- Colour ladder:
  - `0 / M` — `text-muted-foreground` (neutral).
  - `1 ≤ N < M` — `text-muted-foreground` with the numeric N in `text-foreground`.
  - `N = M` — `text-primary` (gold) with a check glyph: `✓ all scored`.
- **Data source:** the server broadcasts `voting_progress` (§15, already spec'd — count only, not scores) for each user. Clients maintain per-contestant counts from the aggregated stream. No additional endpoint.
- Updates in realtime via the same `room:{roomId}` subscription.
- Purpose: answers "am I the slow one?" and lets guests see at a glance which contestants still need scores if they're trying to vote for their own missed ones via the jump-to drawer.
- Users marked `missed: true` for a contestant do **not** count toward `N` — only fully-scored members count, consistent with the §8.2 "scored definition".

### 8.9 Screen wake lock

Phones aggressively sleep during a multi-hour show. The voting view and the `/present` screen both request the Screen Wake Lock API to keep the display awake while relevant.

- **Voting view** (`/room/{id}` when `rooms.status ∈ { voting, voting_ending }`): acquire wake lock on mount, release on unmount or status transition out of voting.
- **Present screen** (`/room/{id}/present`, §10.3): acquire wake lock on mount, release on unmount. Held throughout lobby → voting → scoring → announcing → done.
- Use `navigator.wakeLock.request('screen')`. Wrap in a feature-detection check; on browsers without support (older Firefox, some iOS versions), silently no-op — no error toast.
- If the lock is released by the browser (user switches tabs, phone lid closes, etc.), re-acquire automatically on `visibilitychange` → visible. Listen for `wakeLock.onrelease` to detect the release.
- Never hold the wake lock on `/` , `/create`, `/join`, `/results/{id}`, or during `rooms.status = 'lobby'` — no reason to prevent the phone from sleeping during idle phases.
- No user-visible toggle in MVP (implicit). A "disable wake lock" toggle is deferred to V2 if battery complaints emerge.

### 8.10 Calibration drawer & soft lock-in

A 3-hour Eurovision broadcast produces real **scale drift**: the 8/10 a guest gave to act 2 may bear no relation to the 8/10 they gave to act 19. This section defines the always-available *recalibration* surface plus an admin-side *soft prompt* and *lock counter*, without introducing a new room-status state machine — calibration layers on top of `voting` / `voting_ending` and never blocks the flow.

**8.10.1 Calibration drawer (per user, always available)**

- Entry point: a header icon button (⚖️ or list-icon, locale label `voting.calibration.openButton`) on `/room/{id}` whenever `rooms.status ∈ { voting, voting_ending }`. Opens a full-height bottom sheet titled *"Review your scores"* (locale key `voting.calibration.title`).
- **Layout:** vertical list, one row per scored contestant in running order. Each row shows: flag · country · song · the user's per-category score chips · the user's overall **weighted score** (the same number computed by §9.2 for a hypothetical end-of-voting). For `missed: true` contestants the row shows `~estimated` chips dimmed-italic per §8.4. For unscored contestants the row appears greyed at the bottom of the list with a *"Not scored yet"* tag and a "Score now" button that closes the drawer and navigates to that card.
- **Inline edit:** tapping any score chip opens an in-place mini fill-bar (the same component as §8.2, condensed). Edit → debounced save per §8.5. Edits propagate via Realtime to the user's other devices and to the admin's lock counter (any edit auto-unlocks; see §8.10.3).
- **Filters:** two pills above the list — *"Highest scores"* (sorts the user's scored contestants by weighted score descending; helpful for spotting a 10 that no longer feels like one) and *"Lowest scores"* (ascending; helpful for spotting a too-harsh early score). Tap a pill to toggle; default sort is running order.
- **Lock CTA at the bottom of the drawer:** a sticky-footer button reading either:
  - *"🔒 Lock my scores"* — when the user's `room_memberships.scores_locked_at IS NULL`. Tap → calls `POST /api/rooms/{id}/lock-scores` (§14), which sets the timestamp and broadcasts `scores_locked` (§15). Drawer remains open; button flips to the second state below.
  - *"🔓 Unlock to edit"* — when the user is currently locked. Tap → calls `POST /api/rooms/{id}/unlock-scores`, clears the timestamp, broadcasts `scores_unlocked`. Note: locking is **advisory** — a locked user can still edit scores from the drawer or the voting cards; any score edit while locked auto-calls the unlock endpoint server-side, so the lock counter remains an honest signal of "who's actually still polishing their votes". The `Lock` chip in the page header (§8.1) mirrors the drawer's button state.
- **No timer.** Calibration is never time-bounded for users; the only bound is the admin's eventual "End voting" tap (§6.3.1), which still has its own 5-second undo countdown.

**8.10.2 Admin "Prompt review" broadcast**

- A button labelled *"Prompt everyone to review"* (locale key `admin.calibration.promptButton`) lives in the admin control panel on `/room/{id}` while `rooms.status ∈ { voting, voting_ending }`. Owner-or-co-admin only (§6.7).
- Tap → calls `POST /api/rooms/{id}/calibration/prompt` (§14). Server broadcasts `calibration_prompt` (§15) with `{ promptedAt: ISO }`. Admin gets a 2-second confirmation toast.
- Each guest's client renders a one-time toast (locale key `voting.calibration.promptToast`): *"⏰ Final chance to recalibrate — review your scores"* with an inline *"Open review"* CTA that opens the calibration drawer. Toast auto-dismisses after 6 s; the inline CTA persists in a small banner above the score rows for 60 s after the prompt arrives.
- **Soft only.** No countdown. No auto-close. No forced drawer-open. No effect on `voting_ends_at`. The admin can re-prompt — each broadcast is independent and shows a fresh toast.
- Rate limit: server rejects a re-prompt within 30 s of the previous one with HTTP 429 (avoids prompt spam if the admin double-taps).

**8.10.3 Admin lock counter & roster**

- The admin's header on `/room/{id}` during `voting` / `voting_ending` shows a live chip: `🔒 N / M locked` (locale key `admin.calibration.lockCounter` with `{locked}` and `{total}`). Updated in realtime from `scores_locked` / `scores_unlocked` broadcasts; rebuilt on reconnect from `room_memberships`.
- Tap the chip → opens the **lock roster panel**: list of every room member with avatar + display name + lock state (`🔒 Locked at HH:MM` or *"Editing"*). Greyed rows for users who unlocked. Updated live.
- Purpose: the chip answers "can I end voting yet?" at a glance; the roster lets the admin nudge specific holdouts ("Anna, you good?") face-to-face in the room. No in-app DM. The admin still presses "End voting" manually when ready — the lock counter never auto-triggers a state transition.
- **Auto-unlock invariant:** any vote write (score change, missed toggle, hot-take edit) by a locked user clears `scores_locked_at` server-side as part of the same UPSERT transaction. Both `votes` row and `room_memberships` row are updated atomically; broadcast emits `scores_unlocked` to all subscribers (and the user's own device, which updates the header chip). Rationale: a locked counter that doesn't reflect actual voting state is worse than no counter.

**8.10.4 Reset on lifecycle transition**

- On `voting → voting_ending`: locks are preserved (the 5 s undo window may still produce edits, which auto-unlock as above).
- On `voting_ending → scoring`: `scores_locked_at` is no longer meaningful (votes are frozen) and is left as-is for audit purposes; the chip and drawer surface vanish with the §6.3 *"Tallying results…"* shimmer.
- Late joiners (§6.3.2) start with `scores_locked_at = NULL` like everyone else.

**8.10.5 Why no new room status**

This pattern was chosen over a dedicated `calibrating` lifecycle state because (a) the pain point is *anywhere in the show*, not just at the end — having the drawer always available solves the act-2 vs. act-19 drift even before "End voting" is in sight, (b) avoiding a state-machine fork keeps the §6.3.1 voting-undo flow simple, and (c) lock-in is *advisory* — no schema enum churn, just one nullable timestamp on `room_memberships`.

### 8.11 End-of-voting affordance (last-contestant signal)

When a guest reaches the last contestant in the running order, the screen needs to tell them where they are in the flow — currently the experience just runs out without any signal that they've finished.

#### 8.11.1 Trigger gating (revised 2026-05-02)

Showing the warning the moment a user *lands* on the last contestant — before they've even tapped a score — felt premature. Users complained that the "you missed N" / "all scored" copy appeared before they had any context, blowing past the actual scoring task. The affordance now gates on three OR'd conditions, evaluated whenever the user is viewing the last contestant:

- **(a) Self-finished trigger** — the current user has fully scored or marked missed every category on the last contestant (i.e. their own vote on it is "complete"). This is the most common path — the user finishes the last card and sees the affordance as the natural "what now?".
- **(b) Room-momentum trigger** — **more than half** of the eligible voters in the room have fully voted on the last contestant. Surfaces the affordance to a user who hasn't finished their own vote yet, gently nudging them to wrap up because the room is converging.
- **(c) Room-finished trigger** — every eligible voter has fully voted on every contestant. Shown to anyone still on the last card after the room is materially done; lets the host know they can end voting and keeps stragglers from dawdling.

If none of (a)/(b)/(c) hold, **the affordance is suppressed entirely** — the user sees the regular last contestant card with no extra chrome. As soon as any condition flips true, the appropriate variant (below) renders without an animation transition.

`(b)` and `(c)` require knowing room-wide vote completion per contestant. This consumes the `voting_progress` broadcast (already specified at the data layer in §8.8 for "N/M scored" chips) — when (b)/(c) UI lands, the broadcast must include enough state to derive "did user X finish contestant Y" for every (X, Y). Lightest payload: extend `voting_progress` with `{ contestantId, completedUserIds: string[] }`. Falling back to a single periodic refetch is acceptable if broadcast extension is deferred. (a) is purely client-local and ships independently.

#### 8.11.2 Render variants

**Render** the affordance as a card *below* the contestant card (or replacing the prev-button slot in the footer when on the final contestant). Variant is chosen by role × user state:

**Guest variants** (driven by user's own vote state, gated per §8.11.1):

- **All N contestants scored, no `missed=true` rows:** *"✅ All N scored — waiting for {admin} to end voting."* Shown as a green-tinted card with the admin's avatar + name. No CTA.
- **Some contestants `missed=true`, none unscored:** *"⚠️ You marked M as missed — they'll be filled with your average. Tap to rescore any."* Lists each `missed=true` contestant with flag + country and a **Rescore** quick-jump that opens the contestant card.
- **K contestants completely unscored:** *"⚠️ K still unscored — [Albania] [Belgium]…"* with quick-jump links per unscored contestant. Banner persists until all are scored or marked missed.
- **Room-momentum-only (current user not finished, ≥50% of room is)** — different copy that nudges the laggard rather than congratulates them: *"⏳ Most of the room has finished — you have K still to score."* With the same quick-jump list to unscored contestants. Distinct from the K-unscored variant above (which fires from condition (a) — the user finished but is missing earlier picks); this fires from condition (b).

**Host variant (admin-only, replaces guest copy):**

When the viewer is the room owner (or co-admin per §6.7) and the gating triggers, the affordance switches to a host-facing card that surfaces the actionable next step instead of a "wait for admin" wait state:

- **All-room-finished (condition (c)):** *"🎉 Everyone's done — ready to end voting?"* with a primary **End voting** CTA inline (same target as the existing header chrome End-voting button per §6.3.1).
- **Most-but-not-all-finished (condition (b), <100% complete):** *"⏳ {readyCount} of {totalCount} have finished — give the rest a moment, then end voting."* Same End-voting CTA, but secondary-styled to discourage premature taps.
- **Self-finished only (condition (a), host's own vote done, room not converged):** *"✅ Your vote is in — {readyCount} of {totalCount} done so far."* No End-voting CTA at this stage (cuts the room off too early); the existing header chrome End-voting button stays available for force-end.

The host always sees their own (a) / (b) / (c) state — never the guest "waiting for admin" copy.

**Count semantics — no degenerate `1 of 1` fallback.** The `{readyCount} of {totalCount}` substitution requires room-wide completion data (condition (b) / (c) signals). In MVP the substitution is sourced from per-contestant `voting_progress` broadcasts accumulated client-side plus `room.memberships.length`. **If room-wide data is unavailable** (e.g. broadcasts haven't landed yet, or the host opens the page after voting started and hasn't seen prior broadcasts) the host MUST see a degenerate-safe copy variant — drop the count entirely, render *"✅ Your vote is in."* — rather than render the misleading *"1 of 1 done so far"* implied by single-user defaults. Same for `host.mostDone`: drop the count when total is unknown rather than print a misleading fraction. The host's variant must never paint the room as smaller than it is.

#### 8.11.3 Implementation notes

The affordance is **client-side rendered**. (a)-driven variants use existing local data (`seedScoresFromVotes` / `seedMissedFromVotes`). (b)/(c)-driven variants need room-wide completion state — see §8.11.1. Distinct from §8.10's `lock-scores` flow: that's the admin-facing "I'm done" data signal; this is the user-facing "what now?" UI signal at the last contestant. Both are needed.

**Locale keys** (English) under `voting.endOfVoting.*`:
- `allScored` — *"✅ All {count} scored — waiting for {admin} to end voting."*
- `missedSome` — *"⚠️ You marked {count} as missed — they'll be filled with your average."*
- `unscoredCount` — *"⚠️ {count} still unscored"*
- `roomMomentum` — *"⏳ Most of the room has finished — you have {count} still to score."*
- `rescoreCta` — *"Rescore"*
- `jumpToCta` — *"Score now"*

Host variants under `voting.endOfVoting.host.*`:
- `allDone` — *"🎉 Everyone's done — ready to end voting?"*
- `mostDone` — *"⏳ {ready} of {total} have finished — give the rest a moment, then end voting."*
- `selfDoneOnly` — *"✅ Your vote is in — {ready} of {total} done so far."*
- `endVotingCta` — *"End voting"* (reuses §6.3.1 modal flow)

---

## 9. Scoring engine

Runs server-side as a Next.js API route: `POST /api/rooms/{roomId}/score`
Triggered by admin pressing "End voting". Transitions room from `voting` → `scoring` → `announcing`.

### 9.1 Missed entry fill
For each user × contestant where `missed: true`:
```
For each category C:
  userScoresForC = all non-missed votes by this user, values for category C
  if userScoresForC.length > 0:
    fill = round(mean(userScoresForC))
  else:
    fill = 5
  write fill to votes[user][contestant][C]
```
The `missed: true` flag is retained — filled values are stored but the record stays tagged.

### 9.2 Weighted score per user per contestant
```
weightedScore = Σ(categoryScore[C] × weight[C]) / Σ(weight[C])
```
Where weights are defined by the room's category configuration. Blank weights default to 1.

### 9.3 Rank → Eurovision points mapping (per user)
Sort all contestants by `weightedScore` descending. Assign points:
```
Rank 1  → 12 points
Rank 2  → 10 points
Rank 3  →  8 points
Rank 4  →  7 points
Rank 5  →  6 points
Rank 6  →  5 points
Rank 7  →  4 points
Rank 8  →  3 points
Rank 9  →  2 points
Rank 10 →  1 point
Rank 11+ →  0 points
```

### 9.4 Tie-breaking (within a single user's ranking)
When two contestants share identical `weightedScore`:
1. Highest single-category score across all categories (peak performance)
2. Count of categories scored above 7 (breadth of quality)
3. Alphabetical by country name (deterministic fallback)

### 9.5 Final leaderboard
Sum all users' points per contestant:
```
finalScore[contestant] = Σ(points[user][contestant]) for all users
```
Sort descending → final leaderboard. All results written to `results` table.

---

## 10. Results & announcement

### 10.1 Instant mode
1. Each user sees **their own** results first:
   - Their Eurovision points list (who they gave 1 through 12), revealed 1 → 12 one at a time as the user taps.
   - Their hot takes displayed per country.
   - The **group leaderboard is locked** on this screen until either all users are ready or the admin overrides — users can see only their own picks, preserving the reveal moment.
2. **"I'm done"** button (revised 2026-05-02) — copy must **not** include the word *"reveal"* and must **not** suggest that tapping the button will show anything. Tapping a button labelled *"I'm ready — show the leaderboard"* (the previous copy) created the wrong mental model: users expected the leaderboard to appear immediately and were confused when nothing happened. The new framing is honest — the user is signalling readiness to the host, not triggering a reveal. Suggested copy: *"I'm done — let the host know"* (button face) with a secondary line *"The host reveals when everyone's set."* under it. Admin sees a count of users who are ready (e.g. *"4 / 6 ready"*) — see step 3 for the admin's reveal CTAs.
3. Admin reveal triggers (three CTAs that materialise progressively on the admin's surface):
   - **"Reveal final results"** (primary) — enabled once **all** users mark ready.
   - **"Reveal anyway"** (secondary) — enabled earlier, when **either** ≥½ the room has marked ready **or** 60 s has elapsed since the first-ready event, whichever comes first.
   - **"Admin override — reveal now"** (tertiary, destructive-style) — available to the admin **unconditionally at any time**, including before anyone marks ready. Rationale: if the whole room is AFK or a guest rage-quits, the admin must always be able to progress the show. Confirmation modal: *"Reveal the results right now? No one will be waited for."* — cancel / confirm.
4. **Reveal-unlock countdown.** The admin's surface renders a live micro-counter next to the "Reveal anyway" CTA showing when it will unlock, e.g. *"Reveal anyway — unlocks in 0:22"* (counting down from the 60-second first-ready timer) or *"Reveal anyway — ready (3 / 6)"* (once ≥½ condition holds). This prevents the admin from sitting on a disabled button without knowing why. The "Admin override" CTA has no countdown — it's always active.
5. On reveal → animated worst-to-best reveal of the group leaderboard.
6. After leaderboard: awards screen (§11). If the room uses bets (§22), the bet-resolution gate runs between the leaderboard reveal and the awards screen — see §22.5.

### 10.2 Live announcement mode
The "announce screen" (`/room/{roomId}/present`) is a dedicated fullscreen route, optimised for AirPlay/screen mirroring — no navigation chrome, designed for a TV.

**Flow:**
1. Random user order determined server-side and stored in `rooms.announcement_order` (array of userIds).
2. First user's turn begins. Their screen shows:
   - *"You're announcing! Give your points from lowest to highest."*
   - Their points list (1 through 12), revealed one at a time.
   - A tap-to-advance zone (see below).
3. **For each point reveal, three surfaces show different content:**

   | Surface | Top | Middle | Bottom |
   |---|---|---|---|
   | **Announcer's phone** | Remaining points to give — e.g. *"Still to give: 7, 8, 10, 12"* | *"[N] point(s) go to… [Country] [flag]"* reveal line | Full live room leaderboard with rank-shift animation — so the announcer can watch the effect of their reveal |
   | **Present (TV) screen** | Label: *"[User] is announcing"* with avatar | Current reveal as a large overlay that fades after 3s | Full leaderboard with `animate-rank-shift` as scores update |
   | **Other guests' phones** | Label: *"[User] is announcing"* | Current reveal as a toast that auto-dismisses after 3s | Compact live leaderboard |

4. **Advancing the reveal:** the announcer has **two redundant controls**, either of which progresses to the next point:
   - An explicit large **"Reveal next point"** button (primary, full-width, min 56 px tall) near the bottom-centre of the announcer's screen. Always visible, always labelled. This is the canonical affordance — first-time announcers will find it without tutorial.
   - A **tap-anywhere zone** covering the full lower half of the announcer's screen, which fires the same advance. Redundant with the button, present because the button alone can be fumbled under pressure (phone held loose, gesture overshoot).
   - An optional **3-second auto-advance** fires after each reveal. A persistent *"Hold"* control (top-right corner of the lower tap zone) pauses auto-advance indefinitely while the announcer narrates. "Hold" is sticky — tap once to enable, again to release.
   - All three controls advance via the same `POST /api/rooms/{roomId}/announce/next` endpoint.
5. After announcing all 12 points: *"Finish announcement"* button (primary, full-width).
6. Next scheduled user starts their announcement (per `rooms.announcement_order`).
7. **Admin handoff semantics:**
   - The admin sees an **announcer roster** panel — a list of every user in the room with a presence dot (green = seen in last 30s via the room broadcast channel, grey otherwise). Any user can be handed off to the admin from this panel at any time.
   - "Announce for [User]" is **proactively offered** to the admin when the current announcer has not advanced within 30 seconds of their turn starting or their last reveal. The admin can also invoke it unprompted from the roster.
   - On takeover, `rooms.announcing_user_id` remains the original user (the points still belong to them for the record). A new column `rooms.delegate_user_id` is set to the admin. The admin advances from the current `current_announce_idx` — the user's already-revealed points are **not** re-revealed.
   - If the original user returns mid-delegation, they see *"Admin is announcing for you"* and are not offered control back in MVP (deferred to V2).
   - `POST /api/rooms/{roomId}/announce/handoff` sets `delegate_user_id`. `POST /api/rooms/{roomId}/announce/next` accepts advances from either `announcing_user_id` or `delegate_user_id`.
8. After all users finish: transition to awards screen.

**Realtime mechanism:**
- Announcement state stored in `rooms` table: `announcing_user_id`, `delegate_user_id`, `current_announce_idx`.
- Each advance tap calls `POST /api/rooms/{roomId}/announce/next`.
- Server updates state, Supabase Realtime broadcasts `announce_next` + `score_update` to all subscribers.
- No client ever drives state — server is authoritative.

**Rejoin during `announcing`:** if a user loses and regains their connection mid-announcement, they land on their current voting/results view and see the **current leaderboard** immediately, followed by a brief *"Catching up…"* label (~1s) so they understand they missed beats in between. The next `announce_next` broadcast resumes the live flow.

#### 10.2.0 Implementation status (interim, Phase 5b.1)

The single-page server-authoritative announce mechanic ships before the dedicated `/present` route lands. Phase 5b.1 (PR #37) covered:

- `runScoring` live-mode init: shuffled `announcement_order`, sets `announcing_user_id` to position 0, `current_announce_idx = 0`. Users with no `points_awarded > 0` rows excluded from the order.
- `POST /api/rooms/{id}/announce/next` orchestrator (`advanceAnnouncement`): authorises announcer + delegate + owner, marks the chosen `results.announced = true`, conditional `(status, announcing_user_id, current_announce_idx)`-guarded room UPDATE (returns 409 `ANNOUNCE_RACED` on concurrent advances), rotation between announcers when a queue is exhausted, transition to `done` after the last announcer's last reveal.
- `POST /api/rooms/{id}/announce/handoff` (`setDelegate`): owner-only, toggles `delegate_user_id` between owner and `null`. Re-broadcasts `status_changed:announcing` to nudge clients to refetch their announcement state.
- Schema: `rooms.delegate_user_id UUID REFERENCES users(id)` shipped via `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`.
- Realtime payloads added: `announce_next { contestantId, points, announcingUserId }` and `score_update { contestantId, newTotal, newRank }`. `status_changed:done` re-broadcast on the show-finished transition.

**`<AnnouncingView>` on `/room/[id]`** is the interim single-surface UI. It distinguishes five render modes by combining `currentUserId`, `announcement.announcingUserId`, `announcement.delegateUserId`, and `room.ownerUserId`:

| Mode | When | Surface |
|---|---|---|
| Active announcer | currentUser is announcer, no delegate | Gradient "🎤 It's your turn to announce!" header + "Up next" preview + Reveal CTA + explainer |
| Active delegate | currentUser is owner, delegate set to self | "You're announcing for {name}" header + "Up next" + Reveal + secondary "Give back control" CTA |
| Passive announcer | currentUser is announcer, delegate set to admin | "The room admin is announcing on your behalf" passive copy |
| Owner watching | currentUser is owner, no delegate, not announcer | Plain announcer label + leaderboard + "Announce for {name}" CTA. **No "Up next" panel — no spoilers.** |
| Guest watching | everyone else | Plain announcer label + leaderboard. No CTAs. |

A "Just revealed" flash card (4.5 s auto-clear) renders to all clients on every `announce_next` broadcast, driven directly from the broadcast payload — independent of the refetch race. A two-tier progress bar shows `Announcer N of M · Reveal X / Y`. The show-finished transition renders a shared `<DoneCard />` (from both `AnnouncingView`'s optimistic local flip and the room page's `phase.room.status === "done"` branch) — so every client converges on "Show's over → See full results" whether they tapped, watched, or reloaded.

**Handoff CTAs are always available** for the owner in 5b.1 (i.e. they don't have to wait 30 s of inactivity to invoke). The 30-s proactive-offer behaviour described in §10.2 step 7 lands later (Phase R4) along with the announcer roster + presence dots.

**Deferred to Phase 5c / R4:**
- The dedicated `/room/{roomId}/present` fullscreen route + three-surface differentiation (announcer phone vs TV vs guest phones).
- Tap-anywhere lower-half advance zone.
- 3-second auto-advance + sticky "Hold" control.
- Animated rank-shift on score updates (`animate-rank-shift`).
- The 30-s proactive handoff offer + the announcer roster panel.
- §10.2.1 absent-user skip / restore / reshuffle / "Finish the show" batch-reveal mode.
- Deterministic shuffle seed for `announcement_order` (`Math.random()` for MVP).

#### 10.2.1 Announcement-order edge cases

The `rooms.announcement_order` array is computed once at the `scoring → announcing` transition (seeded from `room_memberships` where `room_memberships.joined_at <= rooms.voting_ended_at`, shuffled deterministically with a stored seed for reproducibility). Post-snapshot, real-world messiness must not break the flow.

**Users absent at their turn (never connected during announcing):**
- When advancing to the next announcer, the server checks the target user's presence on `room:{roomId}` (last seen ≤30 s).
- If absent: server sets `rooms.announce_skipped_user_ids` (new `UUID[]` column) += this user's id, surfaces *"[User] isn't here — their points are being skipped"* as a brief banner on all clients for 3 s, advances the pointer to the next user.
- **Skipped users' points are NOT revealed in MVP.** Their points still contribute to the final leaderboard (already written during `scoring`) — but the dramatic individual reveal is suppressed. Rationale: keeping the momentum of the show. V2 could offer a "claim your turn" late-rejoin.
- Admin can manually **restore** a skipped user at any time from the announcer roster panel — tapping their row re-inserts them after the current announcer and clears the skip.

**Users who left before `announcing` started:**
- Same treatment as "absent at their turn" — the server's advance-time presence check handles it uniformly, no separate filtering at `announcement_order` construction.

**Admin re-shuffle of announcement order:**
- Before **any** user has revealed **any** point (i.e. `current_announce_idx = 0` AND `announcement_order[0]` has not yet advanced), the admin sees a *"Re-shuffle order"* button in the roster panel. Tapping it generates a new random permutation of the remaining announcers and broadcasts `announcement_order_reshuffled`.
- Once the first announcer has advanced even once, the button is disabled. Rationale: mid-show reorder would rewrite narrative history.

**Original announcer returns mid-delegation:**
- Already covered in §10.2 flow step 7. The returning user sees *"Admin is announcing for you"* and does not get control back in MVP. Deferred to V2.

**All users absent simultaneously:**
- If the server advances and every subsequent entry in `announcement_order` is absent (including any co-admins), the admin is offered *"Finish the show"* — a single large button that transitions the admin into a **batch-reveal mode**: all remaining points for all absent users are revealed in sequence by the admin tapping "Next point" like a normal announcer. Each point is still attributed to the original user in the record (`points_awarded`), just revealed by the admin.
- If the admin is themselves absent at this moment: the room sits in `announcing` until an admin or co-admin reconnects. No auto-termination in MVP. The `/present` screen renders *"Awaiting an admin to continue…"* until then.

**Handoff presence-gate update:**
- The proactive handoff offer (§10.2 step 7, "admin sees 'Announce for [User]' after 30 seconds of no advance") remains. If the current announcer reconnects mid-handoff-offer, the offer dismisses automatically.

#### 10.2.2 Short reveal style — Eurovision 2025-faithful

When a `live`-mode room is configured with `announcement_style = 'short'` (see §6.1), the per-user reveal flow compresses to match the Eurovision 2025 broadcast format: only the **12-point reveal** is live; points 1–8 and 10 are added to the scoreboard automatically the moment that user's turn begins.

This style is opt-in. Default remains `full` (the 1 → 12 flow in §10.2). The choice is set at room creation in §6.1 and is editable in lobby-edit until status leaves `lobby`.

**Per-user turn flow (short style):**

1. The pointer advances to the next user in `rooms.announcement_order`.
2. Server immediately writes their points-awarded rows for points 1–8 and 10 with `announced = true` (a single batch UPDATE, broadcast as one `score_batch_revealed` event with all nine contestants in the payload). On all surfaces, the live leaderboard re-sorts in one animation step.
3. Server holds at this point. The 12-point row stays `announced = false` until the live tap.
4. The announcer's screen now shows a **single CTA: "Reveal 12 points"**. They are expected to tap it *simultaneously with announcing it live* on the TV — the on-screen reveal is intentionally synchronous with their voice, not preceded by it.
5. On tap → server flips the 12-point row to `announced = true`, broadcasts `announce_next` with `points = 12`, and all surfaces render the reveal animation (large country flag/emoji, country name, artist, song — see surface table below).
6. After ~3s of dwell, the next user's turn begins (loop to step 1) — auto-advance, with a *"Hold"* control identical to §10.2 step 4.

**Three-surface render during a short-style turn:**

| Surface | When points 1–8 + 10 land (auto-batch) | When announcer taps "Reveal 12 points" |
|---|---|---|
| **Announcer's phone** | Their personal scoresheet shows points 1–8 + 10 ticked off in one beat (they don't have to do anything). Below it: a single **"Reveal 12 points"** primary CTA (full-width, min 56 px tall) — disabled briefly during the auto-batch animation, then enabled. | The button compresses into a confirmed state ("Revealed ✓"), the rest of the screen replaces with the same 12-point flag/country/artist/song splash the TV shows, scaled for phone. |
| **Present (TV) screen** | Top: *"[User] is announcing"* with avatar. Middle: live leaderboard re-sorts to reflect the nine new points (one rank-shift animation). Bottom: ticker text *"Awaiting their 12 points…"* | Middle: large country flag emoji + country name + artist + song fill the centre of the screen for ~3s. Leaderboard pushes to a smaller strip during the splash. After dwell, returns to leaderboard layout for the next turn. |
| **Other guests' phones** | Compact live leaderboard updates inline (9 rows shifting). Top label: *"[User] is announcing"*. | Compact leaderboard updates with the 12-point delta, plus a transient toast at the top: *"[User] gave 12 to [Country] [flag]"*. Toast auto-dismisses after 3s. |

**Why simultaneous tap-and-speak (not tap-then-speak):** the Eurovision broadcast moment IS the spokesperson saying *"…and 12 points goes to…"* with the on-screen graphic appearing in sync. Pre-tapping breaks the dramatic timing; post-tapping breaks it the other way. The CTA is therefore framed in the announcer's UI as *"Tap when you say it"* (microcopy under the button) so first-time announcers know.

**Realtime mechanism (delta from §10.2):**
- Two distinct broadcast events per turn: one `score_batch_revealed` for the auto-batch (nine contestants), one `announce_next` for the live 12-point reveal.
- All other state (`announcing_user_id`, `delegate_user_id`, `current_announce_idx`, `announce_skipped_user_ids`) is identical to §10.2.
- Server is still authoritative; no client drives state.

**Edge cases (delta from §10.2.1):**
- **Absent announcer at their turn:** the auto-batch still fires (their 1–8+10 still go to the scoreboard so the room sees the contribution), but the 12-point row is suppressed and added to `announce_skipped_user_ids` per §10.2.1. Admin can restore them later from the roster.
- **All users absent simultaneously / batch-reveal mode:** when "Finish the show" is engaged, the admin reveals only the 12-point row per remaining absent user (the auto-batch having already fired for each). One admin tap per user, not 12 — matching the short-style cadence.
- **Mid-turn admin handoff:** the delegate's screen takes over the same "Reveal 12 points" CTA. Auto-batch never re-fires (server-state idempotent on the nine-row UPDATE).

**Host-facing guide:**

`/present` and the create-wizard expose a short, plain-language explainer for the host, since this is the single setting most likely to confuse on first use:

- **Wizard tooltip (next to the "Short reveal — Eurovision style" radio):** *"Just like the real Eurovision: only 12-point reveals are live, the rest tick on automatically. Best on a TV with everyone watching."*
- **Lobby info card** (visible to admin until `voting` starts when style = `short`): *"Short reveal is on. Each spokesperson will only need to reveal their 12 points live. Open `/room/{id}/present` on a TV before voting ends — that's the announcer's stage."*
- **Present-screen first-load overlay** when style = `short` and `rooms.status = 'announcing'` for the first time: a 5-second dismissible banner: *"Short reveal mode — the announcer's phone has a single 'Reveal 12 points' button. Lower scores tick on automatically."*

### 10.3 Presentation screen (`/room/{roomId}/present`)
- Fullscreen, no URL bar ideally (use PWA manifest + `display: standalone`).
- **iOS/Safari fullscreen fallback:** when `display: standalone` and/or the landscape viewport override can't be acquired (common on iOS Safari when not launched from the home screen), the route surfaces a one-tap *"Enter fullscreen"* prompt that triggers `document.documentElement.requestFullscreen()` on the user gesture. Prompt is dismissible and reappears only if the browser exits fullscreen.
- **Screen wake lock** held for the full lifetime of the route (see §8.9).
- Theme is **always dark** regardless of admin's theme preference (see §3.4) — the TV should never flash-bang the room.
- Shows the current live leaderboard: flag + country + running total, sorted by current score.
- Animates rank changes when scores are added (smooth reorder transition, ~300ms, via `animate-rank-shift`).
- Shows whose turn it is to announce and which point value is next.
- Designed for a 16:9 TV-ish aspect ratio but gracefully handles other ratios.

---

## 11. Awards

Computed server-side after scoring. Stored in `room_awards` table. Displayed on a dedicated awards screen after the results reveal.

### 11.0 Implementation status (Phase 6.1 — interim, 2026-04-26)

The compute + persistence + static-rendering halves shipped in Phase 6.1 (PR #39). The cinematic reveal lands later (Phase 6.2).

**Shipped:**
- `src/lib/awards/computeAwards.ts` — pure fn implementing all §11.1 + §11.2 logic. Reuses existing `spearmanCorrelation` / `pearsonCorrelation` from `src/lib/scoring.ts`. Tiebreak rules: 1 winner solo; 2-tied → joint (alphabetical); 3+ tied → top-two alphabetical (documented MVP limitation).
- Schema: `room_awards.winner_user_id_b UUID REFERENCES users(id)` (additive `ALTER TABLE`) for pair / joint-winner storage.
- `runScoring` orchestrator extension — post-`results` UPSERT, computes awards and UPSERTs to `room_awards` with `onConflict: 'room_id,award_key'` (idempotent under retry). Memberships query joins `users.display_name` for the alphabetical tiebreak data.
- `<AwardsSection>` server component on `/results/[id]` between Leaderboard and Breakdowns. Two subgroups: "Best in category" (flag-anchored) and "And the room said…" (the 8 personality awards in §11.3 reveal order). Pair awards render with overlapping dual avatars + caption.

**Deferred to Phase 6.2:**
- Cinematic awards reveal screen on `/room/[id]` after the announcement finishes (§11.3 main flow — tap-to-advance, "Next award" corner button, one-at-a-time pacing).
- The 3-CTA footer ("Copy share link" / "Copy text summary" / "Create another room") on the awards screen. The "Copy text summary" button shipped on the results page in Phase 5a; the awards-screen variant still pends.
- Bet-based awards (§11.2a Oracle, Wishcaster) — gated on R7 `rooms.bets_enabled`, deferred to V2.

**Smoke-test follow-ups (2026-04-26):**
- **Awards card explainers** — the personality awards rely on terms most users won't recognise (Spearman distance, Pearson correlation, "variance"). Each award card on `/results/[id]` and on the cinematic reveal should expose a one-sentence plain-English explanation on tap (tooltip or expandable accordion). Sample copy per key:
  - `hive_mind_master` — *"Your ranking lined up most closely with how the room voted overall."*
  - `most_contrarian` — *"Your ranking diverged most from the room consensus."*
  - `neighbourhood_voters` — *"You two scored countries the most alike."*
  - `the_dark_horse` — *"This act split the room — the most divisive performance of the night."*
  - `fashion_stan` — *"You gave the highest score in the outfit/look category."*
  - `the_enabler` — *"Your 12 points went to the room's overall winner."*
  - `harshest_critic` / `biggest_stan` — *"Lowest / highest average score given across all your votes."*
- Phase 6.2 reveal screen reuses the same explainer copy in the small stat line under each card.

> Award display names and stat labels are translated via the stable `award_key`. See §21.6.

### 11.1 Category awards (one per category)
**Award name:** "Best [Category Name]"
**Winner:** Contestant with the highest mean score for that category across all non-missed votes.
**Tiebreak:** Most voters who gave this contestant a score above 8 in this category.
**Display:** Country flag + song name + mean score rounded to 1dp.

### 11.2 Personality awards

| Award | Logic |
|---|---|
| **Harshest critic** | User with the lowest mean score given across all non-missed votes |
| **Biggest stan** | User with the highest mean score given across all non-missed votes |
| **Hive mind master** | User whose final contestant ranking most closely tracks the group consensus ranking (lowest Spearman distance to group mean ranking) |
| **Most contrarian** | User whose final contestant ranking diverges most from group consensus (highest Spearman distance) |
| **Neighbourhood voters** | The pair of users with the highest pairwise Pearson correlation across all their scores (they voted most alike). Displayed as a **dual-avatar card** — both users' avatars side by side with their display names, captioned *"voted most alike"*. |
| **The dark horse** | Contestant with the highest variance in total scores across all users (most divisive) |
| **Fashion stan** | User who gave the single highest score in the outfit/costume category across all their votes (or the category closest to "outfit" by name if custom) |
| **The enabler** | User whose 12 points went to the overall group winner |

**Spearman distance** = 1 − Spearman rank correlation coefficient. Computed in JavaScript using a simple rank-correlation implementation (no library needed — ~20 lines of code).

**Tiebreaking for personality awards:** if two users tie on any personality metric, both are stored as joint winners (`winner_user_id` + `winner_user_id_b`) and rendered as a joint credit on the card. 3+ way ties resolve deterministically by display-name alphabetical order to pick the top two — a known MVP limitation; full multi-winner support is deferred to V2.

**Pair-award storage (Neighbourhood voters):** the two users of the pair are stored in `winner_user_id` and `winner_user_id_b` (deterministic order: alphabetical by display_name). The awards UI renders this as a dual-avatar card (see §11.3).

### 11.2a Bet-based awards (when `rooms.bets_enabled = true`)

When the room has bets (§22), two additional personality awards are generated alongside §11.2:

| Award | Logic |
|---|---|
| **The Oracle** | User with the most correct bet picks across the room's 3 bets. Ties resolve by who got the highest-odds correct call first (= fewest other users who picked the same direction), then alphabetical display name. |
| **The Wishcaster** | User with the fewest correct bet picks (zero correct is valid). A gentle ribbing award, always paired with The Oracle on the reveal sequence. |

These awards follow the same storage convention as §11.2 — `room_awards.award_key ∈ { 'the_oracle', 'the_wishcaster' }`, `winner_user_id`, `stat_value` (count of correct picks), `stat_label` (locale-keyed). They are only written when `rooms.bets_enabled = true`. The main bet standings (full per-user correctness) live in a **separate bet leaderboard** rendered inside the awards screen (§11.3) and on the shareable results page (§12) — see §22.5.

### 11.3 Awards screen
- Cinematic reveal: one award at a time, admin/presenter taps to advance.
- A small **"Next award"** button is always visible in a corner of the screen (not just a tap-anywhere zone) — so that if the admin fumbles or a guest can't tell where to tap, the control is unambiguously findable.
- Each award: large award name, winner's avatar + display name (or country flag for contestant awards), brief stat shown below.
- **Pair / joint-winner awards** (Neighbourhood voters; 2-way ties on personality awards): rendered as a **dual-avatar card** — both avatars side-by-side, both display names below, single shared stat line. Caption: *"voted most alike"* for Neighbourhood voters; *"joint winners"* for ties.
- **Reveal sequence:**
  1. Category awards (§11.1).
  2. Personality awards in order of increasing "social heat": Biggest stan, Harshest critic, Most contrarian, Hive mind master, Neighbourhood voters, Dark horse, Fashion stan.
  3. **Bet-based awards** if enabled (§11.2a): Wishcaster first, then Oracle — playful before reward. Followed immediately by a **full bet leaderboard** card (not dual-avatar; ranked list of every user with their bet-correctness count and the 3 bets resolved yes/no).
  4. **The enabler** — always the last award; narrative closer.
- After all awards the screen shows four CTAs:
  - **"Copy share link"** — copies the `/results/{roomId}` URL and shows a 2s *"Copied!"* confirmation.
  - **"Copy text summary"** — copies an emoji-formatted leaderboard + bet results (see §12.2) to the clipboard for pasting into group chats. 2s confirmation.
  - **"View full results"** — routes to `/results/{roomId}` so the user can revisit the full leaderboard, per-user breakdowns, and award cards at their own pace. **Required**: the cinematic awards reveal advances unidirectionally and ends on this CTA footer; without an in-flow path back to the static results page, the user has no way to take a closer look at the leaderboard or any individual award once the show is over (other than typing the URL or pulling out their browser history). Shown to everyone.
  - **"Create another room"** — routes back to `/create` pre-filled with the same year/event (admin only; guests see the first three CTAs).

---

## 12. Shareable results

### 12.1 Read-only results page

- Read-only results page: `eurovisionmaxxing.com/results/{roomId}`.
- Accessible to anyone with the link (no auth required).
- Shows: final leaderboard, each user's points breakdown, all awards, all hot takes, bet leaderboard + bet resolutions (if §22 bets enabled).
- Data persists indefinitely (Supabase free tier doesn't auto-delete rows).
- Supabase project kept alive via UptimeRobot pinging `/api/health` every 5 minutes. The endpoint must execute a real Supabase query (not just a static response) — implemented as `supabase.from('rooms').select('id').limit(1)` — so that both Vercel and the Supabase DB stay warm. Pinging the homepage only keeps Vercel warm.
- `/api/health` returns `{ ok: true }` on success or HTTP 503 with `{ ok: false, error }` on failure.

### 12.2 Text summary (copy-paste to group chats)

A results surface that's shareable via a single clipboard paste into WhatsApp / iMessage / Signal / Telegram. The format:

```
🇪🇺 Eurovision 2026 — Grand Final
Our room's top 10:
🥇 🇸🇪 Sweden — 142 pts
🥈 🇺🇦 Ukraine — 128 pts
🥉 🇫🇷 France — 114 pts
4  🇮🇹 Italy — 89 pts
5  🇬🇧 UK — 72 pts
6  🇩🇪 Germany — 65 pts
7  🇪🇸 Spain — 58 pts
8  🇳🇴 Norway — 51 pts
9  🇱🇹 Lithuania — 44 pts
10 🇵🇱 Poland — 39 pts

Bet results (3 / 3 won):
✅ Will Sweden finish top 5?
❌ Will anyone perform barefoot?
✅ Will the winning song be non-English?

Full results: https://eurovisionmaxxing.com/results/abc123def
```

- Rendered by a pure function `formatRoomSummary(room, results, bets): string` living in `src/lib/format.ts`.
- Accessible from **two** places:
  - "Copy text summary" button on the awards screen (§11.3).
  - "Copy text summary" button on the results page header (§12.1).
- 2-second *"Copied!"* confirmation on click.
- Supports the current locale — medal emojis and flag emojis are universal, but the labels *"Our room's top 10"*, *"Bet results"*, *"Full results"* etc. render in the user's `preferred_locale`.
- Always top 10; rooms with ≤10 contestants render the full list.
- Bets section is omitted entirely when `rooms.bets_enabled = false`.

### 12.3 HTML export (standalone file)

Endpoint `GET /api/results/{id}/export.html` returns a self-contained single-file HTML document:

- All CSS inlined in a `<style>` block — no external fetches, no CDN dependencies.
- All data embedded — leaderboard, per-user breakdowns, awards, hot takes, bet results.
- Includes a visible "Generated at {timestamp} from eurovisionmaxxing.com/results/{id}" footer.
- Filename: `emx-{year}-{event}-{pin}.html` (e.g. `emx-2026-final-AC42H7.html`).
- No JavaScript — pure static HTML, opens in any browser, airplane-mode viewable.
- Response headers: `Content-Type: text/html; charset=utf-8`, `Content-Disposition: attachment; filename="..."`.
- Size budget: ≤300 KB for a 15-user / 26-contestant grand final.

### 12.4 PDF export

Endpoint `GET /api/results/{id}/export.pdf` returns a printable PDF:

- Generated server-side via **Puppeteer on Vercel serverless** or, if Vercel's bundle-size limit is a blocker (likely; Puppeteer is ~180 MB), via **`@react-pdf/renderer`** as the fallback implementation — document structure authored as React components in `src/lib/pdf/ResultsDocument.tsx`.
- Layout: cover page (room title, PIN, date, winner) → full leaderboard → per-user breakdowns → awards → bet results → hot takes appendix.
- A4 portrait, 1 cm margins, accessible contrast even on monochrome printers.
- Same filename convention as HTML: `emx-{year}-{event}-{pin}.pdf`.
- **Recommended implementation:** `@react-pdf/renderer` — smaller bundle, no headless-browser cold-start penalty, sufficient for a static document. Puppeteer deferred to V2 only if fidelity gaps emerge.

Both exports reuse the same data-fetching pipeline as §12.1 (uses `GET /api/results/{id}` internally) and require `rooms.status = 'done'`. Earlier status → HTTP 409 `{ code: "results_not_ready" }`.

### 12.5 Results page during pre-`done` statuses

Shareable links may be opened (accidentally or prematurely) while the room is still in `voting` / `voting_ending` / `scoring` / `announcing`. The page must not 404 and must not leak in-flight scores.

| `rooms.status` | `/results/{roomId}` renders |
|---|---|
| `lobby` | Placeholder: *"This room hasn't started voting yet. Check back after the show."* + countdown to `broadcastStartUtc` if known. |
| `voting` / `voting_ending` | Placeholder: *"Voting is still in progress. Results will be available once the admin ends voting."* + "Join this room" CTA (deep-links to `/room/{roomId}` for the standard join flow). |
| `scoring` | Placeholder: *"Tallying results…"* with `animate-shimmer` overlay. Page polls `/api/results/{id}` every 2 seconds and auto-renders the full results on `announcing` or `done`. |
| `announcing` | **Partial results surface** — shows the **current live leaderboard** (points revealed so far) with a banner *"Live — announcements in progress"*. Per-user breakdowns, awards, hot takes, and bet results are all hidden; only the public running total is exposed. Link viewers are NOT participants in the announcement flow (they just see numbers). |
| `done` | Full results per §12.1. |

- Share URL shared during `announcing` gives an evocative "tuning in" experience without spoiling awards.
- Share URL used during `voting` nudges the visitor to join the room (if PIN visible in the placeholder).
- Share URL during `lobby` is safe to copy early — the countdown doubles as a "save the date" surface.
- Exports (§12.3, §12.4) remain gated to `done` — partial exports would be misleading.

### 12.6 Drill-down detail views (post-`done` only)

The full results page (§12.1) ships two drill-down surfaces — one per **contestant**, one per **participant** — so guests can answer the two arguments that always come up after a Eurovision watch party: *"who liked Sweden?"* and *"who did Anna give her 12 to?"*. Both surfaces are read-only and **only available when `rooms.status = 'done'`** — never during `announcing`, to preserve the tension of the live reveal. Drill-downs are surfaced on `/results/{id}` and on `/room/{id}` once the room transitions to `done`. Source data is the existing `votes` + `results` tables — no new endpoint, no new DB shape.

**12.6.1 Contestant drill-down**

- Trigger: tap any row on the leaderboard.
- Modal/sheet header: contestant flag · country · song · artist · final group total (e.g. `🇸🇪 Sweden — 142 pts`).
- Body: a **vertical list, one row per room member**, sorted by `points_awarded` for that contestant descending (so the contestant's biggest fans render first). Each row shows:
  - Avatar + display name.
  - The user's per-category scores as small chips, e.g. `Vocals 8 · Music 7 · Outfit 9 · Stage 8 · Vibes 9`. For `missed: true` rows, chips render dimmed-italic with the `~` prefix per §8.4 — same convention as the voting card.
  - The user's overall **weighted score** for this contestant (`§9.2`, e.g. `8.2`).
  - The **points awarded** by this user (12, 10, 8, 7, 6, 5, 4, 3, 2, 1, or 0), rendered as a small medal-style pill on the right.
  - The user's hot-take (if any), rendered inline below the chip row, with the *"edited"* tag from §8.7.1 when applicable. Deleted hot-takes (§8.7.2) are absent.
- Aggregates pinned at the top of the body: room **mean** weighted score, **median** weighted score, **highest** scorer (avatar + value), **lowest** scorer (avatar + value).
- Always-with-names: no anonymisation in MVP. Rationale: this is friends-watching-together, transparency is the joy.

**12.6.2 Participant drill-down**

- Trigger: tap any user's avatar in the per-user breakdowns section of the results page (§12.1).
- Modal/sheet header: user avatar · display name · their total points awarded (`Σ points_awarded` across all contestants — note this is fixed by the §9.3 rank → points mapping and equal across all users, but rendered for symmetry) · their hot-take count.
- Body: a **vertical list, one row per contestant the user voted on**, sorted by the user's **weighted score** descending (so each user's "their own personal #1" renders first). Each row shows:
  - Contestant flag · country · song.
  - The user's per-category score chips for that contestant.
  - The user's overall **weighted score** for that contestant.
  - The **points the user awarded** to that contestant — the same medal-style pill as in 12.6.1, on the right.
  - The user's hot-take for that contestant (if any), inline below.
- Aggregates pinned at the top: this user's **mean** score given, **harshness rating** (computed as `mean(allUsersMeanScore) − thisUsersMeanScore`, the same metric used by the §11.2 *harshest_critic* award), **alignment with room** (Spearman vs. group leaderboard, the same number used by *hive_mind_master* in §11.2). All numbers reuse the existing scoring primitives — no new math.
- Always-with-names. Visible to anyone with the share link, same authorisation as the rest of `/results/{id}`.

**12.6.3 Category drill-down (post-`done` only)**

- Trigger: tap any **category-award card** in the `<AwardsSection>` on `/results/{id}` (e.g. "Best Vocals" → opens the Vocals drill-down). On the cinematic awards screen (Phase 6.2), the same tap-target pattern applies once the award has been revealed.
- Modal/sheet header: `Best <Category>` heading + the winner-contestant flag/country/song from the award row.
- Body: a **vertical list of every contestant**, sorted by their **mean score in that single category** (across non-missed votes only) descending. Each row shows:
  - Contestant flag · country · song.
  - The **mean** for that category as the primary number (1 decimal place).
  - A bar/sparkline visualising the spread of individual votes for that contestant (min, median, max), so the user can see whether the mean came from broad agreement or a single outlier.
  - Voter count chip — `N/M voted` — accounting for missed entries.
- Aggregates pinned at the top of the body: room **highest single vote** (which user gave it), **lowest single vote** (which user), **mean of means** for the category as a whole.
- Visual differentiation from the contestant-drill-down (12.6.1): the category drill-down is a **single-axis** view (one number per contestant), whereas the contestant drill-down is a **per-user** view (multiple numbers, one user per row). Same component scaffold, different sort key + body row template.
- Reuses the existing `votes` table — no new endpoint, no new aggregation step. The payload extension from 12.6.1 (per-user per-contestant `scores` blob) is sufficient.

**12.6.4 Implementation notes**

- All three drill-downs (12.6.1 contestant, 12.6.2 participant, 12.6.3 category) render from the existing `GET /api/results/{id}` payload — extend it (if needed) to include the per-user per-contestant `scores` blob already in `votes`. No new endpoint.
- HTML and PDF exports (§12.3, §12.4) include drill-down sections **expanded inline** — the print artefact has no interactivity, so each contestant section embeds the per-member rows below the leaderboard, each participant section embeds their per-contestant ranking, and each category-award card embeds the category drill-down ranking inline. The text summary (§12.2) is **unaffected** — keeping it short for chat-paste is the whole point.
- Performance budget: a 15-user / 26-contestant final means 390 (user × contestant) rows total — comfortably within a single client render. No pagination.
- Drill-downs are **suppressed** while `rooms.status = 'announcing'` — the §12.5 "live leaderboard" view shows running totals but no drill-down affordance. The leaderboard rows + award cards simply aren't tappable until `done`.

---

## 13. Database schema

All tables in Supabase (PostgreSQL). Enable RLS on all tables. Use `uuid_generate_v4()` for UUIDs.

### `users`
```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name    VARCHAR(24) NOT NULL,
  avatar_seed     VARCHAR(64) NOT NULL,
  rejoin_token_hash VARCHAR(60) NOT NULL,  -- bcrypt hash
  preferred_locale VARCHAR(5),             -- one of SUPPORTED_LOCALES (§21.1); NULL = auto-detect at next login
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### `rooms`
```sql
CREATE TABLE rooms (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pin                   VARCHAR(7) NOT NULL UNIQUE,
  year                  SMALLINT NOT NULL,
  event                 VARCHAR(6) NOT NULL CHECK (event IN ('semi1', 'semi2', 'final')),
  categories            JSONB NOT NULL,         -- [{name, weight, hint}] — predefined templates additionally include {key, nameKey, hintKey}, see §21.6
  owner_user_id         UUID REFERENCES users(id),
  status                VARCHAR(14) NOT NULL DEFAULT 'lobby'
                          CHECK (status IN ('lobby','voting','voting_ending','scoring','announcing','done')),
  announcement_mode     VARCHAR(7) NOT NULL DEFAULT 'instant'
                          CHECK (announcement_mode IN ('live','instant')),
  announcement_style    VARCHAR(5) NOT NULL DEFAULT 'full' -- §10.2.2 — 'short' compresses the live reveal to a single 12-point tap per user; ignored when announcement_mode = 'instant'
                          CHECK (announcement_style IN ('full','short')),
  announcement_order    UUID[],                 -- ordered array of userIds for live mode
  announce_skipped_user_ids UUID[] DEFAULT '{}', -- users skipped because absent at their turn (§10.2.1)
  voting_ends_at        TIMESTAMPTZ,            -- set when admin taps "End voting"; scoring starts when now() ≥ this (§6.3.1)
  voting_ended_at       TIMESTAMPTZ,            -- set when the voting_ending countdown elapsed and scoring actually began
  announcing_user_id    UUID REFERENCES users(id),
  delegate_user_id      UUID REFERENCES users(id), -- admin delegate during handoff (§10.2); NULL when the original announcer is driving
  current_announce_idx  SMALLINT DEFAULT 0,     -- which point value is being announced
  now_performing_id     VARCHAR(20),            -- contestant id currently performing
  allow_now_performing  BOOLEAN DEFAULT FALSE,
  bets_enabled          BOOLEAN DEFAULT FALSE,  -- when true, the room has 3 bets via `room_bets` (§22)
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
```

### `room_memberships`
```sql
CREATE TABLE room_memberships (
  room_id           UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  joined_at         TIMESTAMPTZ DEFAULT NOW(),
  is_ready          BOOLEAN DEFAULT FALSE,            -- for instant mode "ready to reveal"
  is_co_admin       BOOLEAN DEFAULT FALSE,            -- admin delegate with same powers as owner, except ownership transfer (§6.7)
  scores_locked_at  TIMESTAMPTZ,                      -- soft lock-in for vote calibration (§8.10); NULL = unlocked / never locked. Cleared automatically on any vote write by this user.
  PRIMARY KEY (room_id, user_id)
);
```

### `votes`
```sql
CREATE TABLE votes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id),
  contestant_id   VARCHAR(20) NOT NULL,         -- "{year}-{countryCode}"
  scores          JSONB,                        -- {categoryName: score} NULL if missed
  missed          BOOLEAN DEFAULT FALSE,
  hot_take        VARCHAR(140),
  hot_take_edited_at      TIMESTAMPTZ,          -- set when hot_take is edited after initial save; controls the "edited" tag (§8.7.1)
  hot_take_deleted_by_user_id UUID REFERENCES users(id),  -- NULL unless hot-take was deleted; records the author or admin who removed it (§8.7.2)
  hot_take_deleted_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (room_id, user_id, contestant_id)
);
```

### `results`
```sql
CREATE TABLE results (
  room_id           UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  contestant_id     VARCHAR(20) NOT NULL,
  weighted_score    NUMERIC(5,3) NOT NULL,
  rank              SMALLINT NOT NULL,
  points_awarded    SMALLINT NOT NULL,          -- 0,1,2,3,4,5,6,7,8,10,12
  announced         BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (room_id, user_id, contestant_id)
);
```

### `room_awards`
```sql
CREATE TABLE room_awards (
  room_id         UUID REFERENCES rooms(id) ON DELETE CASCADE,
  award_key       VARCHAR(30) NOT NULL,         -- e.g. "harshest_critic", "the_oracle"
  award_name      VARCHAR(50) NOT NULL,         -- display name (English fallback; real copy via locale key)
  winner_user_id  UUID REFERENCES users(id),    -- null for contestant awards
  winner_user_id_b UUID REFERENCES users(id),   -- second winner slot: used for the Neighbourhood Voters pair and for 2-way ties on personality awards (§11.2). Null otherwise.
  winner_contestant_id VARCHAR(20),             -- null for user awards
  stat_value      NUMERIC(6,3),                 -- the underlying metric
  stat_label      VARCHAR(80),                  -- human-readable stat description
  PRIMARY KEY (room_id, award_key)
);
```

### `room_bets`
```sql
-- One row per bet question attached to a room. Rooms have exactly 3 (when bets_enabled), or 0 (when disabled).
CREATE TABLE room_bets (
  room_id         UUID REFERENCES rooms(id) ON DELETE CASCADE,
  bet_key         VARCHAR(30) NOT NULL,          -- catalog id from §22.1, e.g. "c1_landslide", "a3_pyro"
  display_slot    SMALLINT NOT NULL,             -- 1 | 2 | 3 — ordinal within the room
  resolver_type   VARCHAR(10) NOT NULL           -- 'auto' (closed-loop) | 'manual' (admin-adjudicated)
                    CHECK (resolver_type IN ('auto','manual')),
  resolution      VARCHAR(10)                    -- 'yes' | 'no' | 'unknown' | NULL (unresolved)
                    CHECK (resolution IN ('yes','no','unknown')),
  resolved_at     TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES users(id), -- admin who tapped it, NULL for auto bets
  PRIMARY KEY (room_id, bet_key),
  UNIQUE (room_id, display_slot)
);
```

### `bet_picks`
```sql
-- A user's yes/no guess for a single bet. Created in lobby / re-openable until rooms.status leaves 'lobby'.
CREATE TABLE bet_picks (
  room_id     UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  bet_key     VARCHAR(30) NOT NULL,
  pick        VARCHAR(10) NOT NULL              -- 'yes' | 'no' | 'no_opinion'
                CHECK (pick IN ('yes','no','no_opinion')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id, bet_key),
  FOREIGN KEY (room_id, bet_key) REFERENCES room_bets(room_id, bet_key) ON DELETE CASCADE
);
```

### Indexes

Required for acceptable performance on Supabase free tier:

```sql
CREATE INDEX idx_rooms_pin              ON rooms(pin);
CREATE INDEX idx_rooms_status           ON rooms(status);
CREATE INDEX idx_votes_room_user        ON votes(room_id, user_id);
CREATE INDEX idx_votes_room_contestant  ON votes(room_id, contestant_id);
CREATE INDEX idx_results_room           ON results(room_id);
CREATE INDEX idx_room_memberships_user  ON room_memberships(user_id);
CREATE INDEX idx_room_bets_room         ON room_bets(room_id);
CREATE INDEX idx_bet_picks_room_user    ON bet_picks(room_id, user_id);
```

### RLS policies

**Architecture decision:** all API routes go through Next.js Route Handlers that use the `SUPABASE_SECRET_KEY` service-role client (`createServiceClient()` in `src/lib/supabase/server.ts`). That client **bypasses RLS**, so the policies below exist only as a defence-in-depth against direct client-side Supabase access using the publishable key — never as the primary authorization layer. Authorization decisions (ownership, room membership, admin-only actions) are enforced in the API route handlers.

RLS is enabled on all tables. The MVP ships these policies:

```sql
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE results           ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_awards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_bets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_picks         ENABLE ROW LEVEL SECURITY;

-- Rooms: public read (needed for join-by-pin)
CREATE POLICY "Rooms are viewable by everyone"
  ON rooms FOR SELECT USING (true);

-- Users: public read (display name + avatar only; no sensitive fields exposed)
CREATE POLICY "Users are viewable by everyone"
  ON users FOR SELECT USING (true);

-- Memberships: public read
CREATE POLICY "Room memberships viewable by room members"
  ON room_memberships FOR SELECT USING (true);

-- Votes: public read (filtered by API layer; see note below)
CREATE POLICY "Votes viewable by owner or when room is announcing/done"
  ON votes FOR SELECT USING (true);

-- Results: only readable once the room is in 'announcing' or 'done'
CREATE POLICY "Results viewable when room is announcing or done"
  ON results FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM rooms
    WHERE rooms.id = results.room_id
    AND rooms.status IN ('announcing', 'done')
  ));

-- Awards: only readable once the room is in 'announcing' or 'done'
CREATE POLICY "Awards viewable when room is done"
  ON room_awards FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM rooms
    WHERE rooms.id = room_awards.room_id
    AND rooms.status IN ('announcing', 'done')
  ));

-- Room bets: public read (bet questions are not secret; picks are kept server-authoritative via API routes)
CREATE POLICY "Room bets viewable by everyone"
  ON room_bets FOR SELECT USING (true);

-- Bet picks: readable once the room is in 'announcing' or 'done' (preserves the reveal moment)
CREATE POLICY "Bet picks viewable when room is announcing or done"
  ON bet_picks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM rooms
    WHERE rooms.id = bet_picks.room_id
    AND rooms.status IN ('announcing', 'done')
  ));
```

No `INSERT`/`UPDATE`/`DELETE` policies are created — writes must go through the service-role API routes. Tighter per-user `votes` SELECT policies are deferred to V2 when/if direct client reads become necessary.

### Realtime publication

The Supabase Realtime publication must include these tables so that Postgres-level changes are broadcast to subscribed clients in addition to server-initiated broadcast messages:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_memberships;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE results;
ALTER PUBLICATION supabase_realtime ADD TABLE room_bets;
ALTER PUBLICATION supabase_realtime ADD TABLE bet_picks;
```

All of the above is bundled in `supabase/schema.sql`, which is applied once per Supabase project via the SQL Editor (see SUPABASE_SETUP.md).

---

## 14. API routes

All routes in `app/api/` as Next.js Route Handlers.

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/onboard` | Create new user, return userId + rejoinToken |
| POST | `/api/auth/rejoin` | Validate rejoinToken, return session |
| PATCH | `/api/auth/preferences` | Update user preferences (currently: `preferred_locale`) — see §21.7 |
| GET | `/api/contestants` | `?year=&event=` — fetch with cascade (§5.1) |
| POST | `/api/rooms` | Create room |
| GET | `/api/rooms/{id}` | Get room state |
| POST | `/api/rooms/join-by-pin` | Resolve PIN → roomId, add membership |
| POST | `/api/rooms/{id}/join` | Add user to room |
| PATCH | `/api/rooms/{id}/status` | Admin: transition room status. Accepts `"voting_ending"` to kick off the 5-s undo window (§6.3.1). Returns 409 if the transition is invalid. |
| POST | `/api/rooms/{id}/status/undo` | Admin: revert `voting_ending` → `voting` before the countdown elapses. 409 if `voting_ends_at` has passed or status isn't `voting_ending`. |
| PATCH | `/api/rooms/{id}/now-performing` | Admin: set current performer |
| POST | `/api/rooms/{id}/refresh-contestants` | Admin, lobby-only: re-run the §5.1 cascade and update the room's cached list (§5.1d). |
| PATCH | `/api/rooms/{id}/ownership` | **Owner-only**: transfer `owner_user_id` to another member; old owner becomes a co-admin (§6.7). |
| PATCH | `/api/rooms/{id}/co-admins` | Owner-only: promote/demote a member's `is_co_admin` flag (§6.7). |
| POST | `/api/rooms/{id}/votes` | Upsert a user's vote for a contestant. As a side effect, clears `room_memberships.scores_locked_at` for the writer if set (auto-unlock on edit, §8.10.3) and broadcasts `scores_unlocked`. |
| DELETE | `/api/rooms/{id}/votes/{contestantId}/hot-take` | Delete a hot-take. Author, owner, or co-admin (§8.7.2). |
| POST | `/api/rooms/{id}/lock-scores` | User: set own `room_memberships.scores_locked_at = NOW()`. Allowed only when `rooms.status ∈ { voting, voting_ending }`. Broadcasts `scores_locked`. Idempotent — already-locked is 200 with the existing timestamp. |
| POST | `/api/rooms/{id}/unlock-scores` | User: clear own `room_memberships.scores_locked_at`. Same status guard as above. Broadcasts `scores_unlocked`. Idempotent. |
| POST | `/api/rooms/{id}/calibration/prompt` | Owner-or-co-admin (§6.7): broadcast `calibration_prompt` to the room (§8.10.2). 30 s rate limit per room. 429 on burst. |
| POST | `/api/rooms/{id}/bets` | Admin, lobby-only: set the 3 bet `bet_keys` for the room (§22.2). Replaces any existing set. |
| PATCH | `/api/rooms/{id}/bets/{bet_key}` | Admin-only: resolve an admin-adjudicated bet to `yes`/`no`/`unknown` (§22.5). |
| POST | `/api/rooms/{id}/bet-picks` | User: upsert one or more `bet_picks` rows. Allowed only while `rooms.status = 'lobby'` (§22.3). |
| POST | `/api/rooms/{id}/score` | Admin: trigger scoring engine |
| POST | `/api/rooms/{id}/announce/next` | Advance announcement by one step |
| POST | `/api/rooms/{id}/announce/handoff` | Admin takes over for a user |
| PATCH | `/api/rooms/{id}/announcement-order` | Admin: re-shuffle the announcement order. Only allowed before any advance (§10.2.1). |
| GET | `/api/rooms/{id}/results` | Get full results (room must be 'announcing'/'done') |
| GET | `/api/results/{id}` | Public read-only results (no auth). Status-dependent render per §12.5. |
| GET | `/api/results/{id}/export.html` | Standalone HTML export (§12.3). 409 if room is not `done`. |
| GET | `/api/results/{id}/export.pdf` | PDF export (§12.4). 409 if room is not `done`. |
| GET | `/api/health` | Uptime probe (see §12) — runs a trivial Supabase query and returns `{ ok: true }` or HTTP 503 |

---

## 15. Realtime channels (Supabase)

Subscribe on: `room:{roomId}`

**Transport:** Supabase **Broadcast** — the client subscribes via `supabase.channel('room:{roomId}').on('broadcast', { event: 'room_event' }, handler)`. All `RoomEvent` payloads are sent under the single broadcast event name `room_event`, discriminated by the `type` field. This is implemented in the `useRoomRealtime(roomId, onEvent)` React hook.

Events broadcast by server to this channel:
```typescript
type RoomEvent =
  | { type: 'status_changed'; status: RoomStatus }
  | { type: 'voting_ending'; votingEndsAt: string }  // ISO timestamp for the 5-s undo countdown (§6.3.1)
  | { type: 'user_joined'; user: { id, displayName, avatarSeed } }
  | { type: 'user_left'; userId: string }
  | { type: 'now_performing'; contestantId: string }
  | { type: 'voting_progress'; userId: string; contestantId: string; scoredCount: number }  // per-user per-contestant; count only
  | { type: 'contestants_refreshed'; added: string[]; removed: string[]; reordered: string[] }
  | { type: 'co_admin_changed'; userId: string; isCoAdmin: boolean }
  | { type: 'ownership_transferred'; newOwnerUserId: string; reason?: 'owner_absent_5m' }
  | { type: 'announcement_order_reshuffled'; newOrder: string[] }
  | { type: 'announce_next'; contestantId: string; points: number; announcingUserId: string }
  | { type: 'announce_turn'; userId: string }  // whose turn to announce
  | { type: 'announce_skip'; userId: string; reason: 'absent_at_turn' }
  | { type: 'score_update'; contestantId: string; newTotal: number; newRank: number }
  | { type: 'bet_resolution'; betKey: string; resolution: 'yes' | 'no' | 'unknown' }
  | { type: 'hot_take_deleted'; voteId: string; deletedByUserId: string }
  | { type: 'scores_locked'; userId: string; lockedAt: string }      // §8.10 — user tapped "Lock my scores"
  | { type: 'scores_unlocked'; userId: string }                       // §8.10 — user explicitly unlocked, OR auto-unlock on a vote write
  | { type: 'calibration_prompt'; promptedAt: string; promptedByUserId: string }  // §8.10.2 — admin nudge to review scores
```

In addition, Postgres Changes for `rooms`, `room_memberships`, `votes`, `results`, `room_bets`, `bet_picks` are exposed via the `supabase_realtime` publication (see §13) so clients can optionally subscribe directly for DB-level signals (used as a fallback if a broadcast is missed during reconnect).

Client subscribes on room entry. Unsubscribes on unmount. Reconnect handled by Supabase client library automatically.

---

## 16. Key pages & routes

| Route | Description |
|---|---|
| `/` | Landing page: contest info, fun facts, CTA to create or join |
| `/create` | 3-step room creation wizard |
| `/join` | PIN entry page |
| `/room/{id}` | Main room page (lobby → voting → results, adapts to status) |
| `/room/{id}/present` | Fullscreen announcement screen for TV/AirPlay |
| `/results/{id}` | Public read-only results page |

---

## 17. PWA configuration

`app/manifest.json`:
```json
{
  "name": "eurovisionmaxxing",
  "short_name": "emx",
  "display": "standalone",
  "background_color": "#0a0a14",
  "theme_color": "#0a0a14",
  "orientation": "portrait"
}
```

The `/room/{id}/present` screen overrides orientation to landscape for TV mirroring. Implement via `<meta name="viewport">` adjustment on that route.

The manifest also declares a `description`, a `start_url: "/"`, and two icons (`/icon-192.png`, `/icon-512.png`) served from `public/`.

---

## 17a. Deployment

### 17a.1 Vercel

Repo is connected to Vercel via the GitHub integration — every push to `main` auto-deploys to Production, and every PR gets a Preview URL. The environment variables from §2.1 must be set in Vercel → Settings → Environment Variables for **all three** environments (Production, Preview, Development), then a redeploy triggered so they take effect.

### 17a.2 Custom domain (Cloudflare DNS → Vercel)

Domain `eurovisionmaxxing.com` (and `www.eurovisionmaxxing.com`) is registered and DNS-hosted on Cloudflare, with Vercel handling SSL and CDN.

- **Recommended:** Cloudflare **DNS only** (grey cloud). Add the A / CNAME records Vercel displays under Settings → Domains, with proxy **disabled**. Vercel provisions SSL automatically within ~1–5 min.
- **Alternative:** Cloudflare proxy (orange cloud) + SSL/TLS mode set to **Full (strict)**. Only worth it if the team wants Cloudflare's WAF/cache rules — Vercel already ships a global CDN.

### 17a.3 SUPABASE_SETUP.md

A committed runbook at the repo root walks a new operator from zero to a working stack: creating the Supabase project, copying the publishable + secret keys into `.env.local`, running `supabase/schema.sql`, enabling Realtime on **all six** relevant tables (`rooms`, `room_memberships`, `votes`, `results`, `room_bets`, `bet_picks`), verifying RLS is on, configuring UptimeRobot against `/api/health`, wiring the Cloudflare → Vercel domain, and naming an on-call backup for contestant-data refresh duties (§5.1c). This file is required — it is the handoff doc for anyone running the app independently of the original author.

### 17a.4 CI

Two GitHub Actions workflows:

- **`ci.yml`** — runs on every PR and push to `main`. Steps: `npm ci`, `npm run type-check`, `npm run lint`, `npm run test`. Build check via `npm run build` for the PR workflow only (saves minutes on main).
- **`contestant-api-smoke.yml`** — scheduled daily at 06:00 UTC + on PRs touching `src/lib/contestants.ts` or `app/api/contestants/`. See §5.5 for the test assertions. Failures post to the repo Issues with the `api-upstream` label; do not block the PR.

Both workflows use Node 20 and the same lockfile-locked install. No caching beyond the default `actions/setup-node` npm cache.

### 17a.5 Testing standards

The repo has three layers of automated test, each with a clear scope:

| Layer | Where | Env | Use for |
|---|---|---|---|
| **Pure unit** | `src/lib/**/*.test.ts`, `src/components/**/*.test.ts` | vitest **node** (default) | Pure functions, orchestrators, reducers, anything with deterministic input/output. <50 ms each. |
| **Component (RTL + jsdom)** | `*.test.tsx` co-located with the component | vitest **jsdom** via `// @vitest-environment jsdom` per-file pragma | Render correctness, user interactions (`@testing-library/user-event`), callback signals, branch coverage of state machines that drive a component. Mock `next-intl` and `next/navigation` per-file; matchers from `@testing-library/jest-dom` and the RTL `cleanup` afterEach are wired in `vitest.setup.ts`. |
| **End-to-end (Playwright)** | *(deferred — slot reserved)* | Real browser | Multi-window realtime flows (instant-mode reveal across guest + admin), real `prefers-reduced-motion`, real Supabase round-trips, FLIP / animation visuals. Tracked under Phase 0 backlog; until it ships, those checks live in the manual smoke checklist for each PR. |

**Component tests are required for any new or substantially-modified `*.tsx`** introduced after 2026-05-02. Cover at minimum: initial render, the interactions the component exposes, the callbacks it fires, and any obvious degenerate paths. Skip is only acceptable for pure-presentation components (no state, no callbacks, no branching) — and that exception should be rare. Anything jsdom can't reach (real layout / FLIP, real `matchMedia`, real Supabase, multi-window realtime) belongs in the Playwright slot or the manual smoke list, not in the component-test layer pretending it's covered.

**Reference implementations:** `src/components/instant/OwnPointsCeremony.test.tsx` (canonical mock shape for `next-intl` + `next/navigation`, basic interaction patterns) and `src/components/instant/LeaderboardCeremony.test.tsx` (fake-timer + `requestAnimationFrame` + `matchMedia` polyfill + `globalThis.fetch` mock). Author conventions also documented in `src/__tests__/README.md`.

**Smoke checklist discipline.** The manual smoke checklist on a PR description should shrink as component tests cover more behaviour. Anything that *could* be asserted under jsdom but is left to manual smoke is a smoke-debt to flag in review.

### 17a.6 Smoke-test fixture seeding

The end-to-end manual smoke (Phase 7 §3) currently exercises the full create-room → onboard → join → vote → end-voting → score → announce → done path on every dry run. Walking that flow takes 5–10 minutes per scenario and most steps are unaffected by the bug being smoke-tested. Fixture seeding shortens the loop.

**Goal:** any tester (or the operator on show night) can land directly on the room state they want to verify — voting screen with N pre-filled votes, `voting_ending` countdown 4 s in, `announcing` mid-queue, `done` with awards — without manually transitioning the room each time.

**Mechanism (MVP):** a dev-only `npm run seed:room <state>` script that populates a Supabase room row, memberships, and (when relevant) votes / results / awards rows, then prints the `/room/{id}` URL. Gated behind `NODE_ENV === 'development'` and the explicit script invocation; never wired into the production app.

**Required states for ship night:**

- `lobby-with-3-guests` — empty room, three pre-onboarded guests, ready to start voting.
- `voting-half-done` — voting state, 50% of contestants scored, last-contestant gating not yet met.
- `voting-ending-mid-countdown` — `voting_ending` status with 3 s remaining; smoke-tests the undo path.
- `announcing-mid-queue-live` — live mode, second announcer mid-queue with 5 reveals shown / 5 pending.
- `announcing-instant-all-ready` — instant mode, every member marked ready, awaiting admin reveal.
- `done-with-awards` — full results page populated; smoke-tests the `<DoneCeremony>` chain + `/results/{id}` static page + the post-awards CTA footer.

**Out of scope for MVP:** UI for picking states (the script is CLI-only), seeding bets / hot-takes / late-joiners, automated assertions on the resulting state. All of those are V2.

**Cleanup:** seeded rooms write to the same tables as real rooms; the script tags them with a `seed_*` prefix in `pin` so the operator can identify and `DELETE` them via the Supabase SQL Editor without touching real-user data. The `9999` test-fixture year stays as the contestant cataogue for seeded rooms — it's already gated dev-only and the cleanup story is the same.

---

## 18. Deferred to V2

- Google OAuth / persistent accounts
- AI-generated Eurovision-style avatars
- Pre-show predictions beyond the 3 yes/no spread bets (e.g. top-3 picks, country drafting)
- Category weight adjustment **during `voting`** (lobby-edit already covers this for `lobby`, see §6.1)
- Per-category award animations (distinct per template)
- Historical cross-room stats ("your voting history across all parties")
- NQ (non-qualification) predictions for semis
- Auto-follow running order for "Now performing" (admin still taps manually in MVP)
- Original announcer reclaiming control mid-delegation (§10.2 step 7)
- "Claim your turn" for skipped absent announcers (§10.2.1)
- Auto-promotion of a non-co-admin to owner when both owner and co-admins are absent
- V2 bet catalog expansion: drafting, country picks, spreads beyond yes/no
- Multi-winner support beyond 2-way on personality awards (§11.2 tiebreak)
- Puppeteer-based PDF export (MVP uses `@react-pdf/renderer`, §12.4)
- "Disable wake lock" user toggle (if battery complaints emerge, §8.9)
- PDF-based individual score cards (the shareable link + HTML/PDF export cover the group summary; per-user cards are V2)

---

## 19. Open questions (none blocking MVP)

- Final domain name (`eurovisionmaxxing.com` vs `.app` vs `.tv`)
- Whether to charge for a custom domain or keep on Vercel's free subdomain for the first season
- Supabase project naming convention
- Who writes the non-English copy for `es` / `uk` / `fr` / `de` (§21): (a) hand-write, (b) LLM first-pass + native-speaker review (especially for `uk` and Eurovision-idiomatic copy like "Gay panic level", "Staging chaos"), or (c) defer non-English locales to V2 and ship infrastructure-only

---

## 20. Definition of done for MVP

The app is MVP-complete when a group can:
1. Create a room with any predefined template, select 2025 or 2026 event
2. Join via link, PIN, or QR code on their phones — including late joiners mid-`voting` (§6.3.2)
3. Vote on all or some contestants with autosave working, including offline queue reconciliation after a reconnect (§8.5)
4. Use "I missed this" for any entry
5. Have the admin close voting (with 5-second undo window, §6.3.1) and trigger scoring
6. Experience either live announcement or instant reveal, with admin-override reveal always available (§10.1)
7. See the full leaderboard and all awards
8. Optionally enable a 3-bet sidegame in the lobby (§22) with guest picks, admin-adjudicated resolution, and bet leaderboard in results
9. Share a results link that works for anyone without an account, plus HTML + PDF export (§12.3, §12.4) and copy-paste text summary (§12.2)
10. The present screen renders correctly when AirPlayed to a TV, holds the screen awake (§8.9), and is always dark-themed (§3.4)
11. Any user can switch between `en` / `es` / `uk` / `fr` / `de` at any time and the full UI (voting, announcement, awards, bets) renders correctly in the chosen locale (§21)
12. The owner can transfer ownership to another member, or promote a co-admin, so admin responsibilities survive a dying phone (§6.7)
13. The hot-take author or an admin can delete a hot-take silently; edits are marked *"edited"* (§8.7)

Everything else is V2.

---

## 21. Localization

### 21.0 Implementation phasing

The work in this section ships in two phases:

- **Phase A — Infrastructure + extraction of currently-built surfaces.** Wires `next-intl` into the App Router via cookie-based locale resolution (so the very first server render is in the user's locale — no English flash), populates `en.json` for the screens that exist today (landing, root layout, onboarding flow, auth API errors, voting templates), and additively extends the `apiError` helper with an optional `params` field for parameterized error messages. **No non-English copy and no language switcher UI ship in Phase A** — the goal is to make `t()` the load-bearing convention before Phases 2–6 build their first screens. Detailed design: [docs/superpowers/specs/2026-04-19-i18n-phase-a-design.md](docs/superpowers/specs/2026-04-19-i18n-phase-a-design.md). Implementation plan: [docs/superpowers/plans/2026-04-19-i18n-phase-a.md](docs/superpowers/plans/2026-04-19-i18n-phase-a.md). Tracked under TODO.md "Phase 1.5".
- **Phase B+ — Switcher, non-`en` copy, present-screen locale resolution, plural smoke test.** Picks up after the core product loop (Phases 2–6) is functional and there are real user-facing surfaces to switch between. Tracked under TODO.md "Phase L".

The remainder of this section (§21.1–§21.9) is the canonical design that both phases implement.

### 21.1 Supported locales

| Code | Language | Notes |
|---|---|---|
| `en` | English | Default + fallback for any missing key |
| `es` | Spanish | |
| `uk` | Ukrainian | Flag/label rendered as 🇺🇦 Українська in the switcher |
| `fr` | French | |
| `de` | German | |

Unsupported `navigator.language` values (any locale not in this table) fall back to `en`.

### 21.2 Scope

**In scope for translation:**
- All UI chrome: buttons, labels, headers, toasts, validation copy, empty states, error messages rendered client-side.
- Score anchors (§7.3) — rendered as the global scale strip (§8.1).
- Template names, category names, category hints for the three predefined templates in §7.1.
- All personality award names + stat labels (§11.2) and the "Best [Category]" category-award template. Bet-based awards (§11.2a) `the_oracle`, `the_wishcaster`.
- Country names displayed in the UI (the English keys of `COUNTRY_CODES` in `src/lib/contestants.ts` remain the internal lookup keys and are not translated).
- Hot-take placeholder and emoji-count helper copy, including the *"edited"* tag (§8.7.1).
- **Bet question text** (§22.1) — every entry in the catalog. Rendered via stable `bet_key → bets.{bet_key}.question` keys.
- **Bet status / resolution** labels: Yes / No / Still deciding / Skip — nobody knows (§22.5).
- **Voting card status labels**: `voting.status.scored`, `voting.status.unscored`, `voting.weight.badge` (§8.2).
- **Text summary labels** for the copy-paste export (§12.2): *"Our room's top 10"*, *"Bet results"*, *"Full results"*, medal prefixes.
- **Lobby copy**: show countdown units, *"Still to pick"*, *"Bets locked"*, *"Preview song"*, roster *"here"* / *"away"* labels.
- **Theme toggle** labels: System / Light / Dark (§3.4).
- **Admin transfer / co-admin** modal copy (§6.7).
- **Reveal-unlock countdown** micro-text on the admin's instant-mode screen (§10.1 step 4).

**Out of scope:**
- Admin-typed custom category names/hints (§7.2) — rendered as literal.
- User display names, hot takes, contestant `artist` / `song` / `country` data returned by the EurovisionAPI.

### 21.3 Library & file layout

`next-intl@^3`, configured without URL-routing middleware (locale lives in localStorage + user record, not in the path).

```
src/
  locales/{en,es,uk,fr,de}.json
  i18n/
    config.ts        # SUPPORTED_LOCALES, DEFAULT_LOCALE, detect()
    provider.tsx     # <IntlProvider>, reads locale from session/localStorage
    server.ts        # getLocaleForUser(userId) — used by the present screen
```

Message files use ICU MessageFormat with nested namespaces: `common`, `onboarding`, `voting`, `templates`, `categories`, `awards`, `countries`, `errors`, `present`, `create`, `lobby`, `bets`, `admin`, `theme`, `share`, `results`. ICU plural rules are used wherever counts appear (e.g. `"{points, plural, one {# point goes} other {# points go}} to {country}"`, `"{count, plural, one {# bet won} other {# bets won}}"`) — Ukrainian requires `one`/`few`/`many`/`other` plural arms.

### 21.4 Locale detection, persistence & selection

1. On first visit with no `emx_locale` in localStorage: read `navigator.language`, match the primary subtag (e.g. `es-AR` → `es`), fall back to `en`.
2. Persist to localStorage key `emx_locale` and — once the user has a session — to `users.preferred_locale` via `PATCH /api/auth/preferences`.
3. A language switcher (shared header component) lets the user change locale anywhere in the app. Changing it updates localStorage, calls the preferences API, and re-renders via the `next-intl` provider with no page reload.
4. The **present screen** (`/room/{id}/present`, §10.3) renders in the **admin's** `preferred_locale` — resolved server-side via `rooms.owner_user_id → users.preferred_locale`, falling back to `en`. This keeps the TV deterministic regardless of who opens the URL.

### 21.5 Session schema extension (amends §4.2)

`LocalSession` gains a `locale` field, documented in §4.2. `SUPPORTED_LOCALES` is exported from `src/i18n/config.ts` as the authoritative set of codes.

### 21.6 Stable keys for predefined categories & awards (amends §7, §11, §13)

To keep votes stable across locales, predefined template categories carry a stable `key` alongside the translatable display string. The `rooms.categories` JSONB entry shape becomes:

```typescript
interface RoomCategory {
  key?: string        // e.g. "vocals" — present for predefined, absent for custom
  nameKey?: string    // e.g. "categories.vocals.name"
  hintKey?: string    // e.g. "categories.vocals.hint"
  name: string        // always present: literal (custom) or English fallback (predefined)
  hint?: string
  weight: number
}
```

**Vote key resolution:** `votes.scores` is keyed by `category.key ?? category.name`. For predefined categories this is the stable slug; for custom categories it is the admin-typed name. The `name` field remains present on predefined categories as an English fallback for older clients.

**Awards rendering:** `room_awards.award_key` (already in §13) is the stable identifier. UI resolves display via `t('awards.' + award_key + '.name', …)` and `t('awards.' + award_key + '.statLabel', { value })`. `room_awards.award_name` is retained as an English fallback for legacy reads but is no longer the primary display source.

**Category-award naming:** "Best {category}" is an ICU pattern. `{category}` is resolved via the same key-first rule above — predefined categories translate, custom categories render as typed.

### 21.7 API conventions

- Error responses return a stable `code` string in addition to any human-readable `message`. Clients render via `t('errors.' + code)`. No locale-aware server rendering.
- `PATCH /api/auth/preferences` — updates `users.preferred_locale`. Body: `{ locale: SupportedLocale }`. Validates against `SUPPORTED_LOCALES`; 400 on unknown. Admin-only gating does not apply — any authenticated user may update their own preferences.

### 21.8 Schema migration (amends §13)

Additive only — no data backfill required.

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(5);
```

`rooms.categories` JSONB is a shape extension (optional new fields) and does not require a DB-level migration. Old rooms continue to work and display in English (no `nameKey` present).

### 21.9 Testing

- `src/locales/locales.test.ts` — fails if any non-`en` locale is missing a key present in `en.json`.
- Ukrainian pluralization smoke test — confirms ICU plural arms resolve for 1 / 2 / 5 of each count-sensitive message, including the bets namespace's *"{count, plural, one {# bet won} other {# bets won}}"*.
- Scoring and API tests remain locale-agnostic and operate on the stable vote-key (`category.key ?? category.name`), never on display strings.
- Bet resolution tests (§22.5) remain locale-agnostic and operate on `bet_key`, never on translated question text.

---

## 22. Room bets

An opt-in sidegame where every guest answers **exactly 3 yes/no spread-bet questions** before voting opens. Correct calls earn points in a separate bet leaderboard; incorrect calls earn nothing. The main Eurovision-points game is unaffected.

### 22.1 Bet catalog

The shipping catalog lives at `src/lib/bets/catalog.ts` as a typed array. Each entry:

```typescript
interface BetCatalogEntry {
  betKey: string;          // stable identifier, used in room_bets.bet_key and locale keys
  resolverType: 'auto' | 'manual';
  autoResolver?: (ctx: RoomScoringContext) => 'yes' | 'no';  // required iff resolverType === 'auto'
}
```

**Closed-loop (`resolverType: 'auto'`, 6 entries):**

| `bet_key` | Question (English reference) | Resolver logic |
|---|---|---|
| `c1_landslide` | Will the room winner win by ≥30 points? | `results[rank=1].total − results[rank=2].total ≥ 30` |
| `c2_cross_room_ten` | Will any country get a 10 from at least half the room in at least one category? | Per category per contestant, count users scoring `10`. If `max_count ≥ ceil(memberCount / 2)` for any (contestant, category) pair → yes. |
| `c5_below_three` | Will any country score below 3.0 average in the room? | `min(avg_weighted_score) < 3.0` across contestants. |
| `c6_big5_shutout` | Will **no** Big 5 country finish in the room top 3? | Big 5 = `{GB, FR, DE, ES, IT}`. If none of the top 3 contestants by `finalScore` are in Big 5 → yes. |
| `c7_owner_matches_group` | Will the group #1 match the **owner**'s personal #1? | `results.ranked[owner_user_id][1].contestant_id === finalLeaderboard[1].contestant_id` → yes. |
| `c10_identical_scores` | Will anyone score every category identically for a single country? (all 5s, all 7s, etc.) | Iterate every (user, contestant) vote; if `scores` values are all equal and `missed === false` → yes. |

**Admin-adjudicated (`resolverType: 'manual'`, 13 entries):**

| `bet_key` | Question (English reference) |
|---|---|
| `a1_barefoot` | Will anyone perform barefoot? |
| `a3_pyro` | Will any performance feature pyrotechnics? |
| `a4_wardrobe_reveal` | Will any performer do a wardrobe reveal/rip-off? |
| `a5_non_english_winner` | Will a non-English-language song win? |
| `a6_uk_bottom5` | Will the UK finish in the Eurovision bottom 5? |
| `a7_host_outfits` | Will any host change outfits 4+ times? |
| `a8_stage_trip` | Will any performer fall, trip, or visibly stumble on stage? |
| `a9_jury_televote_split` | Will juries and televote disagree on the Eurovision winner? |
| `a10_host_country_bottom_half` | Will the host country finish in the bottom half? |
| `a11_wind_machine` | Will any performance feature a wind machine? |
| `a12_stage_kiss` | Will there be an on-stage kiss? |
| `a13_performer_cries` | Will any performer cry (happy or sad)? |
| `a14_sweden_top5` | Will Sweden finish top 5? |

Each question has three locale keys: `bets.{bet_key}.question`, `bets.{bet_key}.yesOutcome`, `bets.{bet_key}.noOutcome` — the outcome strings populate the results leaderboard ("Sweden did finish top 5" vs "Sweden did not finish top 5").

### 22.2 Admin bet selection (lobby)

During `/create` Step 2 (§6.1) and from lobby-edit:

- Toggle *"Add a betting sidegame"* controls `rooms.bets_enabled`.
- When enabled, the admin sees a **3-slot bet picker**:
  - Three drop zones labelled *"Bet 1"*, *"Bet 2"*, *"Bet 3"*.
  - A scrollable catalog list on the right. Tapping a catalog entry assigns it to the next empty slot (or replaces the admin's currently-selected slot).
  - Each slot has an × button to clear.
- **"Surprise me"** button: auto-fills all three empty slots with random `bet_key` picks (uniform over the catalog, no duplicates across slots). If the admin already has one or two slots filled, "Surprise me" fills only the remaining empty slots.
- Validation: submission requires exactly 3 slots filled with distinct `bet_key`s. Client-side and server-side.
- On commit, the server creates 3 `room_bets` rows keyed by `(room_id, bet_key)` with `display_slot ∈ {1,2,3}` matching the admin's chosen order, and `resolver_type` copied from the catalog.
- Lobby-edit: admin can swap any slot for a different `bet_key`, reorder via drag-handle (same pattern as §7.2), or disable bets entirely (drops all 3 `room_bets` rows and all `bet_picks`).

### 22.3 Guest bet picks (lobby)

- Once `rooms.bets_enabled = true` and `room_bets` has its 3 rows, every guest sees the three bet questions as cards in the lobby (§6.6.4).
- Each card presents: the question text, three tap targets — **Yes**, **No**, **No opinion** (secondary, smaller).
- Default pick on a brand-new guest is unset. Guests are prompted via a *"Still to pick"* list at the top of the lobby view summarising any unsubmitted bets (e.g. *"1 of 3 bets still to pick — tap to answer"*).
- Tapping a pick UPSERTS a `bet_picks` row via `POST /api/rooms/{id}/bet-picks` — no separate submit button. Pick may be changed up until bets lock.
- **Bets lock at the `lobby → voting` transition.** At that moment:
  - Any guest who has not placed all 3 picks gets their unpicked bets auto-set to `pick = 'no_opinion'`. Server-side auto-fill on status transition.
  - Late joiners (§6.3.2) see the 3 bets as read-only with all picks prefilled to `'no_opinion'`. No UI for them to change picks.
- `bet_picks` rows are **server-authoritative read** via the RLS policy (§13) — guests cannot see each other's picks until `rooms.status ∈ ('announcing', 'done')`. Prevents pre-show peeking for room-internal hints ("what did the admin pick?").

### 22.4 Bet drawer during `voting`

Admin-only floating drawer for logging admin-adjudicated bet events as they happen during the show:

- **Icon** in the admin's header toggles the drawer open/closed.
- Drawer lists all 3 room bets with status pills:
  - `auto` bets show *"auto-resolving"* placeholder — no interaction.
  - `manual` bets show three pills: **Yes**, **No**, **Still deciding** (default).
- Admin taps as moments occur (e.g. wardrobe reveal just happened → Yes on `a4_wardrobe_reveal`). Taps UPSERT `room_bets.resolution` via `PATCH /api/rooms/{id}/bets/{bet_key}` and broadcast `bet_resolution` (§15).
- Admin can change a manual bet from Yes to No or back to Still deciding at any time during `voting` / `voting_ending` / `scoring`. Locks once `announcing` begins (see §22.5).
- Drawer is accessible to co-admins (§6.7) with identical permissions.

### 22.5 Bet resolution & awards gate

At the `scoring → announcing` transition (Live mode) or at the `leaderboard reveal → awards` transition (Instant mode, §10.1 step 6), the server runs the bet-resolution pipeline before awards generation:

**Step 1: Auto-resolve.**
- For every `room_bets` row where `resolver_type = 'auto'` and `resolution IS NULL`: invoke the catalog's `autoResolver(ctx)` with the room's scored context. Write the result to `resolution`, set `resolved_at = now()`, `resolved_by_user_id = NULL`.

**Step 2: Manual-resolve gate (hard block before awards).**
- For every `room_bets` row where `resolver_type = 'manual'` and `resolution IS NULL`: the admin is shown a mandatory *"Resolve remaining bets"* screen. For each unresolved manual bet, three pills:
  - **Yes** — write `resolution = 'yes'`.
  - **No** — write `resolution = 'no'`.
  - **Skip — nobody knows** — write `resolution = 'unknown'`. All picks earn 0 on this bet; no one is credited.
- The screen does not advance until every manual bet has a non-null `resolution`. Rationale: guarantees admin cannot forget to adjudicate (§22 brainstorm answer to user's explicit question).
- `resolved_by_user_id` records the admin who adjudicated. Multiple admins may collaborate (co-admins can tap too).

**Step 3: Bet leaderboard computation.**
- For each user, compute `correctCount = count(bet_picks where bet_picks.pick === room_bets.resolution AND room_bets.resolution != 'unknown')`.
- Write per-user bet standings to a new lightweight table or inline on the awards pipeline — MVP keeps it inline (derived on results-read; no cache table). `SELECT user_id, COUNT(*) FILTER (…) AS correct_count FROM bet_picks JOIN room_bets USING (room_id, bet_key) WHERE …`.
- Ties resolve alphabetically by `display_name`.

**Step 4: Oracle / Wishcaster awards.**
- §11.2a computes `the_oracle` = user with max `correctCount`, `the_wishcaster` = user with min `correctCount`. Write `room_awards` rows.

**Step 5: Proceed to awards reveal.**
- Bet leaderboard and individual bet outcomes render in the awards sequence (§11.3).

### 22.6 Results page rendering (§12)

When `rooms.bets_enabled = true`, the `/results/{id}` page adds a **Bets section** between the main leaderboard and the awards breakdown:

- Three question cards, one per bet: question text · resolution (Yes / No / Unknown) · outcome copy · per-pick breakdown ("5 of 7 correctly called this").
- **Bet leaderboard** underneath: ranked list of users by `correctCount`, with each user's 3 picks visually decorated ✅ / ❌ / ⚪ (no opinion / unknown).
- Text summary (§12.2) includes a compact bet section (≤4 lines).
- HTML export (§12.3) and PDF export (§12.4) include the full bet section.

### 22.7 Constraints & edge cases

- **Room without bets**: `rooms.bets_enabled = false`, no `room_bets` rows, no bet surfaces anywhere. Exactly the pre-§22 behaviour.
- **Admin disables bets mid-lobby**: all `room_bets` and `bet_picks` rows for the room are deleted (cascade). Guests see a one-shot toast *"Bets have been removed for this room."*.
- **Admin leaves bets enabled but never picks**: room creation enforces 3 picks server-side — this state is unreachable.
- **All 3 bets resolve `unknown`**: valid. Every user has `correctCount = 0`. Wishcaster is a 15-way tie → deterministic alphabetical top-two per §11.2. Oracle award is **suppressed** (locale key `awards.the_oracle.suppressed` renders *"The Oracle was unreachable this year"* as a small flavour card). Edge case intentionally handled as narrative.
- **Single-member room (admin alone)**: bets work identically — the admin can still place picks and resolve. The Oracle and Wishcaster are the same person (acceptable MVP outcome; rare in practice).

---

## 23. Phase E — Europe comparison (post-show alignment)

**Status: post-MVP feature, prioritized above V2.** Designed and scoped here so we can build it the night of the 2026-05-16 show or the day after, while watch-party momentum is still warm.

### 23.1 Goal

After the Eurovision Grand Final ends, every room with `status = 'done'` gains a "How did your room compare to Europe?" surface on `/results/{roomId}`. The surface answers four questions, all derivable from the official per-country jury+televote breakdown and the room's existing `votes` / `results` rows:

1. **Room vs Europe** — Spearman rank correlation between the room's aggregate ranking and the official Eurovision final ranking. Rendered as a single percentage + diff badges per contestant ("you ranked Sweden 3rd; Europe ranked it 1st").
2. **Each user vs Europe** — same metric per user. Rendered in the existing per-user breakdown cards as a new chip ("84% aligned with Europe").
3. **Each user's nearest-neighbour country** — for each user, find the European country whose jury (or combined) ranking aligns most closely with their picks. Rendered as *"Alice voted most like Sweden's jury (87% match)"*. Pure narrative flavour, not a leaderboard.
4. **Room's nearest-neighbour country** — same, for the room aggregate. *"Your room voted most like Cyprus's televote (76% match)"*.

These are post-show flavour reveals, not voting mechanics. No live broadcast hooks — the data isn't available until after the show ends.

### 23.2 Realtime constraints (and why this isn't a Phase 5b/5c-style live feature)

There is **no public structured stream** of Eurovision results during the live broadcast. EBU does not expose a feed. Community sites scrape and republish with minutes of lag. Watch-party "compare during the show" is therefore out of scope.

What is available:

- **Final leaderboard** — eurovision.tv publishes ~10–30 min after broadcast end.
- **Per-country jury + televote breakdown** — eurovision.tv press release ~1 h after broadcast end. This is the load-bearing dataset for §23 — without per-country breakdown, only #1 and #2 above are computable.
- **EurovisionAPI** (community: `eurovisionapi.runasp.net` or successor) — typically catches up with eurovision.tv within minutes, exposes JSON.
- **Wikipedia ESC 2026 article** — populated within hours; structured tables, but scrape-only.

The `/api/europe-comparison/{year}/{event}` endpoint (proposed below) treats EurovisionAPI as primary and falls back to a hand-curated `data/europe-results/{year}/{event}.json` file for resilience — same contestant-data cascade pattern as §5.1.

### 23.3 Data shape (`data/europe-results/{year}/{event}.json`)

```jsonc
{
  "year": 2026,
  "event": "final",
  "publishedAt": "2026-05-16T22:30:00Z",   // ISO timestamp from EBU
  "ranking": [                              // final leaderboard
    { "countryCode": "SE", "rank": 1, "totalPoints": 432, "juryPoints": 200, "televotePoints": 232 },
    // … one per qualified contestant (~26)
  ],
  "votingByCountry": [                      // 50 rows (voting countries, includes some non-participants)
    {
      "voterCountryCode": "SE",
      "jury":     { "AT": 12, "AL": 10, "FI": 8, "ES": 7, /* … */ },   // recipientCountryCode → points (1, 2, 3, 4, 5, 6, 7, 8, 10, 12)
      "televote": { "AT": 12, "AL": 10, /* … */ }
    },
    // …
  ]
}
```

`countryCode` semantics match §5.1a (ISO-3166-1 alpha-2 uppercase). The recipient set in `jury` / `televote` is exactly the awards each voting country gave (10 entries per voter: 1, 2, 3, 4, 5, 6, 7, 8, 10, 12).

### 23.4 Endpoints

- **`GET /api/europe-comparison/{year}/{event}`** — read-only, public. Returns the §23.3 payload. Cascade: live API → hardcoded fallback → 404. Cached aggressively (`Cache-Control: public, max-age=86400`) once published.
- **`POST /api/admin/refresh-europe-results`** — operator action, owner of the deployment only (gated by a `MAINTAINER_TOKEN` env var, never exposed via the wizard). Hits EurovisionAPI, normalises to §23.3 shape, writes to a new `europe_results` table keyed by `(year, event)`. The above GET reads from this table when present.

### 23.5 Computation primitives (`src/lib/europe/`)

Pure helpers, all unit-testable on small fixtures:

- `spearman(rankingA: number[], rankingB: number[]): number` — already exists in `src/lib/scoring.ts`; reuse.
- `roomVsEurope(roomLeaderboard, europeRanking): { spearman: number, perContestantDiff: Map<contestantId, number> }`.
- `userVsEurope(userVotes, europeRanking, scoringContext): { spearman: number }` — scoringContext supplies the user's weighted ranking the same way `runScoring` does.
- `nearestNeighbourCountry(targetRanking, votingByCountry, mode: "jury" | "televote" | "combined"): { countryCode, alignment: number }` — for each voting country, compute Spearman between target and that country's awards, return argmax. `combined` averages jury + televote awards before ranking.

### 23.6 UI surface on `/results/{roomId}`

A new section between the main leaderboard and the per-user breakdowns, rendered only when `rooms.status = 'done'` AND `europe_results` exists for the room's year+event:

1. **Headline card**: *"Your room ranked Sweden 3rd; Europe ranked it 1st."* + the room's overall Spearman score as a percentage + a diff badge per contestant (the top-5 contestants with the biggest deltas).
2. **Per-user chip on each breakdown card**: *"84% aligned with Europe"* — small chip below the user's points total, tinted by alignment band (≥80% green, 50–80% neutral, <50% pink).
3. **Nearest-neighbour callout per user**: under each user's breakdown, one-line *"Voted most like 🇸🇪 Sweden's jury (87% match)"*. Tappable to expand the country's full ranking.
4. **Room nearest-neighbour callout**: a flavour card near the headline. *"Your room voted most like 🇨🇾 Cyprus's televote (76% match)"*.

All four use the §3.2 palette + animations; no new tokens. No bets coupling.

### 23.7 Text summary + exports (§12.2 / §12.3 / §12.4)

When europe-comparison data exists, the text summary gains a 2-line section:

```
🇪🇺 vs Europe: 71% aligned · most like 🇨🇾 Cyprus televote
Top miss: Albania (you 4th, Europe 12th)
```

HTML and PDF exports include the full headline card + per-user chips + nearest-neighbour rows. No bet-style gate.

### 23.8 Constraints & edge cases

- **Data not yet available**: `/api/europe-comparison/{year}/{event}` returns 404; the UI section renders a one-line *"Europe results aren't published yet — check back after midnight CET."* placeholder.
- **Partial data** (leaderboard exists but per-country breakdown missing): only #1 (room vs Europe) and #2 (per-user vs Europe) compute; #3 and #4 (nearest-neighbour) suppress with a *"Per-country breakdown lands in ~1 hour after the broadcast."* note.
- **Year mismatch**: if the room's `year` doesn't match an available `europe_results` row, suppress the entire section. Don't fall back to a different year.
- **No room votes**: a degenerate room with `voting_ended_at` set but every user marked all contestants `missed=true` shouldn't crash the comparison; pass-through Spearman returns NaN → render a single-line *"Not enough data to compare."*.

### 23.9 Build phasing

Roughly half a day each:

1. **E1** — Data fetcher + endpoint + hardcoded fallback. `scripts/fetch-europe-results.ts` (CLI) + `/api/europe-comparison/{year}/{event}` route + `europe_results` Supabase table.
2. **E2** — Pure computation primitives in `src/lib/europe/`. Reuse `spearman`. Heavy unit-test coverage.
3. **E3** — `/results/{roomId}` UI: headline card + per-user chips + nearest-neighbour callouts. RTL coverage with seeded europe-results fixtures.
4. **E4** — Text summary + HTML/PDF export integration (depends on §12.3 / §12.4 if those ship; otherwise just text summary).
5. **E5** — Operator runbook: when to run `npm run fetch-europe-results 2026 final` on show night. Document expected timing window.

---

## 24. Legal pages, footer & source licence

The Service is a non-commercial fan project but it still touches personal data and lives on a public domain. This section pins down what the user sees in the chrome and what we're willing to commit to in writing.

### 24.1 Footer (`src/components/ui/Footer.tsx`)

Persistent across the app, suppressed only on the TV `/present` surface (matches `ThemeToggle` and `LocaleSwitcher` — anything in the page chrome would burn into an OBS broadcast). Renders:

1. Four inline links — **About** (`/about`), **Privacy** (`/privacy`), **Terms** (`/terms`), **Source** (GitHub repo, `target="_blank"` `rel="noreferrer noopener"`).
2. An EBU disclaimer line: *"Unaffiliated fan project. Eurovision® and the Eurovision Song Contest® are trademarks of the European Broadcasting Union."*
3. A copyright + licence line: *"© {year} Valeriia Kulynych. Source under BUSL-1.1."*

The pathname check is `pathname?.endsWith("/present") || pathname?.includes("/present/")`. Any new TV/broadcast surface added later must be either under `/present`, or this rule must be widened to include it explicitly.

### 24.2 Static pages

All three pages are server components, English-only in body (see §24.3), with a `Last updated: YYYY-MM-DD` line and section-numbered headings.

- **`/about`** — short fan-project explainer, links to GitHub repo + issues. No legal content; tone-setting only.
- **`/privacy`** — UK-GDPR-shaped policy. Mandatory contents: who runs the service (operator name, country, contact email), what data is stored (display name, votes, hot takes, session/locale cookies, server logs from sub-processors), legal basis (Art. 6(1)(b) performance + 6(1)(f) legitimate interest), sub-processors (currently Vercel, Supabase, Cloudflare — must stay in sync with §2 if that list changes), retention, user rights + ICO complaint route, international-transfer note. The contact email is the operator's published domain alias (`contact@eurovisionmaxxing.com`, forwarded via Cloudflare Email Routing) — never a personal address.
- **`/terms`** — non-commercial-fan-project terms. Mandatory clauses: who you're dealing with, what the Service is + EBU non-affiliation, acceptable use, your-content licence (storage-only, no marketing use), source-licence reference (BUSL-1.1 — see §24.5), AS-IS disclaimer, **limitation of liability capped at GBP 10** in aggregate (deliberately a token-but-non-zero figure to stay enforceable under the Consumer Rights Act 2015 / Unfair Contract Terms Act 1977 — chosen at the low end of the defensible range because the Service is free), governing law **England & Wales**, contact.

Sub-processor list, governing-law jurisdiction, and the liability cap are contract-grade — changing any of them is a SPEC change, not a content tweak.

### 24.3 i18n

A `footer` namespace exists in all 5 locale bundles (en/es/uk/fr/de) covering the four labels, the disclaimer, and the copyright string (with `{year}` ICU param). Page bodies are English-only by policy: legal copy may only be published in languages the operator can certify, and we don't currently have certified DE/FR/ES/UK translations of the policy text. If a locale gains a translated body, route to a per-locale page (e.g. `/de/datenschutz`) rather than swapping the body in place.

### 24.4 Intentionally absent

- **Imprint / Impressum.** Operator has no business address and will not publish a home address. This leaves a strict-reading TMG §5 gap for DACH visitors. Acceptable risk while non-commercial; **must be revisited before any monetisation step** (paid tier, donations, advertising). Documenting absence here so the gap doesn't get re-discovered as a "missing piece" later.
- **Cookie consent banner.** Only `NEXT_LOCALE` (preference) and the auth/session cookie are set, both strictly necessary under ePrivacy Art. 5(3). No banner is required and we deliberately don't ship one. **Adding any analytics, advertising, or cross-site tracker triggers a banner** — that's not a content change, it's a SPEC change to this section.

### 24.5 Source licence

The repository ships under **Business Source License 1.1** (`/LICENSE`). Parameters:

- **Licensor:** Valeriia Kulynych
- **Licensed Work:** eurovisionmaxxing © 2026
- **Change Date:** 2030-05-16 (4 years from initial public release of v1)
- **Change License:** Apache License, Version 2.0
- **Additional Use Grant:** production use of the code is permitted, **except** offering it to third parties as a hosted, managed, or embedded service that competes with the Licensor's paid offerings.

Why BUSL rather than MIT/Apache or AGPL: the project may carry a paid hosted tier in the future. BUSL keeps the source visible and welcomes contributions/forks for personal use, but blocks the "0-cost SaaS competitor" failure mode that pure permissive licences allow. AGPL was rejected because requiring derivative-deployment source release deters casual self-hosters more than it deters competitors. The 4-year auto-conversion to Apache-2.0 means the restriction has a hard sunset — by the Change Date the project is effectively permissively licensed.

`package.json` carries `"license": "BUSL-1.1"` to match. This SPDX identifier is recognised by GitHub's licence detector.

