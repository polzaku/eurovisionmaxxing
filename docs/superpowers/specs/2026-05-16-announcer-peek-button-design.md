# Announcer "Peek your picks" button — design

**TODO #10, slice A** — "let the announcer see their own leaderboard at any
time during their turn".

The full TODO asked for **both** a peek button AND a new `calibration`
room state for collective prep before announcements start. We split
those into two PRs:
- **This PR (slice A)** — announcer peek button only. Ships tonight.
- **Slice B (deferred)** — `calibration` room state. Bigger change
  (Supabase enum migration, runScoring transition, new view,
  start-announcing API, status_changed broadcast). Documented separately
  when picked up.

## Decision summary

Add a single "Peek your picks" button on the **active announcer's**
phone during their turn (both `full` and `short` announcement styles).
Tapping opens a bottom sheet listing the announcer's own 1→12 ranking
for this room: country flag, country name, points they're giving,
song title.

The sheet is dismissable. Available at any time the announcer is the
active driver (not on a passive turn, not while watching someone else).

## Data flow

Today `breakdowns: UserBreakdown[]` is only included in the `done`
payload of `/api/results` (see `loadResults.ts` lines 100/108/651). The
`announcing` payload (line 420) does NOT carry breakdowns — for
spoiler-prevention, the room can't see who picked what until the show
is over.

We extend `loadResults`'s `announcing` branch to include exactly one
breakdown: the **active announcer's own row**, gated by the caller's
`userId` matching `announcement.announcingUserId`. The caller's userId
is already passed to `loadResults` via the API route's session lookup.

- Other viewers (not the active announcer) get `announcerOwnBreakdown:
  null` and the Peek button isn't rendered.
- The active announcer (or their delegate, if the owner has taken
  over) gets their breakdown payload. The client filters/sorts the
  picks; no further server work.

No new API, no new broadcast, no schema change. One narrow server-side
addition to the announcing-results payload.

## Surfaces

### The button

Where: rendered inside the active-driver branch of `<AnnouncingView>`
(both `full` and `short` styles). Inline below the existing reveal CTA
(full) or alongside the short-style reveal card.

When: `isActiveDriver === true` AND the announcer's breakdown is
available in the results payload (i.e. their picks exist server-side
since `runScoring`).

Visual: secondary-style button, small. Icon: 👀 (or a similar
unambiguous glyph). Copy: `Peek your picks`.

Locale keys: `announcing.peek.button`, `announcing.peek.sheetTitle`,
`announcing.peek.empty`.

### The sheet

A bottom sheet (`role="dialog"`, focus-trap, ESC-dismiss) with:
- Header: "Your picks" + close button.
- Ordered list, top-to-bottom by points descending:
  - `12` — flag — country — song
  - `10` — flag — country — song
  - `8` … down to `1`.
- Footer (optional): faint note "Only you can see this".

Empty state: if the announcer's breakdown has no picks (degenerate —
shouldn't happen post-runScoring), show "No picks yet" copy.

### Reusable component

The list itself is a new `<UserPicksList>` component taking
`{ picks: UserBreakdownPick[], contestants: Contestant[] }`. Reused
later by the calibration view in slice B.

## Out of scope

- The `calibration` room state (slice B).
- Showing other users' picks (would spoil the show).
- Highlighting picks the announcer has already revealed vs not — the
  ordered list inherently shows next-to-reveal at top (the unrevealed
  12 is always the first entry until revealed).
- Server changes (unless `/api/results` announcing payload doesn't
  carry the announcer's own breakdown — investigate during
  implementation; extend only the active-announcer slot if needed).

## Test plan

**Unit (RTL)**:
- `<UserPicksList>`: renders one row per pick, sorted desc by points,
  with flag + country + song. Empty-state copy when picks=[].
- `<AnnouncingView>` extension:
  - Active announcer in `full` style sees the Peek button.
  - Active announcer in `short` style sees the Peek button.
  - Passive announcer (delegate handed off, currentUserId is announcer
    but delegate is admin) does NOT see the Peek button.
  - Guest watching does NOT see the Peek button.
  - Tapping the button opens the sheet; sheet shows the announcer's
    picks; ESC + close button dismiss.

**Playwright**:
- One smoke spec: drive `/room/<id>` as the active announcer (session
  seeded, announcing state stubbed, results payload includes the
  announcer's breakdown), assert button is visible, tap, assert the
  sheet renders with the picks. Same pattern as the
  `tests/e2e/voting-retract-savechip.spec.ts` we used for #1.

## File touch-list

- `src/components/voting/UserPicksList.tsx` (new — reusable)
- `src/components/voting/UserPicksList.test.tsx` (new)
- `src/components/room/PeekPicksButton.tsx` (new — button + sheet
  composition wired around `UserPicksList`)
- `src/components/room/PeekPicksButton.test.tsx` (new)
- `src/components/room/AnnouncingView.tsx` — render the button in
  the active-driver branch (both styles)
- `src/components/room/AnnouncingView.test.tsx` — new cases
- `src/locales/{en,de,es,fr,uk}.json` — new keys
- `tests/e2e/peek-your-picks.spec.ts` (new Playwright smoke)
- `src/lib/results/loadResults.ts` — extend the `announcing` payload
  type with `announcerOwnBreakdown: UserBreakdown | null` and populate
  only when the caller's userId matches `announcement.announcingUserId`
  (or the active delegate). Add unit tests covering both the
  "is-announcer → breakdown present" and "is-watcher → null" cases.
- `src/lib/results/loadResults.test.ts` — extend with the two new
  cases above.
- `src/app/api/results/[id]/route.ts` — no change expected (the new
  field passes through the existing serializer).

## Risk

Low-medium.
- Server change is narrow: extend `loadResults`'s `announcing`
  payload with `announcerOwnBreakdown`. Spoiler-safety hinges on the
  userId gate — covered by the two new loadResults tests.
- Sheet focus-trap + accessibility add a tiny surface for bugs;
  mitigated by RTL coverage.
- No DB schema, no migration, no broadcast changes.
