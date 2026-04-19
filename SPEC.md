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
| `animate-score-pop` | scale 1 → 1.3 → 1 over 0.3s | Score tick on slider change / points reveal |
| `animate-rank-shift` | translateY(var(--shift-from)) → 0 over 0.3s | Live leaderboard row reorder |
| `animate-fade-in` | opacity 0 + translateY(8px) → full over 0.3s | Card/award reveal |
| `animate-shimmer` | backgroundPosition −200% → 200% looping 2s | Loading placeholders |

The range slider is styled globally in `globals.css` (`input[type="range"]` webkit/moz pseudo-elements) to a 28px gold thumb on an 8px muted track.

---

## 4. User identity & session management

### 4.1 Onboarding
New users (no valid localStorage token) see a single onboarding screen:
- Text input: display name (2–24 chars, trimmed, no special chars except spaces/hyphens)
- Avatar preview: DiceBear `fun-emoji` generated from the typed name in real-time (debounced 300ms)
- Optional: tap avatar to regenerate with a random seed suffix (gives them a few variants to pick)
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
3. If match(es) found → show confirmation UI: *"We found [Name] in this room — is that you?"* with their avatar displayed
4. If multiple matches (same name) → show all matching avatars, user picks
5. On confirmation → merge session, inherit all previous votes. New localStorage token issued.
6. If no match → treat as new user

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

**Step 2: Voting configuration**
- Select a scoring template (see §7)
- Or build custom categories
- Set announcement mode: Live or Instant (explained with a short description)
- Toggle: allow "Now performing" mode (admin can focus all users to current song)

**Step 3: Room ready**
- Display room PIN (6 alphanumeric chars, uppercase, excluding O/0/I/1 for readability)
- QR code pointing to room URL
- Shareable link: `eurovisionmaxxing.com/room/{roomId}`
- "Copy link" button, "Copy PIN" button
- "Start lobby" button → transitions room to `lobby` status and navigates admin to room view

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
- `scoring`: server computes all scores (brief transition, <1s)
- `announcing`: either live or instant mode
- `done`: results frozen, shareable link active

State transitions are admin-only actions. State is stored in `rooms.status` and broadcast via Supabase Realtime to all room subscribers. All connected clients react to state changes immediately.

### 6.4 Room join by PIN
Route: `eurovisionmaxxing.com/join`
- Single large PIN input field, auto-uppercase, 6-char limit
- On submit: `POST /api/rooms/join-by-pin` → redirect to room URL on success
- Error states: room not found, room already in `announcing` or `done` state

### 6.5 "Now performing" mode
When enabled by admin at room creation:
- Admin sees a "Now performing" control panel with a list of all contestants
- Tapping a contestant broadcasts `now_performing: contestantId` to all room subscribers
- All connected clients' voting UI snaps to that contestant's card
- Non-admin users see a small indicator: "🎤 Now performing: [Country] — [Song]"
- Users can still manually navigate away; the snap only triggers once per broadcast

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
  - Name: required, 2–24 chars, no special characters
  - Weight: optional number input, blank = 1, min 0.5, max 5, step 0.5
  - Hint: optional, max 80 chars, shown as tooltip on the voting card
- Drag-to-reorder (determines display order on voting card)
- Live weight influence preview: below the list, show each category's percentage of total weight
  - e.g. if Vocals=2, all others=1 with 5 categories: Vocals = 33%, others = 17% each
- Validation: at least 1 category required before room can be created

### 7.3 Score scale anchors
All categories use a 1–10 integer scale. Anchor labels shown on the slider:
- **1** — Devastating. A moment I will try to forget.
- **5** — Fine. Watched it. Won't remember it.
- **10** — Absolute masterpiece. My 12 points. Iconic.

These anchors appear on every voting card regardless of template. Anchor copy is translated via `t('voting.anchor1' | 'voting.anchor5' | 'voting.anchor10')`; see §21.

---

## 8. Voting interface

### 8.1 Layout (mobile-first)
- Full-screen single-contestant view
- Header: contestant flag emoji + country name + song title + artist name
- Running order indicator: "3 of 17"
- Body: category sliders, one per row
- Footer: "I missed this" button + Prev/Next navigation
- Jump-to: small button opens a scrollable drawer of all countries (flag + name), tapping any navigates directly

### 8.2 Category slider
- Range: 1–10, integer steps only
- Large touch target (min 44px height)
- Current value displayed prominently (large number)
- Anchor labels shown at 1 and 10 (small, muted)
- On first load, slider starts unset (no default value, shown as a distinct "not yet scored" state)
- Once touched, slider snaps to 5 as starting position and tracks touch normally
- A category is "scored" as soon as the slider is moved for the first time

### 8.3 "I missed this" button
- Shown per-contestant in the footer
- Tap → modal confirm: *"Mark [Country] as missed? We'll fill in an estimated score based on your average voting across other entries."*
- On confirm: contestant is marked `missed: true`, card shows a distinct "missed" state with the estimated score displayed as `~7` (with tilde prefix, dimmed/italic)
- If the user has no other votes yet, estimated score shows as `~5`
- User can undo "missed" status and vote normally until voting closes
- "Missed" state is visually clear but not shameful — just a fact

### 8.4 Projected score display
- Visible **only** on entries marked `missed: true`
- Computed as: user's average score per category across all their non-missed votes
  - e.g. if user has voted on 5 entries and their avg vocals is 6.2 → projected vocals = 6 (rounded)
- If user has voted on 0 entries: all projected scores default to 5
- Shown inline on the missed card, clearly labelled "Estimated" with `~` prefix
- Updated live as the user votes on more entries (Supabase Realtime subscription on own votes table)
- Once voting closes, projected scores are finalised as the actual filled values — displayed without the `~` in results

### 8.5 Autosave
- Every slider interaction triggers a debounced save (500ms) via `UPSERT` to `votes` table
- Visual indicator: small "Saving..." → "Saved" status in the corner, 1s display then fade
- On reconnect after network loss, re-sync from DB and re-apply any locally-cached unsaved changes (store in-memory)

### 8.6 Navigation
- Prev/Next arrows in footer; swipe gesture also works (left = next, right = prev)
- Running order determines default sequence
- If admin broadcasts "now performing", UI snaps to that contestant; user can navigate back
- Progress indicator: number of scored entries / total entries shown in header

### 8.7 Hot takes
- Optional per-contestant free-text field below the sliders
- 140 character limit, emoji-aware (emoji count as 2 chars)
- Placeholder: *"Your hot take on this performance..."*
- Shown in results screen next to user's avatar
- Can be left blank; shown only if filled

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
1. Each user sees their own results first:
   - Their Eurovision points list (who they gave 1 through 12)
   - Their hot takes displayed per country
2. "Ready to reveal" button — admin sees count of users who are ready
3. Admin presses "Reveal final results" → animated worst-to-best reveal of the group leaderboard
4. After leaderboard: awards screen (§11)

### 10.2 Live announcement mode
The "announce screen" (`/room/{roomId}/present`) is a dedicated fullscreen route, optimised for AirPlay/screen mirroring — no navigation chrome, designed for a TV.

**Flow:**
1. Random user order determined server-side and stored in `rooms.announcement_order` (array of userIds)
2. First user's turn begins. Their screen shows:
   - "You're announcing! Give your points from lowest to highest."
   - Their points list (1 through 12), one at a time
   - "Next" button to reveal the next point award
3. For each point reveal:
   - Announcer's screen shows: *"[N] point(s) go to... [Country]"* + Next button
   - All other screens (+ the present screen) show the leaderboard updating live
   - A country's score animates upward as points are added — other countries may shift in ranking
4. After announcing all 12 points: "Finish announcement" button
5. Next random user starts their announcement
6. Admin can tap "Announce for [User]" to take over for someone who left — admin reads their points aloud
7. After all users finish: transition to awards screen

**Realtime mechanism:**
- Announcement state stored in `rooms` table: `announcing_user_id`, `current_point_reveal_index`
- Each "Next" button tap calls `POST /api/rooms/{roomId}/announce/next`
- Server updates state, Supabase Realtime broadcasts to all subscribers
- No client ever drives state — server is authoritative

### 10.3 Presentation screen (`/room/{roomId}/present`)
- Fullscreen, no URL bar ideally (use PWA manifest + `display: standalone`)
- Shows the current live leaderboard: flag + country + running total, sorted by current score
- Animates rank changes when scores are added (smooth reorder transition, ~300ms)
- Shows whose turn it is to announce and which point value is next
- Designed for a 16:9 TV-ish aspect ratio but gracefully handles other ratios

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
| **Neighbourhood voters** | The pair of users with the highest pairwise Pearson correlation across all their scores (they voted most alike) |
| **The dark horse** | Contestant with the highest variance in total scores across all users (most divisive) |
| **Fashion stan** | User who gave the single highest score in the outfit/costume category across all their votes (or the category closest to "outfit" by name if custom) |
| **The enabler** | User whose 12 points went to the overall group winner |

**Spearman distance** = 1 − Spearman rank correlation coefficient. Computed in JavaScript using a simple rank-correlation implementation (no library needed — ~20 lines of code).

**Tiebreaking for personality awards:** if two users tie on any personality metric, both are listed as joint winners.

### 11.3 Awards screen
- Cinematic reveal: one award at a time, admin/presenter taps to advance
- Each award: large award name, winner's avatar + display name (or country flag for contestant awards), brief stat shown below
- Last award is always "The enabler" — good narrative closer
- After all awards: "Share results" button

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
- Whether "Neighbourhood voters" award should show on-screen as a pair or just individually
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
