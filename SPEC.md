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

- **Default:** dark mode. Follow device `prefers-color-scheme`. No manual toggle for MVP.
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

### 5.4 Flag display
Use `flagEmoji` field (unicode flag emoji derived from `countryCode`). Render at 24px on voting cards, 32px on results. No external flag image CDN needed.

---

## 6. Room management

### 6.1 Room creation flow
Admin goes through a 3-step wizard:

**Step 1: Event selection**
- Year (default: current year)
- Event: Semi-Final 1 / Semi-Final 2 / Grand Final
- Preview of contestant count once loaded (e.g. "17 countries loaded")
- If both the EurovisionAPI call **and** the hardcoded-JSON fallback fail (§5.1 step 4), the wizard renders an inline error: *"We couldn't load contestant data for this event. Try a different year or event."* with a "Back" CTA that returns to year/event selection (it does not silently fail).

**Step 2: Voting configuration**
- Template selection: four cards (Classic / Spectacle / Banger Test / Custom). Each predefined card is **expandable to preview its categories and hints inline before commit** — tap the card to expand/collapse; tap "Use this template" to select.
- Announcement mode: two large radio cards with explanatory copy —
  - **Live:** *"Take turns announcing your points, Eurovision-style. Great with a TV."*
  - **Instant:** *"Reveal the winner in one shot. Great if you're short on time."*
- **"Sync everyone to the performing act"** toggle (internal name: `allow_now_performing`) — lets the admin tap the currently-performing country to bring all guests to that card during voting. Off by default. Info icon on the toggle opens a one-line explanation.

**Step 3: Room ready**
- Display room PIN (6 alphanumeric chars, uppercase, excluding O/0/I/1 for readability)
- QR code pointing to room URL, rendered at **minimum 256×256 CSS px** (reliable scanning across a room). Fills to natural container above that.
- Shareable link: `eurovisionmaxxing.com/room/{roomId}`
- "Copy link" button, "Copy PIN" button. On tap, each shows a transient *"Copied!"* toast or inline label for ~2 seconds.
- "Start lobby" button → transitions room to `lobby` status and navigates admin to room view.

**Editing after creation (admin-only, in-lobby):**
While `rooms.status = 'lobby'`, the admin can re-open a limited wizard from the lobby view to change **categories**, **announcement mode**, and the **now-performing toggle** — all via the same UI as Step 2. Year and event are **not** editable post-creation (contestant data and PIN don't change). All edits lock permanently once status transitions to `voting`. The lobby view surfaces the entry point as an "Edit room" control, visible only to the owner.

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

### 6.4 Room join by PIN
Route: `eurovisionmaxxing.com/join`
- **Six individual slot inputs** (SMS-code style), one character each, auto-uppercase, auto-advance focus on keystroke, auto-backtrack on delete. Paste into any slot distributes characters across the slots. Rationale: PINs are often read aloud across a room — slotting matches how they're spoken ("A… B… J…").
- On six filled slots: auto-submit `POST /api/rooms/join-by-pin` → redirect to room URL on success
- Error states: room not found, room already in `announcing` or `done` state. Errors render inline below the slots and do **not** clear the entered characters (so the user can correct a typo rather than retype).

### 6.5 "Now performing" mode
When enabled by admin at room creation (see §6.1 Step 2, "Sync everyone to the performing act"):
- Admin sees a "Now performing" control panel with a list of all contestants. For MVP the admin taps each act manually as the show progresses (no auto-follow-running-order). Auto-queue is deferred to V2.
- Tapping a contestant broadcasts `now_performing: contestantId` to all room subscribers.
- All connected clients' voting UI snaps to that contestant's card — **with two safety conditions**:
  1. The snap is **deferred while the user is actively interacting with a score button** (button press-down in flight). The snap fires on the next interaction release.
  2. If the user is **already viewing the performing card**, the snap is a no-op.
- Non-admin users on a *different* card than the currently-performing one see a small indicator pill at the top: *"🎤 Now performing: [Country] — [Song]"*, tappable to jump. The indicator is **suppressed on the performing card itself** (no duplication).
- Users can still manually navigate away; the snap only triggers once per broadcast.

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
  - Hint: optional, max 80 chars. Rendered **inline below the category name on the voting card**, permanently visible. Not a hover tooltip.
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
- Full-screen single-contestant view
- Header: contestant flag emoji + country name + song title + artist name
- Running order indicator: "3 of 17" (the current card's position in the running order, out of total contestants — always constant for a given event). A **separate progress indicator** ("scored / total", e.g. "5 / 17 scored") is shown elsewhere in the header so the two counts are not conflated.
- Body: category score rows (10-button 1–10 scale, see §8.2), one row per category
- Footer: "I missed this" button + Prev/Next navigation
- Jump-to: small button opens a scrollable drawer of all countries (flag + name), tapping any navigates directly

### 8.2 Category score buttons
Each category renders as a row of **10 tappable buttons** labelled 1 through 10. No slider.

- **Values:** integer 1–10. Each button represents one discrete value.
- **Touch targets:** min 44×44 CSS px per button. On narrow viewports the row wraps to two lines (1–5 top, 6–10 bottom); on wider viewports it renders as a single row.
- **Anchors:** the anchor copy from §7.3 is rendered underneath buttons 1, 5, and 10 in `text-muted-foreground`, one line each.
- **Unset state:** no button selected. The row uses `bg-muted` fill with button labels in `text-muted-foreground`. A small ghost line reads `t('voting.tapToScore')` ("Tap to score") below the row.
- **Selected state:** the pressed button fills with `bg-primary` (gold), its label flips to `text-background`, and `animate-score-pop` fires on press.
- **Interaction:**
  - Tapping a button sets the score to that value.
  - Tapping a different button updates the score to the new value.
  - Tapping the currently-selected button **clears** the score (returns to unset). Rationale: no separate "clear" control needed.
- **Scored definition:** a category is considered scored whenever exactly one button is pressed. The progress indicator in §8.1 counts only categories in this state.

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
  - On reconnect: drain the offline queue in order (oldest first). Conflicts (a row already has a later server-side `updated_at`) resolve **server-wins** — the server value is applied, and the client surfaces a brief toast *"Your offline changes for [contestant] conflicted with a newer version on the server."*
  - Banner and chip clear once the queue drains successfully.

### 8.6 Navigation
- Prev/Next arrows in footer; swipe gesture also works (left = next, right = prev).
- **Swipe only activates outside the category score-button area** — horizontal swipes initiated on a score row do not trigger navigation (prevents accidental nav while users are selecting scores). The header, footer, between-row gaps, and hot-take area are all valid swipe origins.
- Running order determines default sequence.
- If admin broadcasts "now performing", UI snaps to that contestant per §6.5; user can navigate back.
- Progress indicator: number of scored entries / total entries shown in header (see §8.1 for the separation from the running-order indicator).

### 8.7 Hot takes
- Optional per-contestant free-text field below the score rows (§8.2).
- 140 character limit, emoji-aware (emoji count as 2 chars). A live counter renders below the input as `120 / 140`; the counter switches to `text-accent` (hot pink) once the user is within 10 characters of the limit, and the input visibly clamps at 140 (extra keystrokes do nothing).
- Placeholder: *"Your one-liner"*.
- Shown in results screen next to user's avatar.
- Can be left blank; shown only if filled.

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
2. "Ready to reveal" button — admin sees count of users who are ready (e.g. *"4 / 6 ready"*).
3. Admin reveal triggers:
   - Once all users mark ready → admin's "Reveal final results" CTA is primary.
   - If not all are ready, admin can still tap **"Reveal anyway"** once a timeout (60 seconds from the first ready) has elapsed, or once at least half the room is ready — whichever comes first. Surfacing "Reveal anyway" earlier avoids the whole room waiting on an afk user.
4. On reveal → animated worst-to-best reveal of the group leaderboard.
5. After leaderboard: awards screen (§11).

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

4. **Advancing the reveal:** the announcer advances by **tapping anywhere on the lower half of their screen** (not a small button — the whole area is one large tap target, which avoids fumble under pressure). An optional 3-second auto-advance fires after each reveal; a persistent *"Hold"* control lets the announcer pause auto-advance indefinitely while they narrate.
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

### 10.3 Presentation screen (`/room/{roomId}/present`)
- Fullscreen, no URL bar ideally (use PWA manifest + `display: standalone`).
- **iOS/Safari fullscreen fallback:** when `display: standalone` and/or the landscape viewport override can't be acquired (common on iOS Safari when not launched from the home screen), the route surfaces a one-tap *"Enter fullscreen"* prompt that triggers `document.documentElement.requestFullscreen()` on the user gesture. Prompt is dismissible and reappears only if the browser exits fullscreen.
- Shows the current live leaderboard: flag + country + running total, sorted by current score.
- Animates rank changes when scores are added (smooth reorder transition, ~300ms, via `animate-rank-shift`).
- Shows whose turn it is to announce and which point value is next.
- Designed for a 16:9 TV-ish aspect ratio but gracefully handles other ratios.

---

## 11. Awards

Computed server-side after scoring. Stored in `room_awards` table. Displayed on a dedicated awards screen after the results reveal.

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

### 11.3 Awards screen
- Cinematic reveal: one award at a time, admin/presenter taps to advance.
- A small **"Next award"** button is always visible in a corner of the screen (not just a tap-anywhere zone) — so that if the admin fumbles or a guest can't tell where to tap, the control is unambiguously findable.
- Each award: large award name, winner's avatar + display name (or country flag for contestant awards), brief stat shown below.
- **Pair / joint-winner awards** (Neighbourhood voters; 2-way ties on personality awards): rendered as a **dual-avatar card** — both avatars side-by-side, both display names below, single shared stat line. Caption: *"voted most alike"* for Neighbourhood voters; *"joint winners"* for ties.
- Last award is always "The enabler" — good narrative closer.
- After all awards the screen shows two primary CTAs side-by-side:
  - **"Copy share link"** — copies the `/results/{roomId}` URL and shows a 2s *"Copied!"* confirmation.
  - **"Create another room"** — routes back to `/create` pre-filled with the same year/event (admin only; guests see only "Copy share link").

---

## 12. Shareable results

- Read-only results page: `eurovisionmaxxing.com/results/{roomId}`
- Accessible to anyone with the link (no auth required)
- Shows: final leaderboard, each user's points breakdown, all awards, all hot takes
- Data persists indefinitely (Supabase free tier doesn't auto-delete rows)
- Supabase project kept alive via UptimeRobot pinging `/api/health` every 5 minutes. The endpoint must execute a real Supabase query (not just a static response) — implemented as `supabase.from('rooms').select('id').limit(1)` — so that both Vercel and the Supabase DB stay warm. Pinging the homepage only keeps Vercel warm.
- `/api/health` returns `{ ok: true }` on success or HTTP 503 with `{ ok: false, error }` on failure.
- No PDF export in MVP — the shareable link is the export

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
  status                VARCHAR(12) NOT NULL DEFAULT 'lobby'
                          CHECK (status IN ('lobby','voting','scoring','announcing','done')),
  announcement_mode     VARCHAR(7) NOT NULL DEFAULT 'instant'
                          CHECK (announcement_mode IN ('live','instant')),
  announcement_order    UUID[],                 -- ordered array of userIds for live mode
  announcing_user_id    UUID REFERENCES users(id),
  delegate_user_id      UUID REFERENCES users(id), -- admin delegate during handoff (§10.2); NULL when the original announcer is driving
  current_announce_idx  SMALLINT DEFAULT 0,     -- which point value is being announced
  now_performing_id     VARCHAR(20),            -- contestant id currently performing
  allow_now_performing  BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
```

### `room_memberships`
```sql
CREATE TABLE room_memberships (
  room_id     UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  is_ready    BOOLEAN DEFAULT FALSE,            -- for instant mode "ready to reveal"
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
  award_key       VARCHAR(30) NOT NULL,         -- e.g. "harshest_critic"
  award_name      VARCHAR(50) NOT NULL,         -- display name
  winner_user_id  UUID REFERENCES users(id),    -- null for contestant awards
  winner_user_id_b UUID REFERENCES users(id),   -- second winner slot: used for the Neighbourhood Voters pair and for 2-way ties on personality awards (§11.2). Null otherwise.
  winner_contestant_id VARCHAR(20),             -- null for user awards
  stat_value      NUMERIC(6,3),                 -- the underlying metric
  stat_label      VARCHAR(80),                  -- human-readable stat description
  PRIMARY KEY (room_id, award_key)
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
```

### RLS policies

**Architecture decision:** all API routes go through Next.js Route Handlers that use the `SUPABASE_SECRET_KEY` service-role client (`createServiceClient()` in `src/lib/supabase/server.ts`). That client **bypasses RLS**, so the policies below exist only as a defence-in-depth against direct client-side Supabase access using the publishable key — never as the primary authorization layer. Authorization decisions (ownership, room membership, admin-only actions) are enforced in the API route handlers.

RLS is enabled on all six tables. The MVP ships these policies:

```sql
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE results           ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_awards       ENABLE ROW LEVEL SECURITY;

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
```

No `INSERT`/`UPDATE`/`DELETE` policies are created — writes must go through the service-role API routes. Tighter per-user `votes` SELECT policies are deferred to V2 when/if direct client reads become necessary.

### Realtime publication

The Supabase Realtime publication must include these tables so that Postgres-level changes are broadcast to subscribed clients in addition to server-initiated broadcast messages:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_memberships;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE results;
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
| PATCH | `/api/rooms/{id}/status` | Admin: transition room status |
| PATCH | `/api/rooms/{id}/now-performing` | Admin: set current performer |
| POST | `/api/rooms/{id}/votes` | Upsert a user's vote for a contestant |
| POST | `/api/rooms/{id}/score` | Admin: trigger scoring engine |
| POST | `/api/rooms/{id}/announce/next` | Advance announcement by one step |
| POST | `/api/rooms/{id}/announce/handoff` | Admin takes over for a user |
| GET | `/api/rooms/{id}/results` | Get full results (room must be 'announcing'/'done') |
| GET | `/api/results/{id}` | Public read-only results (no auth) |
| GET | `/api/health` | Uptime probe (see §12) — runs a trivial Supabase query and returns `{ ok: true }` or HTTP 503 |

---

## 15. Realtime channels (Supabase)

Subscribe on: `room:{roomId}`

**Transport:** Supabase **Broadcast** — the client subscribes via `supabase.channel('room:{roomId}').on('broadcast', { event: 'room_event' }, handler)`. All `RoomEvent` payloads are sent under the single broadcast event name `room_event`, discriminated by the `type` field. This is implemented in the `useRoomRealtime(roomId, onEvent)` React hook.

Events broadcast by server to this channel:
```typescript
type RoomEvent =
  | { type: 'status_changed'; status: RoomStatus }
  | { type: 'user_joined'; user: { id, displayName, avatarSeed } }
  | { type: 'user_left'; userId: string }
  | { type: 'now_performing'; contestantId: string }
  | { type: 'voting_progress'; userId: string; scoredCount: number }  // count only, not scores
  | { type: 'announce_next'; contestantId: string; points: number; announcingUserId: string }
  | { type: 'announce_turn'; userId: string }  // whose turn to announce
  | { type: 'score_update'; contestantId: string; newTotal: number; newRank: number }
```

In addition, Postgres Changes for `rooms`, `room_memberships`, `votes`, `results` are exposed via the `supabase_realtime` publication (see §13) so clients can optionally subscribe directly for DB-level signals (used as a fallback if a broadcast is missed during reconnect).

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

A committed runbook at the repo root walks a new operator from zero to a working stack: creating the Supabase project, copying the publishable + secret keys into `.env.local`, running `supabase/schema.sql`, enabling Realtime on the four relevant tables, verifying RLS is on, configuring UptimeRobot against `/api/health`, and wiring the Cloudflare → Vercel domain. This file is required — it is the handoff doc for anyone running the app independently of the original author.

---

## 18. Deferred to V2

- Google OAuth / persistent accounts
- PDF export
- AI-generated Eurovision-style avatars
- Pre-show predictions (top 3 picks before voting opens)
- Category weight adjustment post-room-creation
- PDF score cards
- Per-category award animations (distinct per template)
- Historical cross-room stats ("your voting history across all parties")
- NQ (non-qualification) predictions for semis

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
2. Join via link, PIN, or QR code on their phones
3. Vote on all or some contestants with autosave working
4. Use "I missed this" for any entry
5. Have the admin close voting and trigger scoring
6. Experience either live announcement or instant reveal
7. See the full leaderboard and all awards
8. Share a results link that works for anyone without an account
9. The present screen renders correctly when AirPlayed to a TV
10. Any user can switch between `en` / `es` / `uk` / `fr` / `de` at any time and the full UI (voting, announcement, awards) renders correctly in the chosen locale (§21)

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
- Score anchors (§7.3).
- Template names, category names, category hints for the three predefined templates in §7.1.
- All personality award names + stat labels (§11.2) and the "Best [Category]" category-award template.
- Country names displayed in the UI (the English keys of `COUNTRY_CODES` in `src/lib/contestants.ts` remain the internal lookup keys and are not translated).
- Hot-take placeholder and emoji-count helper copy.

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

Message files use ICU MessageFormat with nested namespaces: `common`, `onboarding`, `voting`, `templates`, `categories`, `awards`, `countries`, `errors`, `present`. ICU plural rules are used wherever counts appear (e.g. `"{points, plural, one {# point goes} other {# points go}} to {country}"`) — Ukrainian requires `one`/`few`/`many`/`other` plural arms.

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
- Ukrainian pluralization smoke test — confirms ICU plural arms resolve for 1 / 2 / 5 of each count-sensitive message.
- Scoring and API tests remain locale-agnostic and operate on the stable vote-key (`category.key ?? category.name`), never on display strings.
