# Pre-push hook wiring — design

**Date:** 2026-04-19
**TODO item:** Phase 0 — "Wire a git pre-push hook that runs `npm run pre-push` (`tsc --noEmit`) — currently only a script exists"
**SPEC reference:** CLAUDE.md §4 ("Pre-push" command), §2.2 ("Never skip `tsc --noEmit`. Run it before declaring any task complete. Use the pre-push hook.")

## Goal

Make `git push` automatically run `npm run pre-push` (currently `tsc --noEmit && vitest run`) and abort the push on non-zero exit. The hook must travel with the repository so a fresh clone activates it via `npm install`, with no extra dependency.

## Non-goals

- Husky, lint-staged, or any other hook framework
- Pre-commit, commit-msg, or any other git hook event
- CI/CD configuration
- Skipping or bypassing strategies (`--no-verify` is explicitly forbidden by CLAUDE.md §2.2)

## Approach

Use git's built-in `core.hooksPath` config to point at a checked-in `.githooks/` directory containing the hook script. Activate it via npm's `prepare` lifecycle script so `npm install` is the only step a contributor needs.

### Files

**`.githooks/pre-push`** (new, mode `0755`):

```sh
#!/usr/bin/env sh
exec npm run pre-push
```

- `exec` replaces the shell process so the hook's exit code is exactly `npm run pre-push`'s exit code (no need for explicit error handling).
- POSIX `sh` shebang (no bashisms) so it runs on macOS, Linux, and Git Bash on Windows.

**`package.json`** — add one script:

```json
"prepare": "git config core.hooksPath .githooks || true"
```

- `prepare` runs automatically after `npm install` (npm lifecycle).
- `|| true` so the script doesn't fail in non-git contexts (e.g., installing this package as a tarball dependency, npm CI flows that omit `.git`). Failure to set the config there is harmless.

### One-time activation in this checkout

After adding the files, run `git config core.hooksPath .githooks` once locally so the hook is live immediately, without waiting for the next `npm install`. This is purely a convenience for the current working tree; new clones get it automatically via `prepare`.

## Verification

No formal TDD — the unit under test is a one-line shell wrapper. Manual verification suffices:

1. **Config set:** `git config --get core.hooksPath` returns `.githooks`.
2. **Happy path:** Run `.githooks/pre-push` directly — exits 0 (since `npm run type-check` and `vitest run` pass on the current tree).
3. **Failure path:** Temporarily introduce a type error in any `.ts` file, run `.githooks/pre-push` — exits non-zero. Revert the type error.
4. **Tick the TODO item.**

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Contributor runs `git push` without ever running `npm install` | Acceptable: the project has a single contributor today; CLAUDE.md already mandates `npm install` for any work. |
| `prepare` script fails on a fresh clone (e.g., git not on PATH) | `|| true` keeps install resilient; worst case the hook just isn't active and developer runs the config command manually. |
| Hook becomes slow as test suite grows | Acceptable for now. If/when the suite gets slow, revisit (e.g., scope tests by changed files), but not in this task. |
| Existing local hook in `.git/hooks/pre-push` overrides ours | None exists today (verified — only `.sample` files). `core.hooksPath` overrides `.git/hooks/` entirely once set. |

## Out of scope / explicitly deferred

- Husky migration (revisit if the hook config grows beyond one event)
- Adding `prepare` guard for environments where the hook should not be installed (none today)
- Pre-commit hooks (TODO doesn't ask for them)
