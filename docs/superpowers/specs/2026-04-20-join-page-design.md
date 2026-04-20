# Design — `/join` PIN input page

**Status:** approved · **Date:** 2026-04-20 · **SPEC refs:** §4 (sessions), §6.4 (join flow), §6.2 (PIN charset), §21 (i18n — future)

## Purpose

Client-side page that lets a guest type a room PIN and land in `/room/{id}`. First UI task of Phase 2. Establishes the client-side patterns (form state, fetch wrapper, session handling, error display, redirect) that `/create` and `/room/[id]` will reuse.

## User flow

### Common path — session present

1. User arrives at `/join` with a valid `emx_session` in localStorage.
2. Types 6 chars into the `PinInput`. Each char auto-uppercases and is filtered against `PIN_CHARSET`.
3. On the 6th char, `PinInput.onComplete(pin)` fires.
4. Page POSTs `/api/rooms/join-by-pin` with `{ pin, userId }`.
5. On 200 → `router.push(\`/room/${roomId}\`)`.
6. On 4xx/5xx → inline error rendered below the input; **typed PIN stays in the input** (SPEC §6.4) so the user can correct a typo.

### Cold path — no session

1. User arrives at `/join` with no `emx_session`.
2. Types a PIN freely.
3. On `onComplete`, page stashes PIN to `sessionStorage["emx_pending_pin"]` and `router.push("/onboard?next=/join")`.
4. User onboards; `OnboardingForm`'s existing `next` handler routes back to `/join`.
5. On mount, `/join` reads both `emx_session` (now present) and `emx_pending_pin`, clears the stash, and auto-submits with the recovered PIN — same path as the common flow from step 4 onward.

### Session stash semantics

- **Key:** `sessionStorage["emx_pending_pin"]`. Stores a single string — the normalized uppercase PIN.
- **Cleared:**
  - On successful auto-resume at mount (before the fetch fires, to avoid a loop on redirect back).
  - On mount when a PIN is stashed but there's still no session (stale; avoid silent auto-submit after tab reload).
  - Not cleared on an unsuccessful auto-resume — the resulting error renders inline and the user can correct manually.
- **Not used for:** prefilling the input on a fresh page visit. sessionStorage only feeds the onboard round-trip.

### Mount decision table

| `emx_session` | `emx_pending_pin` | Action |
|---|---|---|
| yes | yes | Clear stash, auto-submit with stashed PIN |
| yes | no | Idle; wait for user to type |
| no | yes | Clear stash, idle |
| no | no | Idle |

## Client state machine

Three states:

- `idle` — user typing or waiting; no error.
- `submitting` — fetch in flight; `PinInput` visually disabled.
- `error` — fetch rejected; inline message shown; PIN characters retained.

Transitions:

- `idle → submitting` on `onComplete` (when session present) or on auto-resume.
- `submitting → idle` is never needed — success redirects away, failure goes to `error`.
- `error → submitting` when user edits the PIN to 6 chars again (retriggers `onComplete`).

## Error mapping

Pure helper `mapJoinError(code, defaultMsg?): string` at `src/lib/join/errors.ts`.

| `error.code` | User-facing message |
|---|---|
| `ROOM_NOT_FOUND` | "No room matches that PIN. Check with the host." |
| `ROOM_NOT_JOINABLE` | "This room isn't accepting new members right now." |
| `INVALID_PIN` | "That doesn't look like a valid room PIN." |
| `INVALID_USER_ID` | "Your session is invalid. Please re-onboard." |
| `INVALID_BODY` | "Something went wrong. Please try again." |
| default / `INTERNAL_ERROR` / unknown | "Something went wrong. Please try again." |

(Phase 1.5 T9 will later translate these via `errors.*` keys. For now English-only.)

## Component changes

### Existing `PinInput` enhancements

Minimal additions to `src/components/ui/PinInput.tsx`:

1. Add `autocomplete="one-time-code"` to the `<input>` — unlocks iOS SMS autofill + password manager UX per Phase R10.
2. Add optional `disabled?: boolean` prop. When `true`: input is read-only, `opacity-60`.
3. Add optional `initialValue?: string` prop. When provided: input's initial state is this value (still uppercased + charset-filtered). If the processed initialValue reaches `length`, `onComplete` fires synchronously in an effect — enables the auto-resume flow without the caller needing to separately wire it.

### `PinInput` does NOT change behaviourally in existing uses

The component is currently only imported by the `/join` stub. But to protect against future callers, the new props are optional and the old single-signature behaviour is preserved when they're omitted.

## Library helpers (pure, DI-style)

Three new files under `src/lib/join/`. Each pure + independently testable.

### `src/lib/join/errors.ts`

```ts
export function mapJoinError(code: string | undefined): string { ... }
```

### `src/lib/join/pendingPin.ts`

Injected `Storage` dep so tests can use a fake.

```ts
export function stashPendingPin(storage: Storage, pin: string): void;
export function readPendingPin(storage: Storage): string | null;
export function clearPendingPin(storage: Storage): void;
```

Key constant `PENDING_PIN_STORAGE_KEY = "emx_pending_pin"` exported for the page.

### `src/lib/join/submitPin.ts`

```ts
export interface SubmitPinSuccess { ok: true; roomId: string; }
export interface SubmitPinFailure {
  ok: false;
  code: string;      // ApiErrorCode-ish
  field?: string;
  message: string;   // server's message (English fallback)
}
export type SubmitPinResult = SubmitPinSuccess | SubmitPinFailure;

export interface SubmitPinDeps {
  fetch: typeof globalThis.fetch;
}

export async function submitPinToApi(
  input: { pin: string; userId: string },
  deps: SubmitPinDeps
): Promise<SubmitPinResult>;
```

Wraps `fetch("/api/rooms/join-by-pin", {...})`. Parses JSON once, handles `res.ok === true` (extracts `roomId`), `res.ok === false` (extracts `error.{code, field, message}`), and network errors (throws caught here → returns a failure with code `"NETWORK"`).

## Files

| Path | Kind |
|---|---|
| `src/app/join/page.tsx` | modify (currently a 15-line stub) |
| `src/components/ui/PinInput.tsx` | modify — add 3 props + `autocomplete="one-time-code"` |
| `src/lib/join/errors.ts` | **new** |
| `src/lib/join/errors.test.ts` | **new** — table test |
| `src/lib/join/pendingPin.ts` | **new** |
| `src/lib/join/pendingPin.test.ts` | **new** — storage round-trips against a `FakeStorage` |
| `src/lib/join/submitPin.ts` | **new** |
| `src/lib/join/submitPin.test.ts` | **new** — mocked `fetch` for happy / 404 / 409 / 500 / network-error |

## Test strategy

- **Pure lib helpers (Tasks above):** Vitest with DI-injected deps. Consistent with every other lib in the repo.
- **Page component wiring:** not automated. The project doesn't have React Testing Library + jsdom set up, and adding that tooling is a cross-cutting decision that deserves its own PR. CLAUDE.md already requires manual browser smoke for UI changes — that covers the wiring for this MVP page.
- **Manual smoke matrix (before claiming complete):**
  - No session + no stash → type PIN → redirected to `/onboard?next=/join`; stash seen in DevTools.
  - Complete onboard → land on `/join` → auto-submits → lands in `/room/{id}` (404-stub is fine — Phase 2 hasn't built the lobby yet).
  - With session + known room PIN → type → lands in `/room/{id}`.
  - With session + unknown PIN → type → inline "No room matches that PIN." PIN chars retained.
  - With session + announcing room → type → inline "This room isn't accepting new members right now."

## Data flow diagram (text)

```
mount
  ├─ session + stash:  clearStash → submitPinToApi → redirect
  ├─ session only:     idle
  ├─ stash only:       clearStash → idle
  └─ neither:          idle

idle (user types PIN → 6 chars)
  └─ onComplete(pin)
       ├─ no session: stashPendingPin → router.push("/onboard?next=/join")
       └─ session:    setState(submitting) → submitPinToApi
                        ├─ ok:   router.push(`/room/${roomId}`)
                        └─ err:  setState(error) + mapJoinError(code)
```

## Out of scope

- Full visual slot overlay (Phase R10 §6.4) — the existing `tracking-[0.5em]` monospace treatment is acceptable for MVP. Slot-overlay polish is its own PR.
- `/join?pin=…` URL-prefill — not in SPEC.
- Retry-button UX on 5xx — user can simply edit a char and the state machine re-triggers.
- Adding React Testing Library + jsdom — cross-cutting tooling decision, separate PR.
- i18n of error strings — Phase 1.5 T9.
- Logging / telemetry — deferred, no infra yet.
