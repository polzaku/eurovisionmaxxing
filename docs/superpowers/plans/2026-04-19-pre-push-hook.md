# Pre-push Hook Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `git push` to automatically run `npm run pre-push` (currently `tsc --noEmit && vitest run`) and abort on failure, with the hook checked into the repository.

**Architecture:** Add a checked-in `.githooks/pre-push` shell script and point git at it via `core.hooksPath`. Activation is automated via npm's `prepare` lifecycle script so a fresh clone needs only `npm install`. No new dependency.

**Tech Stack:** POSIX `sh`, git config, npm lifecycle scripts.

**Spec:** [docs/superpowers/specs/2026-04-19-pre-push-hook-design.md](../specs/2026-04-19-pre-push-hook-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.githooks/pre-push` | Create (mode 0755) | Single-line wrapper that execs `npm run pre-push`. POSIX `sh`. |
| `package.json` | Modify (`scripts` block) | Add `"prepare": "git config core.hooksPath .githooks \|\| true"`. |
| `TODO.md` | Modify (Phase 0 section) | Tick the "Wire a git pre-push hook…" item. **Gitignored — local-only edit, no commit.** |

No tests are added — the unit under test is a one-line shell wrapper. Verification is manual via the steps below (matching the spec's "Verification" section).

---

## Task 1: Establish a green baseline

Confirm `npm run pre-push` passes on `main` *before* installing the hook. If the baseline is red, the hook would mask the failure as "the hook works" instead of "the tree is broken."

**Files:** none modified.

- [ ] **Step 1: Run the script that the hook will call**

Run: `npm run pre-push`
Expected: exit code 0. `tsc --noEmit` produces no output; `vitest run` reports all suites passing.

If this fails: **stop and resolve the failure on `main` first** (or on the branch this work runs on). Do not continue this plan against a red tree.

---

## Task 2: Create `.githooks/pre-push`

**Files:**
- Create: `.githooks/pre-push` (mode 0755)

- [ ] **Step 1: Create the directory and file**

Run:
```bash
mkdir -p .githooks
cat > .githooks/pre-push <<'EOF'
#!/usr/bin/env sh
exec npm run pre-push
EOF
chmod 0755 .githooks/pre-push
```

- [ ] **Step 2: Verify the file is exactly what was intended**

Run: `cat .githooks/pre-push && ls -l .githooks/pre-push`
Expected:
- File contents are exactly:
  ```
  #!/usr/bin/env sh
  exec npm run pre-push
  ```
- Permissions show `-rwxr-xr-x` (mode 0755).

---

## Task 3: Add the `prepare` script to `package.json`

**Files:**
- Modify: `package.json` (scripts block, lines ~5–14)

- [ ] **Step 1: Add the `prepare` entry**

In `package.json`, in the `"scripts"` object, add a `"prepare"` entry. The full updated `scripts` block should read:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "type-check": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "pre-push": "npm run type-check && npm run test",
  "prepare": "git config core.hooksPath .githooks || true"
}
```

The new line is `"prepare": "git config core.hooksPath .githooks || true"`. The `|| true` keeps `npm install` from failing in non-git contexts (e.g., installing this package from a tarball).

- [ ] **Step 2: Verify the JSON is valid and the new key is present**

Run: `node -e "console.log(require('./package.json').scripts.prepare)"`
Expected output: `git config core.hooksPath .githooks || true`

(If this errors with `SyntaxError`, the JSON is malformed — fix it.)

---

## Task 4: Activate the hook in the current checkout

`prepare` runs on `npm install`, but we don't want to wait for the next install to flip the switch. Run the same command manually now.

**Files:** none modified.

- [ ] **Step 1: Set `core.hooksPath` in the working tree**

Run: `git config core.hooksPath .githooks`
Expected: no output, exit code 0.

- [ ] **Step 2: Confirm the config is set**

Run: `git config --get core.hooksPath`
Expected output: `.githooks`

---

## Task 5: Verify the happy path (hook runs and passes)

**Files:** none modified.

- [ ] **Step 1: Invoke the hook directly**

Run: `.githooks/pre-push`
Expected: exit code 0. Output shows `npm run pre-push` running through `tsc --noEmit` then `vitest run`, all green.

- [ ] **Step 2: Confirm git would pick it up on a real push**

Run: `git push --dry-run origin main 2>&1 | head -5`
Expected: dry-run output (no errors from the hook). The hook fires before the push; if Step 1 was green, this will be too. The dry-run does not contact the remote with writes — safe to run.

(If the local `main` is already in sync with `origin/main` and there is nothing to push, the dry-run will say `Everything up-to-date` and the hook may be skipped — that is not a failure of the hook, just nothing to test against. Step 1 is the authoritative happy-path check.)

---

## Task 6: Verify the failure path (hook blocks on type error)

This is the load-bearing test: a hook that always exits 0 is worse than no hook. Prove it actually fails.

**Files:**
- Modify (then revert): pick any TypeScript file, e.g. `src/lib/scoring.ts`

- [ ] **Step 1: Inject a deliberate type error**

Open any `.ts` file under `src/lib/` and append a clearly-wrong line, e.g.:
```ts
const __hookProbe: number = "this is not a number";
```

- [ ] **Step 2: Run the hook**

Run: `.githooks/pre-push`
Expected: **non-zero exit code.** `tsc --noEmit` reports the type error (e.g. `Type 'string' is not assignable to type 'number'`). Output ends with something like `npm error code 1`.

If this exits 0, the hook is broken. Stop and debug before proceeding.

- [ ] **Step 3: Revert the type error**

Remove the `__hookProbe` line. Run `git diff` and confirm no unintended changes remain.

- [ ] **Step 4: Re-run the hook to confirm the tree is clean again**

Run: `.githooks/pre-push`
Expected: exit code 0.

---

## Task 7: Commit and tick the TODO

**Files:**
- Stage and commit: `.githooks/pre-push`, `package.json`
- Modify (no commit — gitignored): `TODO.md`

- [ ] **Step 1: Review what will be committed**

Run: `git status && git diff --cached -- .githooks package.json && git diff -- .githooks package.json`
Expected: only `.githooks/pre-push` (new file, mode 100755) and the `prepare` script line in `package.json`. No stray files, no `.env`, no logs.

- [ ] **Step 2: Stage and commit**

Run:
```bash
git add .githooks/pre-push package.json
git commit -m "$(cat <<'EOF'
chore: wire pre-push hook via .githooks + prepare script

Adds .githooks/pre-push that execs `npm run pre-push` (type-check +
vitest), and a `prepare` lifecycle script so `npm install` activates
the hook on a fresh clone without adding husky.

Closes Phase 0 TODO item: "Wire a git pre-push hook that runs
npm run pre-push".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds. The pre-push hook does NOT run on commit (it only runs on push) — so this commit cannot trip itself.

- [ ] **Step 3: Tick the TODO item**

In `TODO.md`, change the line:

```
- [ ] Wire a git pre-push hook that runs `npm run pre-push` (`tsc --noEmit`) — currently only a script exists
```

to:

```
- [x] Wire a git pre-push hook that runs `npm run pre-push` (`tsc --noEmit`) — currently only a script exists
```

`TODO.md` is gitignored per CLAUDE.md §1 — do not stage or commit it.

- [ ] **Step 4: Final sanity check**

Run: `git config --get core.hooksPath && git log -1 --stat`
Expected:
- `core.hooksPath` is `.githooks`.
- The latest commit shows `.githooks/pre-push` (new) and `package.json` (modified), and nothing else.
