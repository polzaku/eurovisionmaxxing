# Design — `/create` room-creation wizard

**Status:** approved · **Date:** 2026-04-20 · **SPEC refs:** §6.1 (3-step wizard), §6.2 (PIN), §5.3 (year/event), §7.1 (templates), §14 (API), §16 (routes)

## Purpose

Last Phase 2 item. Turns the `/create` stub into a functional 3-step wizard so admins can create a room end-to-end via UI (no more DevTools console snippets). On submission the admin lands at `/room/{id}` — the lobby built last session — closing the full host loop: landing → onboard → create → lobby → Start voting.

## User flow

1. Admin visits `/` (landing), taps **Start a room** → `/create`.
2. `/create` session guard: if no `emx_session` → `router.replace("/onboard?next=/create")`. After onboarding, admin returns to `/create` via the existing `next` handler.
3. **Step 1 (Event):** pick year + event → contestant count previews → Next.
4. **Step 2 (Config):** pick template → pick announcement mode → toggle "sync everyone to performing act" → Create room.
5. Wizard POSTs `/api/rooms`; on success advances to Step 3 with the returned `Room`.
6. **Step 3 (Ready):** shows PIN + QR + share link. Admin copies / shares as needed. Tapping **Start lobby** pushes to `/room/{roomId}` (room already in `lobby` status from creation).

## Wizard state machine

Single client component (`/create/page.tsx`) owns all wizard state via `useState`. No reducer — three steps with straightforward transitions.

```ts
type Step = 1 | 2 | 3;

interface Step1State {
  year: number;           // default: new Date().getFullYear()
  event: "semi1" | "semi2" | "final";  // default: "final"
  contestants: {
    kind: "idle" | "loading" | "ready" | "error";
    count?: number;
    preview?: Array<{ flag: string; country: string }>;
    errorMessage?: string;
  };
}

interface Step2State {
  templateId: "classic" | "spectacle" | "banger";  // default: "classic"
  announcementMode: "live" | "instant";            // default: "instant"
  allowNowPerforming: boolean;                     // default: false
}

interface Step3State {
  room: Room;  // from POST /api/rooms response
}

type CreateSubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };
```

Back button on Steps 2 and 3 decrements `step` without clearing state, so the admin can tweak Step 1 and proceed again. Step 3 Back is a safety net (not in SPEC but harmless) — returns to Step 2, admin can re-submit which creates a *different* room with a new PIN. Acceptable.

## Step 1 — Event selection

**Year:**
- `<select>` dropdown populated from `currentYear` back to 2000, descending. Default: current year.
- Per SPEC §5.3, all those years should be selectable; whether contestants exist for each is a runtime concern surfaced via the preview.

**Event:**
- Three radio cards labelled "Semi-Final 1", "Semi-Final 2", "Grand Final".
- Values map to `semi1`, `semi2`, `final`. Default: `final`.

**Contestant preview:**
- On year or event change, a 300 ms debounced `fetchContestantsPreview(year, event)` fires. The helper hits `GET /api/contestants?year={year}&event={event}`.
- **Loading state:** `<p className="animate-shimmer">Loading contestants…</p>`.
- **Ready state:** `<p>{count} countries loaded · {first three flag + country name joined by · } …</p>`.
- **Error state (§6.1 Step 1):** inline: "We couldn't load contestant data for this event. Try a different year or event." Next button disabled.

**Next button:** primary, right-aligned, disabled unless `contestants.kind === "ready"`.

## Step 2 — Voting configuration

### Template cards

Three cards (no Custom — deferred to Phase U A5–A8 per approved scope). Each card renders:

```
┌───────────────────────────────────────────────┐
│ The Classic                                   │
│ For fans who want to be fair and thorough.    │
│                                               │
│ • Vocals — Technical delivery and control…    │
│ • Music — Composition, arrangement, and…      │
│ • Outfit — The look. Does it serve?           │
│ • Stage performance — Movement, energy…       │
│ • Vibes — The ineffable…                      │
└───────────────────────────────────────────────┘
```

- Always-visible bullet list (no expand/collapse toggle).
- Each bullet: `category.name + " — " + category.hint`, truncated with `line-clamp-1` CSS to keep cards uniform height.
- Selected state: `ring-2 ring-primary`.
- Card `onClick` sets `templateId`.

Templates come from `VOTING_TEMPLATES` in `src/lib/templates.ts`. Custom (`id: "custom"`) is filtered out.

### Announcement mode

Two radio cards with SPEC §6.1 copy:
- **Live** — "Take turns announcing your points, Eurovision-style. Great with a TV."
- **Instant** — "Reveal the winner in one shot. Great if you're short on time."

Default: `instant` (matches SPEC §13 DB default).

### "Sync everyone to the performing act" toggle

- Boolean toggle. Default off.
- Info icon (`i` in a circle) triggers a small inline description: "Lets you tap the currently-performing country to bring all guests to that card during voting. Off by default."

### Buttons

- **Back** (secondary) — left-aligned.
- **Create room** (primary) — right-aligned.

On Create:
1. Set `submitState` to `{ kind: "submitting" }`. Button shows "Creating…" + disabled.
2. Resolve template's categories from `VOTING_TEMPLATES[templateId].categories`.
3. Call `createRoomApi({ year, event, categories, announcementMode, allowNowPerforming, userId: session.userId }, { fetch })`.
4. On success: advance to Step 3 with `{ room: result.room }`.
5. On failure: set `submitState` to `{ kind: "error", message: mapCreateError(result.code) }`. Render inline error below the buttons.

## Step 3 — Room ready

### PIN display
- Large centered mono: `text-4xl font-mono font-bold tracking-[0.5em]`.
- "Copy PIN" button next to it; on click copies PIN, label swaps to "Copied!" for 2 000 ms, then reverts. Matches the Phase U A12 behaviour at a simpler fidelity.

### QR code
- Generated client-side via `qrcode` package's `QRCode.toDataURL(url, { width: 256, margin: 1, errorCorrectionLevel: "M" })`.
- Target URL: `${NEXT_PUBLIC_APP_URL}/room/{roomId}` if `NEXT_PUBLIC_APP_URL` is set; otherwise `${window.location.origin}/room/{roomId}` as fallback.
- Rendered as `<img src={dataUrl} width={256} height={256} alt="Scan to join room" />`.
- Generation is effectful (async in useEffect); show a small spinner while rendering.

### Shareable link
- Text input (read-only) with the same URL. "Copy link" button with the same Copied-for-2s UX.

### Primary CTA
- **Start lobby** (full-width primary): `router.push(\`/room/${roomId}\`)`. Room is already in `lobby` status (POST /api/rooms sets that by default), so this is navigation-only.

### Back
- Present but small/secondary — "Back to config" — in case the admin wants to re-roll a different setup. Re-submitting creates a *new* room; the previous one is orphaned. Acceptable for MVP.

## Library helpers (pure, DI, unit-tested)

### `src/lib/create/api.ts`

```ts
export interface ContestantsPreview {
  count: number;
  preview: Array<{ flag: string; country: string }>; // first 3
}

export async function fetchContestantsPreview(
  year: number,
  event: "semi1" | "semi2" | "final",
  deps: { fetch: typeof globalThis.fetch }
): Promise<{ ok: true; data: ContestantsPreview } | { ok: false; code: string; message: string }>;

export interface CreateRoomInput {
  year: number;
  event: "semi1" | "semi2" | "final";
  categories: VotingCategory[];
  announcementMode: "live" | "instant";
  allowNowPerforming: boolean;
  userId: string;
}

export async function createRoomApi(
  input: CreateRoomInput,
  deps: { fetch: typeof globalThis.fetch }
): Promise<{ ok: true; room: Room } | { ok: false; code: string; field?: string; message: string }>;
```

Same tagged-union shape as `src/lib/room/api.ts` — reuses the runRequest + unwrap pattern. Handles happy / 4xx / 5xx / network.

### `src/lib/create/errors.ts`

`mapCreateError(code: string | undefined): string`. Entries:

| Code | Copy |
|---|---|
| `INVALID_YEAR` | "That year isn't available. Try a different one." |
| `INVALID_EVENT` | "That event isn't available for this year." |
| `INVALID_CATEGORIES` | "Something's off with the category setup." |
| `INVALID_CATEGORY` | "One of the categories isn't valid." |
| `INVALID_ANNOUNCEMENT_MODE` | "Pick Live or Instant announcement mode." |
| `INVALID_USER_ID` | "Your session is invalid. Please re-onboard." |
| `INVALID_BODY` | "Something went wrong. Please try again." |
| `INTERNAL_ERROR` | "We hit a snag on our end. Please try again in a moment." |
| `NETWORK` | "We couldn't reach the server. Check your connection." |
| default | "Something went wrong. Please try again." |

## Components

### `src/components/create/EventSelection.tsx`

Props:
```ts
interface EventSelectionProps {
  year: number;
  event: "semi1" | "semi2" | "final";
  contestants: Step1State["contestants"];
  onChange: (patch: Partial<Pick<Step1State, "year" | "event">>) => void;
  onNext: () => void;
}
```

Pure presentational. Parent (the page) owns the debounced fetch side-effect triggered by `year`/`event` changes.

### `src/components/create/VotingConfig.tsx`

Props:
```ts
interface VotingConfigProps {
  templateId: Step2State["templateId"];
  announcementMode: Step2State["announcementMode"];
  allowNowPerforming: boolean;
  submitState: CreateSubmitState;
  onChange: (patch: Partial<Step2State>) => void;
  onBack: () => void;
  onSubmit: () => void;
}
```

Imports `VOTING_TEMPLATES` directly from `@/lib/templates`, filters out Custom.

### `src/components/create/RoomReady.tsx`

Props:
```ts
interface RoomReadyProps {
  room: Room;
  onBack: () => void;
  onStartLobby: () => void;
}
```

Owns the QR-generation `useEffect` (imports `qrcode` dynamically so it doesn't bloat the bundle for other routes — actually moot since /create is the only caller, import statically).

## Files

| Path | Kind |
|---|---|
| `src/lib/create/api.ts` | **new** |
| `src/lib/create/api.test.ts` | **new** |
| `src/lib/create/errors.ts` | **new** |
| `src/lib/create/errors.test.ts` | **new** |
| `src/components/create/EventSelection.tsx` | **new** |
| `src/components/create/VotingConfig.tsx` | **new** |
| `src/components/create/RoomReady.tsx` | **new** |
| `src/app/create/page.tsx` | modify — full wizard orchestrator + session guard |

No backend changes. No schema migration. No new deps (`qrcode` already in `package.json`).

## Test strategy

- **Pure libs (automated):** `src/lib/create/api.test.ts` + `src/lib/create/errors.test.ts`. Consistent with every prior UI PR.
- **Components + wizard flow:** manual browser smoke per CLAUDE.md. RTL + jsdom out of scope.

**Manual smoke matrix** (cases for Task 10):
- Cold admin hits `/create` without session → redirected to `/onboard?next=/create`, onboards, returns to `/create` fresh at Step 1.
- Pick year 2025 + Grand Final → preview loads → Next available.
- Pick year 2026 + Grand Final → preview errors ("We couldn't load…") → Next disabled.
- Step 2 → select each template card in turn → selected ring appears on clicked card only.
- Step 2 → Create room → advances to Step 3 with a PIN and QR visible.
- Copy PIN → clipboard contains PIN, button label says "Copied!" for 2 s.
- Copy link → clipboard contains `{APP_URL}/room/{id}`, label swaps same way.
- QR code visible at roughly 256 px square.
- Start lobby → lands at `/room/{roomId}` lobby view with self as only member + ★ badge.
- Back from Step 3 → Step 2 shows previous selections preserved.

## Out of scope

- Custom template + full category builder (§7.2) — Phase U A5–A8.
- Expand/collapse template-card animation (Phase U A1) — this PR does always-visible bullets.
- Lobby-edit affordance for owner (Phase U A2).
- "Copied!" styled toast with fade animation (Phase U A12). MVP does inline label swap.
- Year-data availability validation (e.g. refuse 2026 at year picker) — user experiences the failure via the preview step instead.
- i18n of template names, descriptions, mode copy — Phase 1.5 T11–T12.
- Telemetry / analytics on wizard completion — no infra yet.

## Non-goals

- Persisting wizard state to sessionStorage across refresh — simple restart is fine for MVP.
- Resuming a half-created room if POST /api/rooms partially succeeded — rollback already covered server-side in `createRoom`.
