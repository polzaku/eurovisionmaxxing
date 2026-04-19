# Session fetch wrapper — design

**Date:** 2026-04-19
**SPEC reference:** §4.2 (Session storage schema, expiry rules)
**TODO reference:** Phase 1 — "Session persistence + 90-day expiry refresh on every successful API call (wire into a fetch wrapper)"

## Goal

Provide a single client-side `apiFetch` wrapper that preserves `window.fetch` semantics and, as a side effect, resets the local session's 90-day expiry whenever our backend returns a 2xx response. This is foundational infrastructure: every Phase 2+ client→API call will use it, so landing it before the same-name resolver and room lifecycle work keeps future callers consistent by default.

## Non-goals

- **No request-header injection.** The wrapper does not auto-attach `X-User-Id` / `X-Rejoin-Token` or any other auth material. SPEC does not define a header convention yet; we will add one when a real route requires it (Phase 2 admin checks are the expected motivator).
- **No JSON parsing or error-envelope normalization.** Callers continue to call `res.json()` themselves and match on the existing `{ error: { code, message, field? } }` shape defined in [src/lib/api-errors.ts](../../../src/lib/api-errors.ts).
- **No refresh on 4xx / 5xx / network error.** SPEC §4.2 says "successful API interaction" — we read that literally as HTTP 2xx.
- **No `LocalSession.locale` field addition.** That gap between [src/types/index.ts:3](../../../src/types/index.ts#L3) and SPEC §4.2 is tracked under Phase L (L0 infrastructure) and is out of scope here.
- **No retry, timeout, or abort-signal logic.** `RequestInit` already carries `signal` through unchanged; we do not add anything on top.
- **No global `window.fetch` monkey-patch.** A named export keeps scope explicit and avoids firing refresh on incidental third-party fetches or test-environment noise.

## Architecture

### File layout

- `src/lib/api/fetch.ts` — the `apiFetch` export plus an internal factory for test injection
- `src/lib/api/fetch.test.ts` — vitest suite covering the behavior matrix below

### Public signature

```ts
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response>;
```

Identical to `fetch`. Callers can drop it in anywhere the global `fetch` was used.

### Behavior

1. Delegate the call to the injected `fetchImpl` (defaulting to `globalThis.fetch`) with the exact `input` and `init` the caller supplied.
2. If the resolved `Response` has `ok === true` (status 200–299), call the injected `refreshExpiry` function exactly once, synchronously, before returning. `refreshExpiry` defaults to `refreshSessionExpiry` from [src/lib/session.ts](../../../src/lib/session.ts), which is already a no-op when no session is present.
3. For any non-2xx status, return the `Response` unchanged and do **not** call `refreshExpiry`.
4. If the underlying `fetch` throws (network error, aborted request), re-throw the original error unchanged and do **not** call `refreshExpiry`.

The refresh side effect is fire-and-forget from the caller's perspective: it finishes before the `Response` is returned because it is a synchronous `localStorage` write in `refreshSessionExpiry`.

### Test seam (dependency injection)

Following the same DI shape as [src/lib/auth/rejoin.ts](../../../src/lib/auth/rejoin.ts):

```ts
interface ApiFetchDeps {
  fetchImpl: typeof fetch;
  refreshExpiry: () => void;
}

// Internal factory — not re-exported from a barrel
export function __makeApiFetch(deps: ApiFetchDeps): typeof apiFetch;

// Public export that components call — built from the factory with real deps
export const apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
```

Tests import `__makeApiFetch` and pass spies. No reliance on `vi.mock`, no reliance on a real `localStorage` in tests.

## Migration

- [src/components/onboarding/OnboardingForm.tsx:96](../../../src/components/onboarding/OnboardingForm.tsx#L96) — change the literal `fetch(...)` to `apiFetch(...)` and add the import. No other change. On the 201 response, `refreshSessionExpiry` is called; it finds no session yet (the component calls `setSession` immediately afterward) and no-ops. Behavior is identical; the call site is now the canonical template for Phase 2 consumers.

No other client-side `fetch` call sites exist today (verified via grep: only [src/lib/contestants.ts](../../../src/lib/contestants.ts) uses `fetch`, and that path is server-side and unrelated to session state).

## Test matrix (TDD — write first, watch them fail, then implement)

| # | Input | Underlying fetch result | Expectation |
|---|---|---|---|
| T1 | `apiFetch('/x')` | 200 OK | `refreshExpiry` called once; returned `Response` is the same instance |
| T2 | `apiFetch('/x')` | 201 Created | `refreshExpiry` called once |
| T3 | `apiFetch('/x')` | 299 (synthetic upper bound) | `refreshExpiry` called once |
| T4 | `apiFetch('/x')` | 400 Bad Request | `refreshExpiry` not called; `Response` returned |
| T5 | `apiFetch('/x')` | 401 Unauthorized | `refreshExpiry` not called; `Response` returned |
| T6 | `apiFetch('/x')` | 500 Internal Server Error | `refreshExpiry` not called; `Response` returned |
| T7 | `apiFetch('/x')` | underlying `fetch` throws `TypeError('network')` | `refreshExpiry` not called; the exact thrown error propagates |
| T8 | `apiFetch('/x', { method: 'POST', body: '{}' })` | 200 OK | underlying `fetchImpl` is called with the exact same `input` and `init` the caller passed |
| T9 | `apiFetch('/x')` | 200 OK | resolves to the same `Response` instance the underlying `fetchImpl` returned (referential equality) |

## Acceptance criteria

- `npm run type-check` passes.
- `npm test` passes with all 9 new tests green.
- `grep -rn "fetch(" src/components src/app --include='*.tsx' --include='*.ts'` shows no direct `fetch(` calls from client components — only `apiFetch`.
- Manual smoke test in `npm run dev`: submit the onboarding form with a valid name, observe a 201, confirm `localStorage.emx_session` has an `expiresAt` approximately 90 days from now, and navigate to the next path without error.

## Risks and mitigations

- **Risk:** a future caller relies on the wrapper for auth identity and discovers there is none. **Mitigation:** the non-goals list above is explicit; the first Phase 2 route that needs caller identity will prompt a follow-up spec to extend `apiFetch`.
- **Risk:** SSR call of `apiFetch` triggers `refreshSessionExpiry`, which touches `window`. **Mitigation:** `refreshSessionExpiry` already guards on `typeof window === "undefined"` via its call to `getSession`; no extra guard needed in the wrapper.
- **Risk:** a client component forgets to use `apiFetch` and silently regresses expiry refresh. **Mitigation:** documented convention in this spec; a lint rule is a possible Phase 7 hardening follow-up but out of scope here.
