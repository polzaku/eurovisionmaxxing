# Vitest Harness — Design

- **Date:** 2026-04-18
- **TODO item:** Phase 0 — "Add a minimal test runner (vitest or node:test) — required by the superpowers TDD workflow"
- **Status:** Approved, awaiting implementation plan

## Context

`CLAUDE.md` §2.2 makes TDD non-negotiable for anything under `src/lib/` and any `/api/*/route.ts` handler. The scoring engine (`src/lib/scoring.ts`) and the announcement state machine are flagged as the two places where a missed edge case is user-visible during a live Eurovision event. Today the repo has zero test infrastructure: no runner, no `npm test`, no example test. `npm run pre-push` currently only runs `tsc --noEmit`.

This spec establishes the minimal test harness that unblocks every downstream TDD-required task (Phase 0 item D, Phase 3 onward).

## Goals

1. Running `npm test` executes the full test suite in CI/pre-push mode and exits non-zero on any failure.
2. TypeScript tests run without a separate build step and resolve the `@/*` path alias the same way the app does.
3. `npm run pre-push` runs type-check **and** tests, so push-time verification matches the TDD workflow.
4. Adding a test is as frictionless as creating a `*.test.ts` file next to the subject.

## Non-goals (explicit YAGNI)

- Code coverage reporting. No reporter, no threshold.
- jsdom / React Testing Library setup. Component tests arrive in Phase 2+; we'll switch per-file via `// @vitest-environment jsdom` when the need is real.
- Mocks for Supabase, Next.js request/response, or realtime broadcasts. Those live with the code that needs them.
- The full scoring test suite promised by Phase 0 item D and Phase 4 (missed fill, weighted math, tiebreakers, fixture pipeline). That's the follow-up task.

## Design

### Dependency
Add to `devDependencies`:
- `vitest` — latest v2.x.

No other testing libraries. No `@vitejs/plugin-react`, no `vite-tsconfig-paths`, no coverage plugin.

### `vitest.config.ts` (project root)
- `test.environment: "node"`.
- `test.include: ["src/**/*.test.ts", "src/**/*.test.tsx"]`.
- `resolve.alias: { "@": path.resolve(__dirname, "src") }` — manually mirrors the `@/*` → `./src/*` mapping in `tsconfig.json`. One line; simpler than adding a tsconfig-paths plugin. If a second alias ever appears, revisit.

### `package.json` scripts
- `"test": "vitest run"` — one-shot mode for CI and pre-push.
- `"test:watch": "vitest"` — watch mode for local dev.
- `"pre-push": "npm run type-check && npm run test"` — replaces the current type-check-only script, honouring CLAUDE.md §4.

### Test file placement
Co-located: `src/lib/scoring.test.ts` beside `src/lib/scoring.ts`. Same convention for every future subject (`foo.test.ts` next to `foo.ts`). Fixture-heavy integration suites may later live under `src/__tests__/` without changing the co-location rule for unit tests.

### Smoke test
`src/lib/scoring.test.ts` — one assertion, for example:

```ts
import { describe, it, expect } from "vitest";
import { rankToPoints } from "@/lib/scoring";

describe("scoring harness smoke", () => {
  it("awards 12 points for rank 1", () => {
    expect(rankToPoints(1)).toBe(12);
  });
});
```

Purpose: prove the harness runs, resolves the `@/` alias, and honours pass/fail exit codes. This is **not** the Phase 0-D deliverable; full coverage is out of scope for this change.

### `.gitignore`
Append `/coverage` prophylactically so that if anyone later runs `vitest --coverage` locally, the default output directory doesn't sneak into a commit.

## Verification plan

Implementation is complete only when all of the following pass:

1. `npm test` → exit 0 with exactly one passing test.
2. Temporarily break the smoke assertion → `npm test` exits non-zero with a readable Vitest failure. Revert.
3. `npm run type-check` → still passes (includes `vitest.config.ts`).
4. `npm run pre-push` → runs type-check, then test, both green.

These four checks correspond to the superpowers `verification-before-completion` skill and must be executed before the TODO item is ticked.

## Trade-offs

- **Manual alias duplication (tsconfig + vitest.config).** Accepted. One line of config vs. one more devDep; revisit if aliases multiply.
- **Vitest transitively pulls in Vite.** Dev-only; no impact on the Next.js webpack production build.
- **Node environment by default.** React/DOM tests must opt in per-file. Acceptable because none exist yet.

## Follow-ups (separate TODO items, not this change)

- Phase 0 item D: full scoring.ts test suite.
- Phase 4: fixture-based end-to-end scoring pipeline test.
- First `/api/*/route.ts` handler test (when the first handler with non-trivial logic lands).
