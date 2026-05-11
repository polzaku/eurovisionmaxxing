# PR C — Short live reveal chooser + host copy (R4 §10.2.2) — Implementation Design

**Slice:** PR C of 3 (final). PR A landed the schema + server orchestrator (#104); PR B landed the live UI surfaces (#105). PR C exposes the feature through normal admin flow: a sub-radio under "Live" in both the create wizard and the lobby-edit panel, plus the three host-facing copy pieces (wizard tooltip, lobby info card, present-screen first-load overlay).

After this PR ships, the feature is fully discoverable. Operators no longer need a direct DB write to enable it.

**Product spec of record:** SPEC §10.2.2 lines 1022–1028 — the three host-facing copy pieces — plus §6.1 line 352 (the wizard sub-radio under Live).

## Surfaces

| Surface | When | New component / change |
|---|---|---|
| **Create wizard step 2** | Admin selects `announcementMode = live` | Sub-radio appears below the Live card: *Full reveal* (default) / *Short reveal — Eurovision style* + info-button → tooltip with the locked copy |
| **Lobby-edit panel** | Owner viewing the lobby of a `live` room (status=lobby) | Same sub-radio appears beneath the existing Live/Instant toggle. Disabled / hidden when mode=instant |
| **Lobby info card** | `style=short` + status ∈ {lobby, voting, voting_ending, scoring} + viewer is admin | Renders a callout above the start-voting CTA: *"Short reveal is on. Each spokesperson will only need to reveal their 12 points live. Open `/room/{id}/present` on a TV before voting ends — that's the announcer's stage."* Suppressed once status leaves lobby/voting (it's a pre-show explainer) |
| **Present-screen first-load overlay** | `/present` route + `style=short` + room.status=announcing + viewer hasn't seen the overlay in this room before | 5-second dismissible banner: *"Short reveal mode — the announcer's phone has a single 'Reveal 12 points' button. Lower scores tick on automatically."* Persists a `seen` flag in `sessionStorage` keyed by roomId so refreshes don't re-show |

## Files touched

| File | Action | Notes |
|---|---|---|
| `src/locales/en.json` | modify | 8 new keys (see Locale section) |
| `src/locales/{es,uk,fr,de}.json` | modify | empty stubs for parity |
| `src/components/create/AnnouncementStyleSubRadio.tsx` | create | shared sub-radio component (used by wizard + lobby-edit) |
| `src/components/create/AnnouncementStyleSubRadio.test.tsx` | create | RTL tests |
| `src/components/create/VotingConfig.tsx` | modify | render the sub-radio when `announcementMode === 'live'`; track `announcementStyle` state; pass to onChange |
| `src/components/create/VotingConfig.test.tsx` | modify | new cases for the sub-radio render gate |
| `src/app/create/page.tsx` (or wherever VotingConfig is mounted) | modify | thread `announcementStyle` through the create flow into `createRoom()` |
| `src/components/room/LobbyView.tsx` | modify | accept new `announcementStyle` + `onChangeAnnouncementStyle` props; render the sub-radio under the existing mode toggle; render the lobby info card when `style=short && isAdmin` |
| `src/components/room/LobbyView.test.tsx` | modify | new cases for sub-radio + info card |
| `src/app/room/[id]/page.tsx` | modify | pass `announcementStyle` + an `onChangeAnnouncementStyle` callback that calls `patchAnnouncementMode` with the style patch (PR A wired the server) |
| `src/lib/room/api.ts` | modify (or verify) | confirm `patchAnnouncementMode` accepts an optional `style` parameter and forwards it |
| `src/components/present/PresentScreen.tsx` | modify | render the 5s first-load overlay banner when `style=short && status=announcing` and `sessionStorage` flag not set |
| `src/components/present/PresentScreen.test.tsx` | modify | new cases for the overlay |
| `tests/e2e/announce-short-style-chooser.spec.ts` | create | Playwright happy-path: open wizard → select Live → toggle Short → submit → assert created room has `announcement_style='short'` via API |

## Locale keys

Add under a new `announcementStyle.*` namespace (kept separate from `announcementMode.*` so existing keys aren't conflated):

```json
{
  "announcementStyle": {
    "subradioLabel": "Reveal style",
    "full": {
      "label": "Full reveal",
      "tagline": "Each spokesperson reveals all 10 points live, 1 through 12."
    },
    "short": {
      "label": "Short reveal — Eurovision style",
      "tagline": "Only the 12-point reveal is live. Lower scores tick on automatically.",
      "tooltip": "Just like the real Eurovision: only 12-point reveals are live, the rest tick on automatically. Best on a TV with everyone watching.",
      "lobbyCard": {
        "title": "Short reveal is on",
        "body": "Each spokesperson will only need to reveal their 12 points live. Open the present view on a TV before voting ends — that's the announcer's stage."
      },
      "presentOverlay": {
        "title": "Short reveal mode",
        "body": "The announcer's phone has a single \"Reveal 12 points\" button. Lower scores tick on automatically.",
        "dismiss": "Got it"
      }
    }
  }
}
```

8 keys with content in en.json; mirror as empty stubs in es/uk/fr/de.

## AnnouncementStyleSubRadio component

Single shared component used by both the wizard and lobby-edit:

```tsx
interface AnnouncementStyleSubRadioProps {
  value: 'full' | 'short';
  onChange: (next: 'full' | 'short') => void;
  /** When true, the buttons are disabled (e.g. a write is in flight). */
  disabled?: boolean;
  /** When true, renders the info-button + tooltip below the short option. */
  showTooltip?: boolean;
}
```

Renders two compact buttons stacked vertically (matching the existing AnnouncementModeCard style). The "Short" button has an `i` info-button that toggles an expanded tooltip area with the SPEC §10.2.2 copy. The buttons use `aria-pressed` for state.

## Lobby info card

Renders inside `LobbyView` above the existing template-picker / mode-toggle sections, but only when:
- `isAdmin === true`
- `announcementStyle === 'short'`
- `roomStatus === 'lobby'` (we use the existing `status` prop; the SPEC line 1027 says "visible to admin until voting starts")

Shape: small bordered card with the title in bold and the body below.

## Present-screen overlay banner

A new sub-component inside `PresentScreen` (or co-located file). Renders only when:
- `announcementStyle === 'short'`
- `status === 'announcing'`
- `sessionStorage.getItem(`emx_short_overlay_${roomId}`) === null` (i.e. not dismissed/shown before)

On mount: writes the flag immediately so refreshes don't re-show. Auto-dismisses via `setTimeout(... 5000)` and exposes a "Got it" button for manual dismissal.

`sessionStorage` (not localStorage) is intentional: a fresh tab gets the overlay once, but it doesn't persist across sessions — matches "first time" semantics per the spec.

The overlay sits ABOVE the leaderboard, occupying the top portion of the screen for 5 seconds, then fades away. Reduced-motion safe.

## Wiring through the create flow

The wizard's parent component (likely `src/app/create/page.tsx` or a CreateWizard component) tracks the current step's state. It already has `announcementMode` in its state shape. Add `announcementStyle: 'full' | 'short'` defaulting to `'full'`. When the user submits, pass it into the `createRoom()` API call (PR A wired the create endpoint to accept it).

## Wiring through lobby-edit

`LobbyView`'s current pattern: the page (`/room/[id]/page.tsx`) passes `onChangeAnnouncementMode` which calls `patchAnnouncementMode(roomId, userId, { mode })`. PR A extended the underlying API to accept `style`. Two integration choices:

- **A) Extend `onChangeAnnouncementMode` to accept both mode and style** — single callback, callers pass either or both
- **B) Add a separate `onChangeAnnouncementStyle` callback** — cleaner separation, two distinct API calls

Recommendation: **B**. The two are independent UX events (changing mode toggles the style sub-radio's visibility; changing style is a separate decision). Cleaner test surface and call-site clarity.

The lobby page calls `patchAnnouncementMode` with `{ style }` (not `{ mode }`) under the hood — PR A's server already accepts that shape, the mode field is required so we pass the current mode alongside. Actually looking at PR A again, the API requires both `mode` and `style` (with `style` optional). So `patchAnnouncementMode(roomId, userId, mode: 'live', style: 'short')` — the mode is whatever is currently set.

## Playwright spec

`tests/e2e/announce-short-style-chooser.spec.ts`:

1. Sign in via the existing onboarding flow (or set localStorage like the other specs).
2. Navigate to `/create`.
3. Walk Step 1 (year + event) using `--state` fixtures or just clicking through.
4. On Step 2: assert the Live card is visible. Click it (if not already selected). Assert the sub-radio appears.
5. Click "Short reveal — Eurovision style".
6. Click "Create room".
7. After redirect to `/room/{id}`: fetch `/api/rooms/{id}` (or `/api/results/{id}`) and assert `announcementStyle: 'short'` in the response payload.

Skips gracefully without env (existing pattern).

## Test plan (unit)

- **AnnouncementStyleSubRadio.test.tsx** — 4 cases: renders both options, toggles via callback, tooltip toggles on info-button, disabled state suppresses callbacks.
- **VotingConfig.test.tsx** — 3 new cases: sub-radio appears only when announcementMode='live'; selecting 'short' propagates to onChange; sub-radio is absent when mode='instant'.
- **LobbyView.test.tsx** — 3 new cases: sub-radio renders when admin + mode='live'; info card renders when style='short' + admin; info card absent for guest viewers.
- **PresentScreen.test.tsx** — 3 new cases: overlay renders under short + announcing; overlay suppressed when sessionStorage flag set; "Got it" button dismisses.

## Risk

- **sessionStorage interaction in tests:** jsdom supports sessionStorage. Tests need to clear the flag in `beforeEach` and explicitly set it for "already dismissed" cases.
- **patchAnnouncementMode signature change:** PR A added an optional `style` field. If the lobby-edit currently passes only `{ mode }`, no caller breaks. Adding `{ mode, style }` calls is purely additive.
- **Wizard parent state file:** the create page might track step state inline or via a separate state machine. Read the file before assuming structure.

## Rollout

1. Merge PR C.
2. R4 §10.2.2 is fully shipped. Admins discover the feature through normal flow.
3. (Operator) Optional: a smoke test creating a short-style room via the wizard, walking through one turn end-to-end on a real device.
4. SPEC §10.2.2 line 518's TODO bullet can be ticked.

## Out of scope

- L3 translation pass for the 8 new locale keys (Phase L).
- Visual polish for unusual TV aspect ratios (operator-discovered post-ship).
- Toggle behaviour when admin tries to flip mode → live → style → short while status != lobby (server returns ROOM_NOT_IN_LOBBY, client surfaces a generic error — already covered by the existing lobby-edit error handling).
