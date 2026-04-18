# Vitest Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working Vitest harness so every subsequent Phase-0+ task can honour the CLAUDE.md TDD discipline.

**Architecture:** Single devDep (`vitest`), one root config (`vitest.config.ts`), three `package.json` scripts (`test`, `test:watch`, `pre-push`), one co-located smoke test at `src/lib/scoring.test.ts`. Path alias `@/*` duplicated manually in the vitest config to match `tsconfig.json` without adding a plugin.

**Tech Stack:** Vitest 2.x, TypeScript 5.5 (existing), Node 20+ (existing).

**Spec:** [docs/superpowers/specs/2026-04-18-vitest-harness-design.md](../specs/2026-04-18-vitest-harness-design.md)

**Files touched:**
- Create: `vitest.config.ts`
- Create: `src/lib/scoring.test.ts`
- Modify: `package.json` (scripts + devDependencies)
- Modify: `package-lock.json` (side effect of `npm install`)
- Modify: `.gitignore` (append `/coverage`)

**Commit strategy:** One commit at the very end (Task 4). The whole harness is one logical change.

---

## Task 1: Install Vitest

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `package-lock.json`

- [ ] **Step 1: Install vitest as a devDependency**

Run from repo root:
```bash
npm install -D vitest@^2
```

- [ ] **Step 2: Confirm it landed in `package.json`**

Open `package.json` and verify `devDependencies` now contains `"vitest": "^2.x.x"` (a real version string, not a placeholder).

- [ ] **Step 3: Confirm the existing type-check still passes**

```bash
npm run type-check
```

Expected: exits 0, no output (tsc succeeds silently).

If it fails: do NOT proceed. The install polluted types somehow — investigate before moving on.

---

## Task 2: Scaffold the Vitest config + scripts (no test yet)

This task sets up the runner. We intentionally stop before writing the smoke test so Task 3 can demonstrate a true TDD "fails first for the right reason" beat.

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Create `vitest.config.ts` at the repo root**

Exact file contents:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

Notes for the implementer:
- `defineConfig` is imported from `vitest/config`, NOT `vite`. Vitest 2.x ships this helper so the config typechecks with vitest's extra `test` block.
- `__dirname` works here because Vitest loads the config through esbuild in CJS-compatible mode (the project has no `"type": "module"` in `package.json`).
- Keep the alias one line — if a second alias ever appears, revisit the "manual vs plugin" trade-off then, not now.

- [ ] **Step 2: Add `test` and `test:watch` scripts to `package.json`**

Edit the `"scripts"` object. Before:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "type-check": "tsc --noEmit",
  "pre-push": "tsc --noEmit"
}
```

After (note: `pre-push` is left unchanged for now — Task 4 updates it):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "type-check": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "pre-push": "tsc --noEmit"
}
```

- [ ] **Step 3: Verify type-check still passes with the new config file**

```bash
npm run type-check
```

Expected: exits 0. `vitest.config.ts` must typecheck cleanly because tsconfig's `include` is `["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]` and the config is a `.ts` file at the root.

- [ ] **Step 4: Sanity-run `npm test` with no test files**

```bash
npm test
```

Expected: Vitest reports "No test files found, exiting with code 1" and the npm command exits non-zero. This is the expected, desired state at this point — it proves Vitest is wired and discovers files via the `include` pattern we set, and it has simply found zero of them.

If it passes with 0 tests (exit 0): our config is wrong — Vitest's default is to fail when no tests are found in `run` mode. Do NOT proceed until the behaviour matches the expected state.

---

## Task 3: TDD the smoke test — fail for the right reason, then pass

This is the TDD beat. We write an intentionally-wrong assertion, watch Vitest surface the mismatch (which also proves alias resolution works), then correct it.

**Files:**
- Create: `src/lib/scoring.test.ts`

- [ ] **Step 1: Write the smoke test with an intentionally wrong expected value**

Create `src/lib/scoring.test.ts` with these exact contents:

```ts
import { describe, it, expect } from "vitest";
import { rankToPoints } from "@/lib/scoring";

describe("scoring harness smoke", () => {
  it("awards 12 points for rank 1", () => {
    expect(rankToPoints(1)).toBe(999);
  });
});
```

Why `999`: `rankToPoints(1)` returns `12` (per `EUROVISION_POINTS` in `src/types/index.ts` and the function at [src/lib/scoring.ts:32-34](../../../src/lib/scoring.ts#L32-L34)). `999` is wrong enough to never collide with a real Eurovision point value.

- [ ] **Step 2: Run the test — expect a pass/fail mismatch, NOT a module-not-found**

```bash
npm test
```

Expected output characteristics:
- Vitest finds and runs exactly 1 test file.
- The test **fails** with an assertion-style error along the lines of `expected 12 to be 999` (or `AssertionError: expected 12 to be 999`).
- Exit code is non-zero.

Why this precise shape matters:
- If the error is "Cannot find module '@/lib/scoring'" → the alias didn't resolve. Fix `vitest.config.ts` before continuing.
- If the error is "rankToPoints is not a function" → the import path is off. Recheck.
- If the test passes → you wrote `12` instead of `999`. Redo step 1.

- [ ] **Step 3: Correct the assertion to the real value**

Edit `src/lib/scoring.test.ts` and change `.toBe(999)` to `.toBe(12)`. Full file should now read:

```ts
import { describe, it, expect } from "vitest";
import { rankToPoints } from "@/lib/scoring";

describe("scoring harness smoke", () => {
  it("awards 12 points for rank 1", () => {
    expect(rankToPoints(1)).toBe(12);
  });
});
```

- [ ] **Step 4: Run the test — expect it to pass**

```bash
npm test
```

Expected: 1 test file, 1 test, 1 passing, exit 0. Output contains `1 passed` and no failed assertions.

---

## Task 4: Wire pre-push, .gitignore, full verification, commit

**Files:**
- Modify: `package.json` (pre-push script)
- Modify: `.gitignore` (append `/coverage`)

- [ ] **Step 1: Update the `pre-push` script**

In `package.json`, change:

```json
"pre-push": "tsc --noEmit"
```

to:

```json
"pre-push": "npm run type-check && npm run test"
```

Rationale: CLAUDE.md §4 states that when tests exist, pre-push must run them. Type-check first (fails fast on broken types), then the suite.

- [ ] **Step 2: Append `/coverage` to `.gitignore`**

Open `.gitignore` and add `/coverage` on its own line at the end (after any existing final newline — don't duplicate if already present). This is prophylactic for the day someone runs `vitest --coverage` locally; Vitest's default output directory is `coverage/`.

- [ ] **Step 3: Full verification — all four checks from the spec**

Run these in order. Every one must pass before committing.

a) One-shot test run:
```bash
npm test
```
Expected: exit 0, `1 passed`.

b) Break-and-revert check (proves the harness reports failures). Temporarily edit `src/lib/scoring.test.ts` and change `.toBe(12)` back to `.toBe(999)`, then:
```bash
npm test
```
Expected: exit non-zero, assertion failure shown. Then revert the edit back to `.toBe(12)` and run `npm test` one more time → exit 0 again.

c) Type-check:
```bash
npm run type-check
```
Expected: exit 0, no output.

d) Pre-push:
```bash
npm run pre-push
```
Expected: runs type-check, then test, both green, final exit 0.

If any of a–d fail: stop, fix, re-run from the failing step. Do NOT commit a half-working harness.

- [ ] **Step 4: Stage and review the diff**

```bash
git status
git diff
git diff --cached
```

Expected staged/unstaged changes:
- `package.json` (new scripts + new devDependency entry)
- `package-lock.json` (updated with vitest and its transitive deps)
- `vitest.config.ts` (new file)
- `src/lib/scoring.test.ts` (new file)
- `.gitignore` (one new line: `/coverage`)
- `docs/superpowers/specs/2026-04-18-vitest-harness-design.md` (new file from brainstorming)
- `docs/superpowers/plans/2026-04-18-vitest-harness.md` (this plan file)
- `TODO.md` (the already-ticked `.env.local` line from the session's earlier edit)

Eyeball for stray logs, commented-out credentials, or any `.env*` contents (per CLAUDE.md §3.5). Confirm there are no unrelated changes.

- [ ] **Step 5: Commit**

Stage the exact files (avoid `git add -A` per CLAUDE.md §3.5):

```bash
git add package.json package-lock.json vitest.config.ts src/lib/scoring.test.ts .gitignore \
        docs/superpowers/specs/2026-04-18-vitest-harness-design.md \
        docs/superpowers/plans/2026-04-18-vitest-harness.md \
        TODO.md
```

Then commit:

```bash
git commit -m "$(cat <<'EOF'
Add Vitest harness with scoring smoke test

Wires vitest@^2 with a node environment and a manual @/* alias that
mirrors tsconfig. Pre-push now runs type-check then tests, so the
CLAUDE.md TDD discipline has somewhere to land.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Confirm the commit landed**

```bash
git status
git log -1 --stat
```

Expected: working tree clean, one new commit on `main` whose stat matches the files staged in Step 5.

- [ ] **Step 7: Tick the TODO**

Edit `TODO.md`: change the Phase-0 line

```
- [ ] Add a minimal test runner (vitest or node:test) — required by the superpowers TDD workflow (see CLAUDE.md)
```

to

```
- [x] Add a minimal test runner (vitest or node:test) — required by the superpowers TDD workflow (see CLAUDE.md)
```

`TODO.md` is gitignored (CLAUDE.md §1) — do NOT stage it. Just save the file.

---

## Done when

- `npm test` runs and passes with 1/1.
- `npm run pre-push` runs type-check then tests, both green.
- Break-and-revert check surfaces a real assertion failure.
- One commit lands on `main` with all the files listed in Task 4 Step 4.
- Phase 0 "test runner" line in `TODO.md` is ticked.

## Self-review

- **Spec coverage:** every spec section has a task — dep install (Task 1), config (Task 2.1), scripts (Task 2.2 + Task 4.1), smoke test (Task 3), `.gitignore` (Task 4.2), all four verification steps (Task 4.3). No gaps.
- **Placeholders:** none. All code blocks are complete; all expected outputs are concrete.
- **Type consistency:** function name `rankToPoints` matches `src/lib/scoring.ts:32`. Import path `@/lib/scoring` resolves via the alias defined in the same plan. Script names (`test`, `test:watch`, `pre-push`, `type-check`) are used consistently across tasks.
