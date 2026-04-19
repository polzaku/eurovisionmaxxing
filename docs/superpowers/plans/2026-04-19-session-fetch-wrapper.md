# Session fetch wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apiFetch`, a thin client-side wrapper over `fetch` that refreshes the 90-day `emx_session` expiry whenever our backend returns a 2xx, and migrate the single existing client call site to use it.

**Architecture:** A single module at `src/lib/api/fetch.ts` exports `apiFetch` (same signature as `fetch`) plus an internal factory `__makeApiFetch({ fetchImpl, refreshExpiry })` used only by tests. On a 2xx response the wrapper calls `refreshSessionExpiry` from [src/lib/session.ts](../../../src/lib/session.ts) as a fire-and-forget synchronous side effect; on non-2xx or thrown errors it does nothing and propagates the result unchanged. No request-header injection, no JSON parsing, no retry — deliberately narrow.

**Tech Stack:** TypeScript 5.5, Vitest 2.1 (`vitest run`), Next.js 14 App Router client components, native `fetch`, `@/` path alias → `src/`.

**Spec reference:** [docs/superpowers/specs/2026-04-19-session-fetch-wrapper-design.md](../specs/2026-04-19-session-fetch-wrapper-design.md)

---

## File Structure

- **Create:** `src/lib/api/fetch.ts` — the `apiFetch` export and internal `__makeApiFetch` factory
- **Create:** `src/lib/api/fetch.test.ts` — vitest suite; 9 tests covering the behavior matrix in the spec
- **Modify:** `src/components/onboarding/OnboardingForm.tsx` — swap the one existing `fetch(...)` call to `apiFetch(...)`

No other files change. `src/lib/session.ts` is already correct — `refreshSessionExpiry` is a safe no-op when there is no session.

---

## Task 1: Scaffold the module and land the first failing test (T1 — 200 refreshes)

**Files:**
- Create: `src/lib/api/fetch.test.ts`
- Create: `src/lib/api/fetch.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/api/fetch.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest";
import { __makeApiFetch } from "@/lib/api/fetch";

function makeResponse(status: number): Response {
  return new Response(null, { status });
}

describe("apiFetch", () => {
  it("refreshes session expiry on a 200 response", async () => {
    const refreshExpiry = vi.fn();
    const response = makeResponse(200);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const result = await apiFetch("/x");

    expect(result).toBe(response);
    expect(refreshExpiry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/lib/api/fetch.test.ts`
Expected: FAIL with a module-resolution error (the source file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/api/fetch.ts` with:

```ts
import { refreshSessionExpiry } from "@/lib/session";

export interface ApiFetchDeps {
  fetchImpl: typeof fetch;
  refreshExpiry: () => void;
}

export function __makeApiFetch(deps: ApiFetchDeps) {
  return async function apiFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await deps.fetchImpl(input, init);
    if (response.ok) {
      deps.refreshExpiry();
    }
    return response;
  };
}

export const apiFetch = __makeApiFetch({
  fetchImpl: (input, init) => globalThis.fetch(input, init),
  refreshExpiry: refreshSessionExpiry,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/lib/api/fetch.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm run pre-push`
Expected: PASS (type-check + all existing tests + the new one).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/fetch.ts src/lib/api/fetch.test.ts
git commit -m "$(cat <<'EOF'
Add apiFetch wrapper with 2xx expiry refresh

First failing test (T1) covers the core behavior: on a 2xx response,
apiFetch invokes refreshSessionExpiry exactly once and returns the
underlying Response unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Lock the 2xx boundaries (T2 — 201, T3 — 299)

**Files:**
- Modify: `src/lib/api/fetch.test.ts`

- [ ] **Step 1: Add the boundary tests**

Append inside the existing `describe("apiFetch", ...)` block, after the T1 test:

```ts
  it("refreshes session expiry on a 201 response", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(201));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).toHaveBeenCalledTimes(1);
  });

  it("refreshes session expiry on a 299 response (upper 2xx boundary)", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(299));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests and verify all pass**

Run: `npm test -- src/lib/api/fetch.test.ts`
Expected: PASS (3 tests). Note: these edge-case tests lock the contract; they pass immediately because `response.ok` covers the full 2xx range.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/fetch.test.ts
git commit -m "$(cat <<'EOF'
Lock 2xx boundary behavior for apiFetch (T2, T3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Prove no-refresh on non-2xx responses (T4 — 400, T5 — 401, T6 — 500)

**Files:**
- Modify: `src/lib/api/fetch.test.ts`

- [ ] **Step 1: Add the non-2xx tests**

Append inside `describe("apiFetch", ...)`, after the Task 2 tests:

```ts
  it("does not refresh expiry on a 400 response, and returns the Response", async () => {
    const refreshExpiry = vi.fn();
    const response = makeResponse(400);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const result = await apiFetch("/x");

    expect(result).toBe(response);
    expect(refreshExpiry).not.toHaveBeenCalled();
  });

  it("does not refresh expiry on a 401 response", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(401));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).not.toHaveBeenCalled();
  });

  it("does not refresh expiry on a 500 response", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(500));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests and verify all pass**

Run: `npm test -- src/lib/api/fetch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/fetch.test.ts
git commit -m "$(cat <<'EOF'
Lock no-refresh behavior on 4xx/5xx responses (T4–T6)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Prove network errors propagate without refresh (T7)

**Files:**
- Modify: `src/lib/api/fetch.test.ts`

- [ ] **Step 1: Add the thrown-error test**

Append inside `describe("apiFetch", ...)`:

```ts
  it("re-throws network errors without refreshing expiry", async () => {
    const refreshExpiry = vi.fn();
    const networkError = new TypeError("network");
    const fetchImpl = vi.fn().mockRejectedValue(networkError);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await expect(apiFetch("/x")).rejects.toBe(networkError);
    expect(refreshExpiry).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests and verify all pass**

Run: `npm test -- src/lib/api/fetch.test.ts`
Expected: PASS (7 tests). The implementation `await`s `fetchImpl` directly, so a rejected promise surfaces the original error unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/fetch.test.ts
git commit -m "$(cat <<'EOF'
Lock network-error propagation for apiFetch (T7)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Prove transparent passthrough of args and Response (T8, T9)

**Files:**
- Modify: `src/lib/api/fetch.test.ts`

- [ ] **Step 1: Add the passthrough tests**

Append inside `describe("apiFetch", ...)`:

```ts
  it("passes input and init through to the underlying fetch unchanged", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(200));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    };
    await apiFetch("/x", init);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/x", init);
  });

  it("resolves to the exact Response instance the underlying fetch returned", async () => {
    const refreshExpiry = vi.fn();
    const response = makeResponse(200);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const result = await apiFetch("/x");

    expect(result).toBe(response);
  });
```

- [ ] **Step 2: Run tests and verify all pass**

Run: `npm test -- src/lib/api/fetch.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/fetch.test.ts
git commit -m "$(cat <<'EOF'
Lock request/response passthrough semantics for apiFetch (T8, T9)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate OnboardingForm to apiFetch

**Files:**
- Modify: `src/components/onboarding/OnboardingForm.tsx`

- [ ] **Step 1: Update the import block**

In [src/components/onboarding/OnboardingForm.tsx](../../../src/components/onboarding/OnboardingForm.tsx) around lines 1–12, add the `apiFetch` import alongside the existing `@/lib/session` import:

Before (line 11):
```ts
import { createExpiryDate, getSession, setSession } from "@/lib/session";
```

After (insert a new line immediately below line 11):
```ts
import { createExpiryDate, getSession, setSession } from "@/lib/session";
import { apiFetch } from "@/lib/api/fetch";
```

- [ ] **Step 2: Swap the fetch call**

At [src/components/onboarding/OnboardingForm.tsx:96](../../../src/components/onboarding/OnboardingForm.tsx#L96), change `fetch(` to `apiFetch(`:

Before:
```ts
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: normalized,
          avatarSeed: effectiveSeed,
        }),
      });
```

After:
```ts
      const res = await apiFetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: normalized,
          avatarSeed: effectiveSeed,
        }),
      });
```

No other changes to this file.

- [ ] **Step 3: Verify no other client fetch calls remain**

Run (via the Grep tool):
- Pattern: `\bfetch\(`
- Glob: `src/components/**/*.{ts,tsx}` and `src/app/**/page.tsx` and `src/app/**/layout.tsx`

Expected: no matches. (The only remaining `fetch(` call in `src/` should be in `src/lib/contestants.ts`, which is server-side and unrelated.)

- [ ] **Step 4: Type-check + full test suite**

Run: `npm run pre-push`
Expected: PASS. All 9 apiFetch tests + all existing tests pass; `tsc --noEmit` is clean.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`
Then in a browser:
1. Open the onboarding route (the route that renders `OnboardingForm`).
2. Clear `localStorage.emx_session` in DevTools if present.
3. Type a valid display name (e.g. "Alice"), pick an avatar, click **Join**.
4. In DevTools → Application → Local Storage, confirm `emx_session` exists and `expiresAt` is a valid ISO date roughly 90 days in the future (within a few seconds' clock skew is fine).
5. Confirm the form navigates away cleanly (no console errors).

Expected: identical onboarding UX to before this change; `expiresAt` is ~90 days out. If it is not, stop and root-cause before committing — the acceptance criterion in the spec is unmet.

- [ ] **Step 6: Commit**

```bash
git add src/components/onboarding/OnboardingForm.tsx
git commit -m "$(cat <<'EOF'
Use apiFetch in OnboardingForm for session expiry refresh

Swap the direct fetch call at OnboardingForm.tsx to apiFetch so the
90-day session expiry refresh hook is on the hot path for every future
client→API call in the onboarding flow. Behavior is otherwise identical
— the wrapper is a thin superset of fetch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update TODO.md and verify acceptance

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Tick the Phase 1 item**

In [TODO.md](../../../TODO.md) line 31, change:

Before:
```
- [ ] Session persistence + 90-day expiry refresh on every successful API call (wire into a fetch wrapper)
```

After:
```
- [x] Session persistence + 90-day expiry refresh on every successful API call (wire into a fetch wrapper)
```

- [ ] **Step 2: Final acceptance check**

Run: `npm run pre-push`
Expected: PASS.

Run the Grep tool one more time:
- Pattern: `\bfetch\(`
- Glob: `src/components/**/*.{ts,tsx}` and `src/app/**/page.tsx` and `src/app/**/layout.tsx`

Expected: zero matches.

- [ ] **Step 3: Commit**

TODO.md is gitignored in this repo (see [CLAUDE.md](../../../CLAUDE.md) §1), so there is nothing to stage. Do not attempt `git add TODO.md`. The file change is local-only bookkeeping.

If you ran `git status` and TODO.md does appear in the working tree as tracked, stop and check [.gitignore](../../../.gitignore) + `git ls-files TODO.md` before committing — the repo invariant is that TODO.md stays untracked.

---

## Self-Review

**Spec coverage:**
- SPEC-design §Behavior items 1–4 → Tasks 1, 3, 4
- Non-goals (no headers, no JSON normalization, no non-2xx refresh, no monkey-patch) → asserted in Tasks 3, 4, 5 and the absence of any corresponding test or implementation
- Test matrix T1–T9 → Tasks 1–5 (T1, T2, T3, T4, T5, T6, T7, T8, T9)
- Migration → Task 6 (OnboardingForm only; Task 6 Step 3 grep guards against missed call sites)
- Acceptance — type-check, tests, no stray `fetch(` in client components, manual smoke → Task 6 Steps 4–5 + Task 7 Step 2
- `LocalSession.locale` intentionally skipped (Phase L) — correctly out of plan

**Placeholder scan:** no "TBD", "TODO", or "handle edge cases" — every step has concrete code or concrete commands. ✓

**Type consistency:** `ApiFetchDeps` interface defined in Task 1 is used verbatim in all other tests via `__makeApiFetch({ fetchImpl, refreshExpiry })`. Signature of `apiFetch` is `(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>` in spec, Task 1 implementation, and Task 6 call site — consistent. ✓

**Gaps found and fixed:** none.
