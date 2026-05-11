# CLAUDE.md — agentic instructions for this repo

You are working on **eurovisionmaxxing**, a Next.js 14 + Supabase Eurovision watch-party voting app. This file tells any future Claude Code (or Claude agent) session how to behave when touching this codebase.

Read this file first. Then read `SPEC.md`. Then read `TODO.md`. Don't skip any of them.

---

## 1. Source-of-truth hierarchy

1. **`SPEC.md`** — the single source of truth for product + engineering decisions. Every implementation must satisfy it. If you discover the code diverges from the spec, update the spec first (with the human's approval) and then reconcile the code. Never silently drift.
2. **`TODO.md`** — the working checklist. It is **gitignored** (local-only working doc). Keep it in sync with reality as you land work — tick items, add newly discovered tasks, never let it rot.
3. **`SUPABASE_SETUP.md`** — the operator runbook. Don't duplicate its content elsewhere; link to it.

If these three disagree, flag it to the human instead of picking a side yourself.

---

## 2. Using the superpowers plugin

This project is intended to be developed with the **superpowers** plugin (obra/superpowers or any compatible fork). Its disciplines — brainstorm → plan → TDD → verify → root-cause — are load-bearing for this codebase because there is no CI beyond `tsc --noEmit` and because real users will be watching Eurovision live on a TV. Bugs are public.

### 2.1 Before starting any task

1. **Check the plugin is installed.** If `/superpowers` commands are unavailable, tell the human and offer to install via `/plugin marketplace add obra/superpowers` + `/plugin install superpowers` before continuing. Do not proceed with real engineering work without it on non-trivial tasks.
2. **Load the relevant superpowers skills** for the task type. Typical matches in this repo:
   - New feature end-to-end → `brainstorming` → `writing-plans` → `test-driven-development` → `executing-plans` → `verification-before-completion`
   - Bug reproducible by a user → `root-cause-tracing` + `test-driven-development` (write the failing test first, then fix)
   - Ambiguous requirement → `brainstorming` only, surface a short option list to the human, do not start coding
   - Risky refactor across many files → run inside a git worktree via the `worktrees` skill so the main tree stays clean
   - Long/complex investigation → delegate to a subagent with a precise brief so the main context stays clean
3. **State your plan back to the human in one sentence** before you start editing code. If the task is >~1 file, write a plan file first (use the superpowers `writing-plans` skill); do not begin execution until the plan is acknowledged.

### 2.2 During execution — non-negotiables

- **TDD, always, for anything under `src/lib/` or any `/api/*/route.ts` handler.** Write the failing test, run it, confirm it fails for the *right* reason, then make it pass. The scoring engine and the announcement state machine are the two places where a missed edge case is user-visible during a live event — no code lands in those areas without tests. Put tests next to the file (`foo.test.ts` beside `foo.ts`) or under `src/__tests__/`.
- **RTL component tests are MANDATORY for any new or substantially-modified `*.tsx`** (codified in SPEC §17a.5, 2026-05-02). Not optional, not opportunistic. `vitest.config.ts` defaults to node env; component tests opt into jsdom per-file via `// @vitest-environment jsdom` at the top of the file. Mock `next-intl` and `next/navigation` per-file — see `src/components/instant/OwnPointsCeremony.test.tsx` for the canonical mock shape. Matchers (`@testing-library/jest-dom/vitest`) and RTL `cleanup` afterEach are wired in `vitest.setup.ts`. Cover at minimum: initial render, the interactions the component exposes, the callbacks it fires, and any obvious degenerate paths. Skip is acceptable only for pure-presentation components (no state, no callbacks, no branching) — and that exception should be rare. Anything jsdom can't reach (real layout / FLIP, real `prefers-reduced-motion`, real Supabase, multi-window realtime) stays in manual smoke or the future Playwright slot. Reference: `src/components/instant/{OwnPointsCeremony,LeaderboardCeremony}.test.tsx`.
- **Small steps.** One logical change per commit. A feature spanning multiple steps lives on a branch; each step passes `npm run type-check` and tests before the next begins.
- **Never skip `tsc --noEmit`.** Run it before declaring any task complete. Use the pre-push hook.
- **No `--no-verify`, no `--no-gpg-sign`, no force pushes to `main`.** If a hook fails, fix the underlying issue and make a new commit — don't amend around it.
- **Use subagents for investigations**, not for unsupervised writes. You (the primary) stay responsible for every change that lands on disk.
- **Verify before completing.** Before marking any TODO item done: run the test suite, run `tsc --noEmit`, exercise the change in `npm run dev` if it's user-facing. The superpowers `verification-before-completion` skill codifies this — use it.

### 2.3 When the plugin isn't available

If superpowers is somehow unavailable in the session, replicate the discipline manually: brainstorm options when the requirement is fuzzy, write a short plan before touching code, practice TDD on the scoring/API layer, verify before declaring done. The *process* matters more than the specific command name.

---

## 3. Project-specific rules

### 3.1 Architecture invariants

- **Service-role key stays server-side.** `createServiceClient()` in `src/lib/supabase/server.ts` must only ever be imported by code under `src/app/api/**`. Never import it into a client component or a shared lib that a client component imports. If the import graph suggests otherwise, stop and restructure.
- **All writes go through `/api`.** Client code talks to Supabase only for Realtime subscriptions (see `useRoomRealtime`) and, at most, for `SELECT` via RLS-protected policies. No `insert`/`update`/`delete` from the browser.
- **Authorization lives in API routes, not RLS.** RLS is defence-in-depth. Admin-only routes must check `rooms.owner_user_id === callerUserId` explicitly.
- **Respect the spec's data shapes.** `Contestant.id = "{year}-{countryCode}"` everywhere. `categories` stored as `JSONB`. `scores` keyed by the category `name` string, not a category id.

### 3.2 Styling

- No hardcoded hex values in components. Use the Tailwind tokens: `bg-background`, `text-foreground`, `bg-primary`, `text-accent`, `border-border`, `gold`, `hot-pink`, `navy`. If you need a new colour, add it to `globals.css` + `tailwind.config.ts` — don't sneak literals in.
- Dark mode is the default; test every new screen under both `prefers-color-scheme` values.
- The palette and animations (§3.1/§3.2 in SPEC) are part of the public API of this app. Changing them is a spec-level change.

### 3.3 Realtime

- Broadcast messages are the primary transport (`room:{roomId}` channel, single event name `room_event`, payload discriminated by `type`). Postgres Changes are fallback.
- When you add a new `RoomEvent` variant, update: (1) the `RoomEvent` union in `src/types/index.ts`, (2) SPEC §15, (3) every subscriber. Exhaustiveness-check via a `never` branch in switches.

### 3.4 Country + contestant data

- `COUNTRY_CODES` in `src/lib/contestants.ts` must cover every country the current season fields. When a new debut country is announced, add it (don't let the two-letter fallback ship to prod).
- Hardcoded fallback JSON lives at `data/contestants/{year}/{event}.json`. Four fields only (`country`, `artist`, `song`, `runningOrder`); the rest is derived.

### 3.5 Secrets + git

- `.env.local` is gitignored and stays that way. Never stage it. Never paste keys into SPEC/TODO/commit messages.
- Publishable vs secret keys: publishable is `NEXT_PUBLIC_*` and safe to ship to the browser. Secret is server-only and bypasses RLS — treat it like the master key it is.
- Before committing, run `git diff --cached` and eyeball for stray logs, commented credentials, or `.env*` contents.

---

## 4. Running things

| What | Command |
|---|---|
| Dev server | `npm run dev` |
| Type-check | `npm run type-check` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Pre-push | `npm run pre-push` (runs type-check) |
| Apply DB schema | Open `supabase/schema.sql` in the Supabase SQL Editor and run |
| Health probe | `curl $APP_URL/api/health` → `{ "ok": true }` |

When tests are added (Phase 0, TODO.md), wire them into `npm test` and add them to `pre-push`.

---

## 5. Working-with-humans protocol

- If the human's request is ambiguous, **do not guess.** Ask one sharp question, ideally multiple-choice. The superpowers `brainstorming` skill is the right tool.
- If a change will touch SPEC.md semantics, confirm with the human before editing SPEC.md. SPEC is contract-grade.
- Keep `TODO.md` tidy after every session: tick what you completed, add what you discovered. Future-you (or the next agent) will thank you.
- When in doubt: prefer reversible, small, tested steps over a big clever refactor.
