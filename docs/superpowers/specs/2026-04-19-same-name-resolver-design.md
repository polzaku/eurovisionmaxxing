# Same-name resolver flow — design

**Date:** 2026-04-19
**SPEC reference:** §4.3 (Rejoin logic — "Different device" branch), §13 (`users`, `room_memberships`), §14 (API routes)
**TODO.md item:** Phase 1 — fourth bullet ("Same-name resolver flow (§4.3)")

---

## 1. Goal

Let a returning user who has no `emx_session` in localStorage (new device, cleared storage) reclaim their identity inside a specific room by picking their own avatar out of a set of same-name candidates, without leaking other guests' display names. SPEC §4.3 accepts "same name in same room" as the credential for this MVP flow; the PIN on the share link is the bouncer.

This is the last Phase 1 item (all Phase 0 items and the other four Phase 1 items are landed, including the `apiFetch` session-refresh wrapper this flow will use).

## 2. Architecture overview

Two new API routes, one existing route untouched, one `OnboardingForm` state-machine extension, one tiny guard on `/room/[id]`. Follows the same thin-route-adapter + pure-handler layout established by `src/lib/auth/{onboard,rejoin}.ts`.

- `POST /api/auth/candidates` — pre-flight lookup. No writes. Returns `{candidates: Array<{userId, avatarSeed}>}`.
- `POST /api/auth/claim` — identity merge. Rotates `rejoin_token_hash`, refreshes `last_seen_at`, returns the same session shape as `/onboard`.
- `POST /api/auth/onboard` — unchanged. Handles "no matches" and the "Create new identity" escape hatch.
- `src/components/onboarding/OnboardingForm.tsx` — extended with a picker step between name submit and onboard.
- `src/app/room/[id]/page.tsx` — small client-side guard that redirects to `/onboard?next=/room/<id>` when no session.

## 3. Onboarding state machine

```
form  ──submit──▶  candidates(roomId, name)
                        │
                        ├─ empty ─────▶ onboard POST ──▶ session + redirect
                        └─ non-empty ─▶ picker step
                                            │
                                            ├─ tap avatar ─▶ claim POST ──▶ session + redirect
                                            └─ "Create new" ─▶ onboard POST + redirect
```

- `roomId` is parsed once from the sanitized `next` query param using a regex that matches `/^\/room\/([A-Za-z0-9-]+)$/`. If `next` is not a room URL, the pre-flight is skipped entirely — same-name lookup only fires when onboarding into a room context.
- Picker step hides the name input and renders a full-step-swap layout (decided in brainstorm Q4): title + subcopy + avatar grid + persistent **Create new identity** button + small **← Change name** link that returns to the form. No modal, no inline-below-form variant.
- The "Create new" escape hatch posts to `/api/auth/onboard` like a normal first-time user. The server doesn't know or care that candidates existed; the client simply stops offering the picker for this in-progress session.

## 4. API contracts

All error responses use the existing `apiError(code, message, status, field?)` helper from `src/lib/api-errors.ts`. Request validation follows the same pattern as the onboard/rejoin routes.

### 4.1 `POST /api/auth/candidates`

Request body:

```ts
{ displayName: string, roomId: string }
```

Responses:

| Status | Shape | When |
|---|---|---|
| 200 | `{ candidates: Array<{ userId, avatarSeed }> }` | success (including empty array — no matches) |
| 400 | `apiError("INVALID_BODY", …)` | non-object / non-JSON body |
| 400 | `apiError("INVALID_DISPLAY_NAME", …, "displayName")` | name fails `DISPLAY_NAME_REGEX` |
| 400 | `apiError("INVALID_ROOM_ID", …, "roomId")` | roomId not a valid UUID |
| 404 | `apiError("ROOM_NOT_FOUND", …)` | `rooms.id` does not exist |

Notes:
- Response includes only `userId` and `avatarSeed`. No `display_name`, no `last_seen_at`, nothing else — the "avatar-first" SPEC wording is enforced at the API, not just the UI.
- Empty array is a 200, not a 404. 404 is reserved for "the room itself doesn't exist."

### 4.2 `POST /api/auth/claim`

Request body:

```ts
{ userId: string, roomId: string, displayName: string }
```

Responses:

| Status | Shape | When |
|---|---|---|
| 200 | `{ userId, rejoinToken, displayName, avatarSeed }` | success — identical shape to onboard |
| 400 | `apiError("INVALID_BODY", …)` | non-object / non-JSON body |
| 400 | `apiError("INVALID_DISPLAY_NAME" / "INVALID_ROOM_ID" / "INVALID_USER_ID", …, field)` | shape failures |
| 404 | `apiError("CANDIDATE_NOT_FOUND", …)` | any of: user doesn't exist, display_name mismatch (ci/trim), user not in that room |

Notes:
- Single 404 code for all three claim-verification failures — do not leak which piece mismatched.
- Side effects on success: rotate `rejoin_token_hash` to `bcrypt(newUuidv4, 10)`, refresh `users.last_seen_at` to `now()`. No writes to `room_memberships` (membership is a precondition for appearing in the candidates list in the first place).
- Returned plaintext `rejoinToken` is the newly-rotated one; any previously-issued token for this user stops validating via `/api/auth/rejoin`.

## 5. SQL

No schema migration. Both queries run via the service-role client.

**Candidates list (4.1):**

```sql
SELECT u.id, u.avatar_seed
FROM users u
JOIN room_memberships m ON m.user_id = u.id
WHERE m.room_id = $1
  AND LOWER(TRIM(u.display_name)) = LOWER(TRIM($2));
```

**Claim verification (4.2):** same JOIN, plus `AND u.id = $userId`. If zero rows → 404. If one row → proceed to `UPDATE users SET rejoin_token_hash = $3, last_seen_at = $4 WHERE id = $userId`.

**Room-existence check (4.1):** a separate `SELECT 1 FROM rooms WHERE id = $1 LIMIT 1` before the JOIN so we can distinguish 404 ROOM_NOT_FOUND from 200-with-empty-array. Acceptable: two round trips; the candidates endpoint is low-traffic (fires at most once per fresh-device onboarding).

## 6. Service-side library layer

Two new pure-handler files under `src/lib/auth/`, mirroring `onboard.ts` / `rejoin.ts`:

### `src/lib/auth/candidates.ts`

```ts
export interface CandidatesInput { displayName: unknown; roomId: unknown; }
export interface CandidatesDeps {
  supabase: SupabaseClient;
}
export async function listCandidates(
  input: CandidatesInput,
  deps: CandidatesDeps,
): Promise<
  | { ok: true; candidates: Array<{ userId: string; avatarSeed: string }> }
  | { ok: false; status: number; error: { code: string; message: string; field?: string } }
>;
```

### `src/lib/auth/claim.ts`

```ts
export interface ClaimInput { userId: unknown; roomId: unknown; displayName: unknown; }
export interface ClaimDeps {
  supabase: SupabaseClient;
  hashToken: (plaintext: string) => Promise<string>;
  generateRejoinToken: () => string;
  now: () => string;
}
export async function claimIdentity(
  input: ClaimInput,
  deps: ClaimDeps,
): Promise<
  | { ok: true; user: { userId: string; rejoinToken: string; displayName: string; avatarSeed: string } }
  | { ok: false; status: number; error: { code: string; message: string; field?: string } }
>;
```

Routes (`src/app/api/auth/candidates/route.ts`, `src/app/api/auth/claim/route.ts`) stay thin JSON-parsing + `apiError` wrappers, exactly matching the `onboard/route.ts` / `rejoin/route.ts` template.

## 7. Client wiring

### 7.1 `OnboardingForm.tsx`

New state variables:
- `roomId: string | null` — derived once on mount from `nextPath`.
- `step: "form" | "picker"` — starts `"form"`.
- `candidates: Array<{userId, avatarSeed}>` — populated after a successful pre-flight.

On submit from the form step:
1. Validate name (existing `DISPLAY_NAME_REGEX` check).
2. If `roomId` is null → go straight to the existing onboard path (current behavior; no change).
3. Else: `apiFetch("/api/auth/candidates", POST, {displayName, roomId})`. If 200 with empty `candidates` → call `/api/auth/onboard` (existing path). If 200 with non-empty → set `candidates`, set `step = "picker"`.
4. Any 4xx/5xx → generalError toast, stay on form.

On picker step:
- **Tap avatar** → `apiFetch("/api/auth/claim", POST, {userId, roomId, displayName})`. On 200, `setSession(...)`, redirect to `nextPath`. On 404 `CANDIDATE_NOT_FOUND` → race between pre-flight and claim (e.g. admin removed the member); re-run the candidates pre-flight and either re-render the picker with the new set or, if the set is now empty, fall through to `/api/auth/onboard` as a new identity.
- **Create new identity** → posts to `/api/auth/onboard` with `{displayName, avatarSeed}`. Success → `setSession`, redirect.
- **← Change name** → `setStep("form")`, clear `candidates`.

Shared helper: extract the current inline onboard POST + session-write + redirect from `onSubmit` into a `createNewIdentity()` helper used by both the "empty candidates" branch and the "Create new identity" button — avoids duplicating the session-write logic.

The existing avatar carousel only shows on the `form` step — on the `picker` step the user is choosing an existing avatar, not designing a new one.

### 7.2 `/room/[id]` redirect guard

Minimal client effect added to the existing stub `src/app/room/[id]/page.tsx`:

```ts
useEffect(() => {
  if (getSession()) return;
  router.replace(`/onboard?next=/room/${params.id}`);
}, [params.id, router]);
```

Five-line change. Phase 2 will replace this file wholesale when the lobby view lands; the guard can migrate with it.

## 8. Testing (TDD order)

Tests land before implementation, red-then-green per CLAUDE.md §2.2. Test files sit next to their source.

### 8.1 `src/lib/auth/candidates.test.ts`

- Rejects non-object body → 400 INVALID_BODY
- Rejects missing / malformed displayName → 400 INVALID_DISPLAY_NAME (shares regex with onboard)
- Rejects malformed roomId → 400 INVALID_ROOM_ID
- 404 ROOM_NOT_FOUND when roomId doesn't match any row
- Returns `[]` for a real room with no matches
- Returns all matches when multiple users in the room share the name (case-insensitive, trim-insensitive)
- Excludes users who match the name but belong to a different room
- Response shape contains only `userId` and `avatarSeed` — explicit assertion that `display_name`, `last_seen_at`, etc. are absent

### 8.2 `src/lib/auth/claim.test.ts`

- Rejects invalid body → 400
- 404 CANDIDATE_NOT_FOUND when userId doesn't exist
- 404 CANDIDATE_NOT_FOUND when userId exists but isn't a member of roomId
- 404 CANDIDATE_NOT_FOUND when userId is in the room but display_name doesn't match (case-insensitive, trim-insensitive comparisons covered)
- Success path: bcrypt hash stored is different from any pre-existing hash; `last_seen_at` advanced to injected `now()`; response contains new plaintext token + displayName + avatarSeed
- Regression: after a successful claim, the previously-stored rejoin token no longer validates against `bcrypt.compare` with the new hash

### 8.3 Route-level tests

`src/app/api/auth/candidates/route.test.ts` and `.../claim/route.test.ts` mirror the existing `onboard/route.test.ts` / `rejoin/route.test.ts` style:
- Non-JSON body → 400 INVALID_BODY
- Non-object JSON body → 400 INVALID_BODY
- Happy-path passthrough of the underlying handler's result to a `NextResponse`

### 8.4 Component tests

`src/components/onboarding/OnboardingForm.test.tsx` extensions:
- No roomId in `next` → candidates pre-flight is NOT called; onboard POST fires directly on submit
- roomId in `next`, empty candidates → onboard POST fires directly on submit
- roomId in `next`, non-empty candidates → picker step renders with the returned avatars (and no display names anywhere in the DOM)
- Tap avatar on picker step → `/api/auth/claim` called with the tapped `userId`; session written; redirect fires
- Tap "Create new identity" on picker step → `/api/auth/onboard` called; session written
- Tap "← Change name" → returns to form step with name preserved and candidates cleared

Plus a small unit for the roomId-extractor helper (accepts `/room/<uuid>`, rejects `/`, `/room`, `/room/`, `/room/abc/def`).

## 9. Scope boundaries

In scope:
- The two new API routes + their library layer + tests.
- `OnboardingForm` picker-step extension + tests.
- Minimal `/room/[id]` no-session redirect guard.
- `SPEC.md`: no changes required — §4.3 already describes this flow.

Out of scope (deferred explicitly):
- Rate limiting of candidates / claim endpoints. No rate-limit infrastructure exists today (no Redis, no middleware). Tracked separately as a Phase 7 hardening item.
- Audit log of identity claims. MVP security posture per SPEC §4.3 accepts the PIN as the bouncer.
- Single-match auto-pick UX. Explicitly ruled out — deciding "is this me?" should always be a conscious tap, never a race.
- Full lobby view on `/room/[id]`. The guard is a 5-line stopgap; Phase 2 replaces the file.

## 10. Open questions

None. All four brainstorm questions were resolved:

1. Endpoint topology → separate pre-flight (`candidates`) + explicit `claim`, keeping `onboard` untouched.
2. Scope → includes the `/room/[id]` redirect guard so the full journey is testable end-to-end.
3. Claim safeguards → `{userId, roomId, displayName}` with server-side re-verification; no new rate-limit infra this phase.
4. Picker UI → full step swap (not inline, not modal).
