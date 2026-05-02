# Testing conventions

We run two kinds of tests under one vitest harness.

## Two environments, one harness

| Test type | Env | Naming | Example |
|---|---|---|---|
| **Pure-helper / business logic** | `node` (default — fast, no DOM) | `*.test.ts` | `src/lib/voting/endOfVotingState.test.ts` |
| **Component / integration** | `jsdom` (per-file opt-in) | `*.test.tsx` | `src/components/voting/EndVotingModal.test.tsx` |

The two coexist in the same `npx vitest run` and share the global setup in [`vitest.setup.ts`](../../vitest.setup.ts).

## Authoring a component test

1. **Name the file** `<Component>.test.tsx` colocated next to the component.
2. **Add the env pragma as line 1**:

   ```tsx
   // @vitest-environment jsdom
   ```

   Without this the file inherits the `node` env from `vitest.config.ts` and React rendering will throw.

3. **Use `@testing-library/react`** for rendering and queries; `@testing-library/user-event` for interactions; `@testing-library/jest-dom` matchers (`toBeInTheDocument()`, `toHaveAttribute()`, …) are auto-loaded.

4. **Cleanup is automatic.** [`vitest.setup.ts`](../../vitest.setup.ts) registers RTL's `cleanup()` in a global `afterEach` hook, so individual test files don't need to do it themselves.

5. **Prefer accessible queries** (`getByRole`, `getByLabelText`, `getByText`) over `data-testid`. `data-testid` is the escape hatch — fine when the affordance has no semantic role.

## What component tests are FOR (and what they're not)

**Use them for:**
- Render assertions: "given these props, this text/role/aria attribute is present."
- Interaction → callback: "clicking the button fires `onConfirm`."
- State transitions: "after clicking expand, `<details>` has the `open` attribute."
- Fake-timer flows: countdowns, debounce, undo-toast TTL.

**Don't use them for:**
- Business logic that lives in a pure helper — that's a `*.test.ts` against the helper directly.
- Real network calls / Supabase — leave that for the manual smoke checklist (or, later, Playwright).
- Real layout / animations — jsdom is not pixel-accurate. FLIP, stagger, reduced-motion CSS gates → smoke test in browser.

## Convention going forward

Each new component slice MUST include component tests for the click handlers and state transitions that would otherwise be in a smoke checklist. The goal is to drive the per-PR smoke list down toward "verify visual design + multi-window flows" only.

Every existing pure-helper `*.test.ts` stays as-is. New pure helpers also keep `*.test.ts` (no `.tsx` rename — they don't need a DOM).

A future Playwright slice will pick up cross-window flows (instant-mode admin reveal across two browsers) where component-level tests can't reach. See [`docs/superpowers/specs/2026-04-28-test-stack-architecture-design.md`](../../docs/superpowers/specs/2026-04-28-test-stack-architecture-design.md) (TBD) for the staged plan.
