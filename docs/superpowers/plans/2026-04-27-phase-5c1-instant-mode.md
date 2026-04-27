# Phase 5c.1 instant-mode reveal flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working instant-mode announcement flow — when a room with `announcement_mode = 'instant'` enters `announcing`, every member sees their own per-country breakdown + a Ready button; the admin sees a ready-count chip + three reveal CTAs that unlock by spec rules; tapping any CTA flips the room to `done` and hands all clients off to `/results/[id]`.

**Architecture:** Pure-helper-first. The reveal-CTA logic is a pure reducer (`nextRevealCtaState`) tested with 10+ cases. The `markReady` orchestrator follows the existing `setDelegate`/`advanceAnnouncement` shape (discriminated `{ok:true,…}|{ok:false,…}` result). Realtime adds one new `member_ready` event; the existing `status_changed` drives the flip-to-done. JSX components are smoke-tested manually per repo posture.

**Tech Stack:** Next.js 14 + React 18, TypeScript strict, Tailwind, Supabase (service role server-side), next-intl 3, Vitest (node env).

**Spec:** [docs/superpowers/specs/2026-04-27-phase-5c1-instant-mode-design.md](docs/superpowers/specs/2026-04-27-phase-5c1-instant-mode-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/schema.sql` | Modify | Add `ready_at TIMESTAMPTZ` to `room_memberships` |
| `SUPABASE_SETUP.md` | Modify | Append migration changelog entry |
| `src/types/database.ts` | Modify | Add `ready_at` to `room_memberships` row/insert/update types |
| `src/types/index.ts` | Modify | Add `readyAt: string \| null` to membership shape; add `member_ready` to `RoomEvent` union |
| `src/lib/rooms/get.ts` | Modify | Select + map `ready_at` → `readyAt` |
| `src/lib/api-errors.ts` | Modify | Add `"ROOM_NOT_INSTANT"` to `ApiErrorCode` union |
| `src/components/voting/nextRevealCtaState.ts` | Create | Pure reducer for the three reveal CTAs |
| `src/components/voting/nextRevealCtaState.test.ts` | Create | 10+ unit tests for the reducer |
| `src/lib/rooms/markReady.ts` | Create | `markReady(input, deps)` orchestrator |
| `src/lib/rooms/markReady.test.ts` | Create | Orchestrator unit tests |
| `src/app/api/rooms/[id]/ready/route.ts` | Create | `POST` handler delegating to `markReady` |
| `src/app/api/rooms/[id]/ready/route.test.ts` | Create | Route tests |
| `src/lib/room/api.ts` | Modify | Add `postRoomReady(roomId)` helper |
| `src/hooks/useRoomRealtime.ts` | Modify | Surface `member_ready` events |
| `src/components/room/InstantOwnBreakdown.tsx` | Create | Own-results list (sorted by points desc) |
| `src/components/room/RevealCtaPanel.tsx` | Create | Admin-only three-CTA + override-confirm modal |
| `src/components/room/InstantAnnouncingView.tsx` | Create | Top-level instant-mode announce view |
| `src/app/room/[id]/page.tsx` | Modify | Branch on `announcementMode` for the `announcing` block |
| `src/locales/en.json` | Modify | Add 14 keys under `instantAnnounce.{ownResults,ready,admin}` |

---

### Task 1: Schema migration + setup doc changelog

**Files:**
- Modify: `supabase/schema.sql` (the `room_memberships` `CREATE TABLE` block)
- Modify: `SUPABASE_SETUP.md` (append new entry under `## Schema migrations` → `### Changelog`)

**Worktree:** `/Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode`
**Branch:** `feat/phase-5c1-instant-mode`

Use `git -C <worktree-path>` for every git command. Before committing run `git -C <worktree-path> rev-parse --abbrev-ref HEAD` and confirm `feat/phase-5c1-instant-mode`.

- [ ] **Step 1: Read current `room_memberships` block in `supabase/schema.sql`**

The block is around lines 41–50 (post-S1) and looks like:

```sql
CREATE TABLE room_memberships (
  room_id           UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  joined_at         TIMESTAMPTZ DEFAULT NOW(),
  is_ready          BOOLEAN DEFAULT FALSE,            -- for instant mode "ready to reveal"
  scores_locked_at  TIMESTAMPTZ,                      -- soft lock-in for vote calibration (§8.10); NULL = unlocked / never locked. Cleared automatically on any vote write by this user.
  PRIMARY KEY (room_id, user_id)
);
```

- [ ] **Step 2: Add `ready_at` column**

Replace that block with:

```sql
CREATE TABLE room_memberships (
  room_id           UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  joined_at         TIMESTAMPTZ DEFAULT NOW(),
  is_ready          BOOLEAN DEFAULT FALSE,            -- for instant mode "ready to reveal"
  ready_at          TIMESTAMPTZ,                      -- timestamp when is_ready transitioned to true; MIN across the room is the 60-s countdown anchor in §10.1
  scores_locked_at  TIMESTAMPTZ,                      -- soft lock-in for vote calibration (§8.10); NULL = unlocked / never locked. Cleared automatically on any vote write by this user.
  PRIMARY KEY (room_id, user_id)
);
```

- [ ] **Step 3: Append a SUPABASE_SETUP changelog entry**

Open `SUPABASE_SETUP.md` and add a new bullet to the existing `### Changelog` list (after the 2026-04-26 Phase S0 entry):

```markdown
- **2026-04-27 — Phase 5c.1**: added `room_memberships.ready_at TIMESTAMPTZ` (nullable, default NULL) for the instant-mode 60-s countdown anchor. Apply with:

  ```sql
  ALTER TABLE room_memberships
    ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
  ```
```

- [ ] **Step 4: Sanity-check**

Run:
```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode
grep -c "ready_at" supabase/schema.sql
grep -c "Phase 5c.1" SUPABASE_SETUP.md
```
Expected: `1` for both.

- [ ] **Step 5: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode rev-parse --abbrev-ref HEAD   # must say feat/phase-5c1-instant-mode
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode add supabase/schema.sql SUPABASE_SETUP.md
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode diff --cached --stat   # must show ONLY those two files
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode commit -m "$(cat <<'EOF'
schema: add room_memberships.ready_at (Phase 5c.1)

Additive nullable timestamp; populated by markReady when is_ready
transitions to true. MIN(ready_at) across a room's memberships is the
anchor for the 60-second "Reveal anyway" countdown in SPEC §10.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: DB layer — types + `get.ts` mapping

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/rooms/get.ts`

- [ ] **Step 1: Read `src/types/database.ts` `room_memberships` block**

The Row/Insert/Update shape is around lines ~85–105.

- [ ] **Step 2: Add `ready_at` to all three (Row, Insert, Update)**

Within the `room_memberships` table type, add after `is_ready`:

```ts
// Row:
ready_at: string | null;
// Insert:
ready_at?: string | null;
// Update:
ready_at?: string | null;
```

- [ ] **Step 3: Surface `readyAt` on the membership shape in `src/types/index.ts`**

Find the membership-related interface (around line 75 — has `isReady: boolean`). Add:

```ts
readyAt: string | null;  // ISO timestamp; null when not yet ready
```

- [ ] **Step 4: Add `member_ready` to the `RoomEvent` discriminated union**

Find the `RoomEvent` type definition in `src/types/index.ts`. Add a new branch:

```ts
| {
    type: "member_ready";
    userId: string;
    readyAt: string;
    readyCount: number;
    totalCount: number;
  }
```

(Place it alongside the other event variants — the order matters only for readability.)

- [ ] **Step 5: Surface `readyAt` from `get.ts`**

Open `src/lib/rooms/get.ts`. Find the membership type (around line 71 — has `is_ready: boolean`):

```ts
is_ready: boolean;
```

Add alongside:

```ts
ready_at: string | null;
```

Find the `.select(...)` call (around line 112) currently passing:

```ts
"user_id, joined_at, is_ready, users(display_name, avatar_seed)"
```

Add `ready_at`:

```ts
"user_id, joined_at, is_ready, ready_at, users(display_name, avatar_seed)"
```

Find the row mapping (around line 80–84) — currently:

```ts
isReady: row.is_ready,
```

Add alongside:

```ts
readyAt: row.ready_at,
```

- [ ] **Step 6: Run tests**

Existing `get.test.ts` will fail until its fixtures include `ready_at` on the membership rows AND `readyAt` on the expected output. Open `src/lib/rooms/get.test.ts`. Find the membership fixture rows (search `is_ready`) and the corresponding expected outputs. Add `ready_at: null` (or matching ISO string) to each input fixture, and `readyAt: null` (or matching value) to each expected output.

The fixtures appear in at least lines 29, 35, and 197 (per earlier grep). For each `is_ready: <bool>,` line in the **input** rows, add `ready_at: null,` immediately after. For each `isReady: <bool>,` line in **expected outputs**, add `readyAt: null,` immediately after.

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test -- get`
Expected: all `get` tests pass.

- [ ] **Step 7: Run type-check + full test suite**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run type-check 2>&1
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test 2>&1 | tail -3
```
Expected: type-check clean (0); tests still all pass.

- [ ] **Step 8: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode add src/types/database.ts src/types/index.ts src/lib/rooms/get.ts src/lib/rooms/get.test.ts
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode commit -m "$(cat <<'EOF'
types: surface readyAt on memberships + add member_ready RoomEvent

Database row gains ready_at; mapped to readyAt on the membership shape.
RoomEvent union gains member_ready { userId, readyAt, readyCount,
totalCount }. get.ts selects + maps the new column; existing tests
updated with ready_at: null fixtures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `nextRevealCtaState` pure reducer (TDD)

**Files:**
- Create: `src/components/voting/nextRevealCtaState.ts`
- Test: `src/components/voting/nextRevealCtaState.test.ts`

TDD — write the test first, watch it fail, then implement.

- [ ] **Step 1: Write the failing test**

Create `src/components/voting/nextRevealCtaState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextRevealCtaState } from "./nextRevealCtaState";

const NOW = 1_000_000_000_000; // arbitrary ms epoch

describe("nextRevealCtaState", () => {
  it("returns disabled state when no one is ready", () => {
    expect(
      nextRevealCtaState({
        readyCount: 0,
        totalCount: 6,
        firstReadyAt: null,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    });
  });

  it("canRevealAll true when everyone ready", () => {
    expect(
      nextRevealCtaState({
        readyCount: 6,
        totalCount: 6,
        firstReadyAt: NOW - 5_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: true,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount: 6, totalCount: 6 },
    });
  });

  it("canRevealAnyway true at exactly half ready", () => {
    expect(
      nextRevealCtaState({
        readyCount: 3,
        totalCount: 6,
        firstReadyAt: NOW - 1_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount: 3, totalCount: 6 },
    });
  });

  it("just under half: countdown active, canRevealAnyway false", () => {
    expect(
      nextRevealCtaState({
        readyCount: 2,
        totalCount: 6,
        firstReadyAt: NOW - 30_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "countdown", secondsRemaining: 30 },
    });
  });

  it("60s elapsed exactly: countdown shows 0, canRevealAnyway true", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 6,
        firstReadyAt: NOW - 60_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: true,
      anywayLabel: { kind: "countdown", secondsRemaining: 0 },
    });
  });

  it("75s elapsed (clamped): countdown shows 0, canRevealAnyway true", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 6,
        firstReadyAt: NOW - 75_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: true,
      anywayLabel: { kind: "countdown", secondsRemaining: 0 },
    });
  });

  it("1s elapsed: countdown shows 59", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 6,
        firstReadyAt: NOW - 1_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "countdown", secondsRemaining: 59 },
    });
  });

  it("solo room (totalCount=1, readyCount=1): canRevealAll", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 1,
        firstReadyAt: NOW - 100,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: true,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount: 1, totalCount: 1 },
    });
  });

  it("totalCount=0 (degenerate): everything false, disabled label", () => {
    expect(
      nextRevealCtaState({
        readyCount: 0,
        totalCount: 0,
        firstReadyAt: null,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    });
  });

  it("readyCount > 0 but firstReadyAt null (defensive): treat as disabled", () => {
    expect(
      nextRevealCtaState({
        readyCount: 2,
        totalCount: 6,
        firstReadyAt: null,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    });
  });
});
```

- [ ] **Step 2: Run test, confirm FAIL**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test -- nextRevealCtaState`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reducer**

Create `src/components/voting/nextRevealCtaState.ts`:

```ts
export type RevealCtaAnywayLabel =
  | { kind: "halfReady"; readyCount: number; totalCount: number }
  | { kind: "countdown"; secondsRemaining: number }
  | { kind: "disabled" };

export interface RevealCtaState {
  canRevealAll: boolean;
  canRevealAnyway: boolean;
  anywayLabel: RevealCtaAnywayLabel;
}

export interface NextRevealCtaStateInput {
  readyCount: number;
  totalCount: number;
  firstReadyAt: number | null;
  now: number;
}

const COUNTDOWN_MS = 60_000;

export function nextRevealCtaState(
  input: NextRevealCtaStateInput,
): RevealCtaState {
  const { readyCount, totalCount, firstReadyAt, now } = input;

  const canRevealAll = totalCount > 0 && readyCount === totalCount;

  if (firstReadyAt === null || totalCount === 0) {
    return {
      canRevealAll,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    };
  }

  const halfReached = readyCount * 2 >= totalCount;
  if (halfReached) {
    return {
      canRevealAll,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount, totalCount },
    };
  }

  const elapsed = now - firstReadyAt;
  const secondsRemaining = Math.max(
    0,
    Math.ceil((COUNTDOWN_MS - elapsed) / 1000),
  );
  return {
    canRevealAll,
    canRevealAnyway: elapsed >= COUNTDOWN_MS,
    anywayLabel: { kind: "countdown", secondsRemaining },
  };
}
```

- [ ] **Step 4: Run test, confirm PASS**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test -- nextRevealCtaState`
Expected: 10 tests passing.

- [ ] **Step 5: Type-check**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run type-check`
Expected: clean exit (0).

- [ ] **Step 6: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode add src/components/voting/nextRevealCtaState.ts src/components/voting/nextRevealCtaState.test.ts
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode commit -m "$(cat <<'EOF'
voting: nextRevealCtaState pure reducer for instant-mode CTAs

Drives the three reveal buttons on the admin's instant-mode panel:
canRevealAll (everyone ready), canRevealAnyway (≥½ ready OR 60s
elapsed since firstReadyAt), and an "anyway" label that switches
between "halfReady" (count) and "countdown" (seconds remaining).
10 unit tests cover threshold edge cases, clamping, solo rooms, and
defensive null-firstReadyAt fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `markReady` orchestrator + route + new error code

**Files:**
- Modify: `src/lib/api-errors.ts` (add `"ROOM_NOT_INSTANT"` code)
- Create: `src/lib/rooms/markReady.ts`
- Create: `src/lib/rooms/markReady.test.ts`
- Create: `src/app/api/rooms/[id]/ready/route.ts`
- Create: `src/app/api/rooms/[id]/ready/route.test.ts`

The orchestrator follows the exact shape of `setDelegate.ts` (discriminated `{ok:true,…}|{ok:false,error,status}` result). The route follows `announce/handoff/route.ts`.

- [ ] **Step 1: Add `ROOM_NOT_INSTANT` to the `ApiErrorCode` union**

Open `src/lib/api-errors.ts`. Find the `ApiErrorCode` union (lines 3–28). Add a new branch alongside `"ROOM_NOT_ANNOUNCING"`:

```ts
| "ROOM_NOT_ANNOUNCING"
| "ROOM_NOT_INSTANT"
```

- [ ] **Step 2: Write the orchestrator unit-test skeleton**

Create `src/lib/rooms/markReady.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { markReady } from "./markReady";

function mockSupabase(opts: {
  room?: { id: string; status: string; announcement_mode: string } | null;
  membershipBefore?: { is_ready: boolean; ready_at: string | null } | null;
  countAfter?: { ready: number; total: number };
}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];

  return {
    calls,
    client: {
      from: (table: string) => ({
        select: (_columns: string) => ({
          eq: (_col: string, _val: unknown) => ({
            single: async () => {
              calls.push({ table, op: "select" });
              if (table === "rooms") {
                return opts.room
                  ? { data: opts.room, error: null }
                  : { data: null, error: { code: "PGRST116" } };
              }
              if (table === "room_memberships") {
                return opts.membershipBefore
                  ? { data: opts.membershipBefore, error: null }
                  : { data: null, error: { code: "PGRST116" } };
              }
              return { data: null, error: null };
            },
            eq2: (_col2: string, _val2: unknown) => ({
              single: async () => {
                calls.push({ table, op: "select" });
                if (table === "room_memberships") {
                  return opts.membershipBefore
                    ? { data: opts.membershipBefore, error: null }
                    : { data: null, error: { code: "PGRST116" } };
                }
                return { data: null, error: null };
              },
            }),
          }),
        }),
        update: (payload: unknown) => ({
          eq: (_col: string, _val: unknown) => ({
            eq: (_col2: string, _val2: unknown) => ({
              select: async () => {
                calls.push({ table, op: "update", payload });
                return {
                  data: [{ ready_at: "2026-04-27T10:00:00.000Z" }],
                  error: null,
                };
              },
            }),
          }),
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient<
      import("@/types/database").Database
    >,
  };
}

describe("markReady — happy path", () => {
  it("sets is_ready and ready_at, broadcasts member_ready, returns counts", async () => {
    const broadcastRoomEvent = vi.fn().mockResolvedValue(undefined);
    const result = await markReady(
      { roomId: "room-1", userId: "user-1" },
      {
        // Replace with the right shape per the implementation in Step 3.
        // The test is illustrative; the real test uses the shape below.
      } as never,
    );
    // Placeholder — see Step 3 for the realised test body.
    expect(result).toBeDefined();
  });
});
```

(Note: the mock above is illustrative. The real test in Step 3 uses an inline shape that calls into a single function-style `markReady(input, deps)` — see the implementation below; the test reads cleaner once the orchestrator is in front of you. Do not commit this skeleton; replace it with the version in Step 3 after writing the implementation.)

- [ ] **Step 3: Write the real failing test**

Replace the contents of `src/lib/rooms/markReady.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest";
import { markReady } from "./markReady";

interface FakeRoom {
  id: string;
  status: string;
  announcement_mode: string;
}
interface FakeMembership {
  is_ready: boolean;
  ready_at: string | null;
}
interface FakeCounts {
  ready: number;
  total: number;
}

function mockDeps(opts: {
  room?: FakeRoom | null;
  membership?: FakeMembership | null;
  updateReturns?: { ready_at: string };
  countsAfter?: FakeCounts;
}) {
  const broadcastRoomEvent = vi.fn().mockResolvedValue(undefined);
  const supabase = {
    from(table: string) {
      if (table === "rooms") {
        return {
          select() {
            return {
              eq() {
                return {
                  single: async () =>
                    opts.room
                      ? { data: opts.room, error: null }
                      : { data: null, error: { code: "PGRST116" } },
                };
              },
            };
          },
        };
      }
      if (table === "room_memberships") {
        return {
          select(columns: string) {
            // Two distinct selects: one to fetch the existing membership,
            // one to recount ready/total. Disambiguate by columns string.
            if (columns.includes("is_ready") && columns.includes("ready_at")) {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        single: async () =>
                          opts.membership
                            ? { data: opts.membership, error: null }
                            : { data: null, error: { code: "PGRST116" } },
                      };
                    },
                  };
                },
              };
            }
            // Counts query — return rows shaped like { is_ready: bool }
            return {
              eq: async () => {
                const { ready, total } = opts.countsAfter ?? {
                  ready: 0,
                  total: 0,
                };
                const rows = [
                  ...Array.from({ length: ready }, () => ({ is_ready: true })),
                  ...Array.from({ length: total - ready }, () => ({
                    is_ready: false,
                  })),
                ];
                return { data: rows, error: null };
              },
            };
          },
          update() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      select() {
                        return {
                          single: async () =>
                            opts.updateReturns
                              ? {
                                  data: opts.updateReturns,
                                  error: null,
                                }
                              : { data: null, error: { code: "23000" } },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient<
    import("@/types/database").Database
  >;

  return { supabase, broadcastRoomEvent };
}

describe("markReady — input validation", () => {
  it("rejects non-string roomId", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({});
    const result = await markReady(
      { roomId: 42, userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
    }
  });

  it("rejects non-string userId", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({});
    const result = await markReady(
      { roomId: "r1", userId: null },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BODY");
    }
  });
});

describe("markReady — room state", () => {
  it("404 when room not found", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({ room: null });
    const result = await markReady(
      { roomId: "missing", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(404);
    }
  });

  it("409 ROOM_NOT_INSTANT when announcement_mode != 'instant'", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "live" },
      membership: { is_ready: false, ready_at: null },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_INSTANT");
      expect(result.status).toBe(409);
    }
  });

  it("409 ROOM_NOT_ANNOUNCING when status != 'announcing'", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "voting", announcement_mode: "instant" },
      membership: { is_ready: false, ready_at: null },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_ANNOUNCING");
      expect(result.status).toBe(409);
    }
  });
});

describe("markReady — authorization", () => {
  it("403 when user is not a room member", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "instant" },
      membership: null,
    });
    const result = await markReady(
      { roomId: "r1", userId: "outsider" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(403);
    }
  });
});

describe("markReady — happy path", () => {
  it("sets is_ready, broadcasts member_ready, returns counts", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "instant" },
      membership: { is_ready: false, ready_at: null },
      updateReturns: { ready_at: "2026-04-27T10:00:00.000Z" },
      countsAfter: { ready: 1, total: 3 },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readyAt).toBe("2026-04-27T10:00:00.000Z");
      expect(result.readyCount).toBe(1);
      expect(result.totalCount).toBe(3);
    }
    expect(broadcastRoomEvent).toHaveBeenCalledWith("r1", {
      type: "member_ready",
      userId: "u1",
      readyAt: "2026-04-27T10:00:00.000Z",
      readyCount: 1,
      totalCount: 3,
    });
  });

  it("idempotent: already-ready member returns existing readyAt without re-broadcast", async () => {
    const { supabase, broadcastRoomEvent } = mockDeps({
      room: { id: "r1", status: "announcing", announcement_mode: "instant" },
      membership: { is_ready: true, ready_at: "2026-04-27T09:00:00.000Z" },
      countsAfter: { ready: 2, total: 3 },
    });
    const result = await markReady(
      { roomId: "r1", userId: "u1" },
      { supabase, broadcastRoomEvent },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.readyAt).toBe("2026-04-27T09:00:00.000Z");
    }
    expect(broadcastRoomEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test, confirm FAIL**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test -- markReady`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the orchestrator**

Create `src/lib/rooms/markReady.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface MarkReadyInput {
  roomId: unknown;
  userId: unknown;
}

export interface MarkReadyDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface MarkReadySuccess {
  ok: true;
  readyAt: string;
  readyCount: number;
  totalCount: number;
}

export interface MarkReadyFailure {
  ok: false;
  status: number;
  error: { code: ApiErrorCode; message: string; field?: string };
}

export type MarkReadyResult = MarkReadySuccess | MarkReadyFailure;

export async function markReady(
  input: MarkReadyInput,
  deps: MarkReadyDeps,
): Promise<MarkReadyResult> {
  const { roomId, userId } = input;
  if (typeof roomId !== "string" || roomId.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_BODY",
        message: "roomId must be a non-empty string.",
        field: "roomId",
      },
    };
  }
  if (typeof userId !== "string" || userId.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_BODY",
        message: "userId must be a non-empty string.",
        field: "userId",
      },
    };
  }

  const { supabase, broadcastRoomEvent } = deps;

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status, announcement_mode")
    .eq("id", roomId)
    .single();

  if (roomError || !room) {
    return {
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    };
  }

  if (room.announcement_mode !== "instant") {
    return {
      ok: false,
      status: 409,
      error: {
        code: "ROOM_NOT_INSTANT",
        message:
          "Ready toggle is only available in instant-mode rooms.",
      },
    };
  }

  if (room.status !== "announcing") {
    return {
      ok: false,
      status: 409,
      error: {
        code: "ROOM_NOT_ANNOUNCING",
        message: "Ready toggle is only available during announcing.",
      },
    };
  }

  // Fetch existing membership (also serves as the auth check — no row → 403).
  const { data: existing, error: membershipError } = await supabase
    .from("room_memberships")
    .select("is_ready, ready_at")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .single();

  if (membershipError || !existing) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "ROOM_NOT_FOUND",
        message: "You are not a member of this room.",
      },
    };
  }

  let readyAt: string;
  let didTransition = false;
  if (existing.is_ready && existing.ready_at) {
    // Idempotent — already ready.
    readyAt = existing.ready_at;
  } else {
    const newReadyAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("room_memberships")
      .update({ is_ready: true, ready_at: newReadyAt })
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .select("ready_at")
      .single();
    if (updateError || !updated) {
      return {
        ok: false,
        status: 500,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to mark membership ready.",
        },
      };
    }
    readyAt = updated.ready_at ?? newReadyAt;
    didTransition = true;
  }

  // Recount.
  const { data: rows, error: countError } = await supabase
    .from("room_memberships")
    .select("is_ready")
    .eq("room_id", roomId);
  if (countError || !rows) {
    return {
      ok: false,
      status: 500,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to recount memberships.",
      },
    };
  }
  const readyCount = rows.filter((r) => r.is_ready).length;
  const totalCount = rows.length;

  if (didTransition) {
    await broadcastRoomEvent(roomId, {
      type: "member_ready",
      userId,
      readyAt,
      readyCount,
      totalCount,
    });
  }

  return { ok: true, readyAt, readyCount, totalCount };
}
```

- [ ] **Step 6: Run test, confirm PASS**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test -- markReady`
Expected: 8 tests passing (input-validation × 2, room-state × 3, auth × 1, happy path × 2).

- [ ] **Step 7: Write the route file**

Create `src/app/api/rooms/[id]/ready/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { markReady } from "@/lib/rooms/markReady";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
import { getSessionUserIdFromHeaders } from "@/lib/session";

/**
 * POST /api/rooms/{id}/ready
 * Body: {} (empty — userId derived from session)
 *
 * User marks themselves ready in instant-mode announcing rooms.
 * Idempotent. SPEC §10.1.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = await getSessionUserIdFromHeaders(request);
  if (!userId) {
    return apiError("INVALID_TOKEN", "Session required.", 401);
  }

  const result = await markReady(
    { roomId: params.id, userId },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json(
      {
        readyAt: result.readyAt,
        readyCount: result.readyCount,
        totalCount: result.totalCount,
      },
      { status: 200 },
    );
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
```

- [ ] **Step 8: Verify the session helper exists**

Run: `cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && grep -n "getSessionUserIdFromHeaders\|getSessionFromRequest" src/lib/session.ts`

If `getSessionUserIdFromHeaders` does not exist, look at `src/app/api/rooms/[id]/announce/handoff/route.ts` to see how the existing route extracts the userId from the request body or session, and mirror that pattern. **If the existing route extracts userId from the JSON body rather than the session, the route file must do the same.** Read `src/app/api/rooms/[id]/announce/handoff/route.ts` for the canonical pattern; replace the body of `POST` accordingly. The orchestrator's `userId` argument is identical either way.

For example, if the canonical pattern extracts userId from the body:

```ts
let body: unknown;
try { body = await request.json(); } catch {
  return apiError("INVALID_BODY", "Request body must be valid JSON.", 400);
}
if (typeof body !== "object" || body === null || Array.isArray(body)) {
  return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
}
const input = body as { userId?: unknown };
const result = await markReady(
  { roomId: params.id, userId: input.userId },
  { supabase: createServiceClient(), broadcastRoomEvent: defaultBroadcastRoomEvent },
);
// ... rest unchanged
```

Pick the pattern that the existing routes (handoff, announce/next) use. Keep the slice consistent.

- [ ] **Step 9: Write the route test**

Create `src/app/api/rooms/[id]/ready/route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({} as never)),
}));

vi.mock("@/lib/rooms/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/rooms/shared")
  >("@/lib/rooms/shared");
  return {
    ...actual,
    defaultBroadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
  };
});

const markReadyMock = vi.fn();
vi.mock("@/lib/rooms/markReady", () => ({
  markReady: (...args: unknown[]) => markReadyMock(...args),
}));

function makeRequest(body: unknown = {}) {
  return new NextRequest("http://localhost/api/rooms/r1/ready", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/rooms/[id]/ready", () => {
  it("200 happy path delegates to markReady", async () => {
    markReadyMock.mockResolvedValueOnce({
      ok: true,
      readyAt: "2026-04-27T10:00:00.000Z",
      readyCount: 2,
      totalCount: 3,
    });
    // The body shape depends on Step 8's auth pattern. If the route
    // pulls userId from the body, send it here.
    const res = await POST(
      makeRequest({ userId: "u1" }),
      { params: { id: "r1" } },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      readyAt: "2026-04-27T10:00:00.000Z",
      readyCount: 2,
      totalCount: 3,
    });
    expect(markReadyMock).toHaveBeenCalled();
  });

  it("returns the orchestrator's status + error code on failure", async () => {
    markReadyMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_INSTANT", message: "Not instant." },
    });
    const res = await POST(
      makeRequest({ userId: "u1" }),
      { params: { id: "r1" } },
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("ROOM_NOT_INSTANT");
  });
});
```

(If Step 8's auth pattern uses headers/cookies instead of a body field, drop `userId` from the test request body and ensure the test mocks the session helper instead. Adjust the `vi.mock(...)` setup accordingly — pattern is in the existing `route.test.ts` files like `setDelegate`'s test.)

- [ ] **Step 10: Run tests + type-check**

Run:
```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run type-check
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test
```
Expected: type-check clean; all tests pass.

- [ ] **Step 11: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode add src/lib/api-errors.ts src/lib/rooms/markReady.ts src/lib/rooms/markReady.test.ts src/app/api/rooms/[id]/ready/route.ts src/app/api/rooms/[id]/ready/route.test.ts
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode commit -m "$(cat <<'EOF'
api: POST /rooms/[id]/ready + markReady orchestrator (Phase 5c.1)

Idempotent ready toggle for instant-mode announcing rooms. Validates
status + announcement_mode, gates membership lookup as auth, writes
is_ready=true + ready_at=now() if not already set, recounts ready/
total, broadcasts member_ready (only on transition). New ApiErrorCode:
ROOM_NOT_INSTANT.

8 orchestrator tests (validation, room state, auth, happy path,
idempotent re-call) + 2 route tests (delegation + error mapping).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Realtime + client API helper

**Files:**
- Modify: `src/hooks/useRoomRealtime.ts`
- Modify: `src/lib/room/api.ts`

- [ ] **Step 1: Read `useRoomRealtime.ts`**

Identify the spot where existing room events (e.g. `status_changed`) are dispatched to the consumer. The hook likely accepts an `onEvent` (or similar) callback or returns a typed event stream.

- [ ] **Step 2: Surface `member_ready`**

If `useRoomRealtime` already routes the full `RoomEvent` union to a single `onEvent` callback, **no code change is needed** — `member_ready` is part of the union. Verify by typecheck.

If the hook has explicit per-type handlers (e.g. `onStatusChanged`, `onAnnounceNext`), add a parallel `onMemberReady?: (event: Extract<RoomEvent, { type: "member_ready" }>) => void` parameter and dispatch matching events.

The exact diff depends on the hook's existing shape. Read it first; pattern-match.

- [ ] **Step 3: Add `postRoomReady` client helper**

Open `src/lib/room/api.ts`. Find the existing `postRoomScore` (or any other `postRoom*` helper) and add a new export:

```ts
export interface PostRoomReadyResponse {
  readyAt: string;
  readyCount: number;
  totalCount: number;
}

export async function postRoomReady(
  roomId: string,
  init?: { signal?: AbortSignal },
): Promise<PostRoomReadyResponse> {
  // If the existing pattern POSTs userId in the body, mirror it exactly.
  // If the existing pattern relies on session/cookies, send {}.
  const body = await getRoomReadyRequestBody(); // see helper note below
  const res = await fetch(`/api/rooms/${roomId}/ready`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: null }));
    throw new Error(
      error?.message ?? `Failed to mark ready (status ${res.status}).`,
    );
  }
  return res.json();
}
```

For `getRoomReadyRequestBody`: look at `postRoomScore`'s body-construction pattern in the same file. If `postRoomScore` reads userId from `getSession()` (a localStorage-backed helper) and posts `{ userId }`, do the same here. If it sends an empty body relying on cookies, send `{}`. **Match the existing convention exactly** — don't invent a new pattern.

- [ ] **Step 4: Run type-check + tests**

```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run type-check
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode add src/hooks/useRoomRealtime.ts src/lib/room/api.ts
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode commit -m "$(cat <<'EOF'
realtime + api: surface member_ready, add postRoomReady (Phase 5c.1)

useRoomRealtime now routes member_ready events through to consumers
(or no-ops if the hook already passes the full RoomEvent union).
postRoomReady client helper mirrors the existing postRoom* shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Components + room-page integration + locale keys

**Files:**
- Create: `src/components/room/InstantOwnBreakdown.tsx`
- Create: `src/components/room/RevealCtaPanel.tsx`
- Create: `src/components/room/InstantAnnouncingView.tsx`
- Modify: `src/app/room/[id]/page.tsx`
- Modify: `src/locales/en.json`

Single coupled commit. The components are unused without the page-level branch; the locale keys are unused until the components consume them.

**Component testing posture:** repo's vitest is `node`-env, no testing-library. JSX is manually smoke-tested in Step 7.

- [ ] **Step 1: Add locale keys to `en.json`**

Open `src/locales/en.json`. Add a new top-level namespace `instantAnnounce` (anywhere within the JSON object — `voting` and `instantAnnounce` are siblings):

```json
"instantAnnounce": {
  "ownResults": {
    "title": "Your points",
    "empty": "You didn't score any contestants this round."
  },
  "ready": {
    "button": "Ready to reveal",
    "busy": "Marking ready…",
    "waiting": "Waiting on {count} other"
  },
  "admin": {
    "readyCount": "{ready} / {total} ready",
    "revealAll": "Reveal final results",
    "revealAnyway": "Reveal anyway",
    "revealAnywayCountdown": "Reveal anyway — unlocks in {minutes}:{seconds}",
    "revealAnywayHalf": "Reveal anyway — {ready} / {total} ready",
    "override": "Admin override — reveal now",
    "overrideConfirmTitle": "Reveal the results right now?",
    "overrideConfirmBody": "No one will be waited for.",
    "overrideConfirmCancel": "Cancel",
    "overrideConfirmGo": "Reveal"
  }
}
```

(Note: `ready.waiting` uses ICU `{count}`. Pluralisation across locales is Phase L L3's concern; for `en` the singular vs plural difference is "1 other" vs "2 others", which is small enough to ignore in the v1 string.)

Validate JSON parses:
```
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8')); console.log('OK')"
```
Expected: `OK`.

- [ ] **Step 2: Create `<InstantOwnBreakdown>`**

Create `src/components/room/InstantOwnBreakdown.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";

export interface OwnBreakdownEntry {
  contestantId: string;
  pointsAwarded: number;
  hotTake: string | null;
}

export interface InstantOwnBreakdownProps {
  entries: OwnBreakdownEntry[];
  contestants: Contestant[];
}

export default function InstantOwnBreakdown({
  entries,
  contestants,
}: InstantOwnBreakdownProps) {
  const t = useTranslations();
  const byId = useMemo(() => {
    const map = new Map<string, Contestant>();
    for (const c of contestants) map.set(c.id, c);
    return map;
  }, [contestants]);

  const sorted = useMemo(
    () =>
      entries
        .filter((e) => e.pointsAwarded > 0)
        .sort((a, b) => b.pointsAwarded - a.pointsAwarded),
    [entries],
  );

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">
        {t("instantAnnounce.ownResults.title")}
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instantAnnounce.ownResults.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((entry) => {
            const c = byId.get(entry.contestantId);
            if (!c) return null;
            return (
              <li
                key={entry.contestantId}
                className="flex items-start gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary tabular-nums">
                  {entry.pointsAwarded}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {c.flagEmoji} {c.country} — {c.song}
                  </p>
                  {entry.hotTake && (
                    <p className="text-xs text-muted-foreground italic mt-1">
                      &ldquo;{entry.hotTake}&rdquo;
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Create `<RevealCtaPanel>`**

Create `src/components/room/RevealCtaPanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { nextRevealCtaState } from "@/components/voting/nextRevealCtaState";
import Button from "@/components/ui/Button";

export interface RevealCtaPanelProps {
  readyCount: number;
  totalCount: number;
  firstReadyAt: string | null;  // ISO; null when no one is ready yet
  onReveal: () => Promise<void>;
}

const TICK_MS = 250;

export default function RevealCtaPanel({
  readyCount,
  totalCount,
  firstReadyAt,
  onReveal,
}: RevealCtaPanelProps) {
  const t = useTranslations();
  const [now, setNow] = useState(() => Date.now());
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const cta = nextRevealCtaState({
    readyCount,
    totalCount,
    firstReadyAt: firstReadyAt ? Date.parse(firstReadyAt) : null,
    now,
  });

  const handleReveal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onReveal();
    } finally {
      setBusy(false);
      setOverrideOpen(false);
    }
  };

  let anywayLabel: string;
  if (cta.anywayLabel.kind === "halfReady") {
    anywayLabel = t("instantAnnounce.admin.revealAnywayHalf", {
      ready: cta.anywayLabel.readyCount,
      total: cta.anywayLabel.totalCount,
    });
  } else if (cta.anywayLabel.kind === "countdown") {
    const total = cta.anywayLabel.secondsRemaining;
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    anywayLabel = t("instantAnnounce.admin.revealAnywayCountdown", {
      minutes,
      seconds,
    });
  } else {
    anywayLabel = t("instantAnnounce.admin.revealAnyway");
  }

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <Button
        variant="primary"
        disabled={!cta.canRevealAll || busy}
        onClick={handleReveal}
        className="w-full"
      >
        {t("instantAnnounce.admin.revealAll")}
      </Button>
      <Button
        variant="ghost"
        disabled={!cta.canRevealAnyway || busy}
        onClick={handleReveal}
        className="w-full"
      >
        {anywayLabel}
      </Button>
      <button
        type="button"
        onClick={() => setOverrideOpen(true)}
        disabled={busy}
        className="w-full text-sm text-destructive hover:underline"
      >
        {t("instantAnnounce.admin.override")}
      </button>

      {overrideOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="override-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOverrideOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-sm m-4 bg-background rounded-xl border border-border p-6 space-y-4">
            <h2 id="override-confirm-title" className="text-lg font-bold">
              {t("instantAnnounce.admin.overrideConfirmTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("instantAnnounce.admin.overrideConfirmBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setOverrideOpen(false)}
                disabled={busy}
              >
                {t("instantAnnounce.admin.overrideConfirmCancel")}
              </Button>
              <Button
                variant="primary"
                onClick={handleReveal}
                disabled={busy}
              >
                {t("instantAnnounce.admin.overrideConfirmGo")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Create `<InstantAnnouncingView>`**

Create `src/components/room/InstantAnnouncingView.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Contestant } from "@/types";
import Button from "@/components/ui/Button";
import InstantOwnBreakdown, {
  type OwnBreakdownEntry,
} from "@/components/room/InstantOwnBreakdown";
import RevealCtaPanel from "@/components/room/RevealCtaPanel";

export interface InstantAnnouncingMember {
  userId: string;
  displayName: string;
  isReady: boolean;
  readyAt: string | null;
}

export interface InstantAnnouncingViewProps {
  room: { id: string; ownerUserId: string };
  contestants: Contestant[];
  memberships: InstantAnnouncingMember[];
  currentUserId: string;
  ownBreakdown: OwnBreakdownEntry[];
  onMarkReady: () => Promise<void>;
  onReveal: () => Promise<void>;
}

export default function InstantAnnouncingView({
  room,
  contestants,
  memberships,
  currentUserId,
  ownBreakdown,
  onMarkReady,
  onReveal,
}: InstantAnnouncingViewProps) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);

  const isAdmin = currentUserId === room.ownerUserId;
  const ownIsReady = useMemo(
    () =>
      memberships.find((m) => m.userId === currentUserId)?.isReady ?? false,
    [memberships, currentUserId],
  );
  const readyCount = memberships.filter((m) => m.isReady).length;
  const totalCount = memberships.length;
  const firstReadyAt = useMemo(() => {
    const readyAts = memberships
      .filter((m) => m.isReady && m.readyAt)
      .map((m) => m.readyAt!)
      .sort();
    return readyAts[0] ?? null;
  }, [memberships]);

  const handleReady = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onMarkReady();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("instantAnnounce.admin.readyCount", {
              ready: readyCount,
              total: totalCount,
            })}
          </p>
        </header>

        <InstantOwnBreakdown
          entries={ownBreakdown}
          contestants={contestants}
        />

        {ownIsReady ? (
          <p className="text-sm text-muted-foreground text-center">
            {t("instantAnnounce.ready.waiting", {
              count: Math.max(0, totalCount - readyCount),
            })}
          </p>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={handleReady}
            className="w-full"
          >
            {busy
              ? t("instantAnnounce.ready.busy")
              : t("instantAnnounce.ready.button")}
          </Button>
        )}

        {isAdmin && (
          <RevealCtaPanel
            readyCount={readyCount}
            totalCount={totalCount}
            firstReadyAt={firstReadyAt}
            onReveal={onReveal}
          />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Wire `<InstantAnnouncingView>` into the room page**

Open `src/app/room/[id]/page.tsx`. Locate the `if (phase.room.status === "announcing")` block (around line 384). Currently it unconditionally renders `<AnnouncingView>`. Branch on `announcementMode`:

Find:

```tsx
if (phase.room.status === "announcing") {
  const session = getSession();
  if (!session) return <StatusStub status={phase.room.status} />;
  return (
    <AnnouncingView
      room={{
        id: phase.room.id,
        status: phase.room.status,
        ownerUserId: phase.room.ownerUserId,
      }}
      contestants={phase.contestants}
      currentUserId={session.userId}
      onAnnouncementEnded={() => void loadRoom()}
    />
  );
}
```

Replace with:

```tsx
if (phase.room.status === "announcing") {
  const session = getSession();
  if (!session) return <StatusStub status={phase.room.status} />;

  if (phase.room.announcementMode === "instant") {
    return (
      <InstantAnnouncingView
        room={{
          id: phase.room.id,
          ownerUserId: phase.room.ownerUserId,
        }}
        contestants={phase.contestants}
        memberships={phase.memberships}
        currentUserId={session.userId}
        ownBreakdown={phase.ownBreakdown}
        onMarkReady={handleMarkReady}
        onReveal={handleReveal}
      />
    );
  }

  return (
    <AnnouncingView
      room={{
        id: phase.room.id,
        status: phase.room.status,
        ownerUserId: phase.room.ownerUserId,
      }}
      contestants={phase.contestants}
      currentUserId={session.userId}
      onAnnouncementEnded={() => void loadRoom()}
    />
  );
}
```

The required new pieces:

**5a. Import the new component** at the top of the file:

```tsx
import InstantAnnouncingView from "@/components/room/InstantAnnouncingView";
```

**5b. Surface `phase.memberships` and `phase.ownBreakdown`.** The existing `phase` shape comes from `loadRoom()`. The memberships array is already on `phase.memberships` (per `LobbyView`'s consumption). The ownBreakdown needs to come from `GET /api/rooms/{id}/results` — call it on entry to `announcing` and store in state.

Add a state hook near the existing `useState` calls:

```tsx
const [ownBreakdown, setOwnBreakdown] = useState<OwnBreakdownEntry[] | null>(
  null,
);
```

Add an effect that fetches results when status is `announcing` AND mode is `instant` AND we don't already have it:

```tsx
useEffect(() => {
  if (
    phase?.room.status !== "announcing" ||
    phase.room.announcementMode !== "instant" ||
    ownBreakdown !== null
  ) {
    return;
  }
  let cancelled = false;
  void (async () => {
    try {
      const session = getSession();
      if (!session) return;
      const res = await fetch(`/api/rooms/${phase.room.id}/results`);
      if (!res.ok) return;
      const json = await res.json();
      if (cancelled) return;
      // results endpoint returns SPEC §12.5 discriminated payload — when
      // status is "announcing" the payload includes per-user breakdowns.
      // Find the current user's breakdown and project it.
      const ownEntries: OwnBreakdownEntry[] = [];
      for (const userResult of json.users ?? []) {
        if (userResult.userId !== session.userId) continue;
        for (const row of userResult.results ?? []) {
          ownEntries.push({
            contestantId: row.contestantId,
            pointsAwarded: row.pointsAwarded,
            hotTake: row.hotTake ?? null,
          });
        }
      }
      setOwnBreakdown(ownEntries);
    } catch {
      // Silent — the InstantAnnouncingView gracefully renders the
      // empty-results message if ownBreakdown stays empty.
    }
  })();
  return () => {
    cancelled = true;
  };
}, [phase?.room.status, phase?.room.announcementMode, phase?.room.id, ownBreakdown]);
```

Reset `ownBreakdown` whenever the room id or status changes back out of `announcing`:

```tsx
useEffect(() => {
  if (phase?.room.status !== "announcing") setOwnBreakdown(null);
}, [phase?.room.status]);
```

**5c. Add `handleMarkReady` and `handleReveal` handlers.** Place these near the other handlers in the component:

```tsx
const handleMarkReady = useCallback(async () => {
  if (!phase) return;
  await postRoomReady(phase.room.id);
  // member_ready broadcast will refresh memberships via realtime; refetch
  // as a safety net in case the broadcast lands after the response.
  void loadRoom();
}, [phase, loadRoom]);

const handleReveal = useCallback(async () => {
  if (!phase) return;
  await patchRoomStatus(phase.room.id, "done");
  // status_changed broadcast will drive the refetch + DoneCard render.
}, [phase]);
```

Add `postRoomReady` to the import line for `@/lib/room/api`:

```tsx
import {
  fetchRoomData,
  joinRoomApi,
  patchRoomStatus,
  postRoomScore,
  postRoomReady,
  type FetchRoomData,
} from "@/lib/room/api";
```

Add the `OwnBreakdownEntry` import:

```tsx
import type { OwnBreakdownEntry } from "@/components/room/InstantOwnBreakdown";
```

The `useEffect` import already exists. The page uses `useState` + `useCallback` — both should be in the import line.

**5d. Pass an `ownBreakdown ?? []` fallback to the new component**, since the value can be null while loading. Update the JSX block to:

```tsx
ownBreakdown={ownBreakdown ?? []}
```

(Already correctly written above; mentioning here for emphasis. The component renders the empty-state line cleanly when there are no entries.)

- [ ] **Step 6: Type-check + tests**

Run:
```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run type-check
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test 2>&1 | tail -3
```
Expected: type-check clean (0). All tests still pass.

If type-check fails on the `phase` shape, check `FetchRoomData`'s return type — `memberships` and `announcementMode` need to be present. They already are (`get.ts` Task 2 surfaces both).

- [ ] **Step 7: Manual smoke test (HTTP probe)**

Start the dev server in the BACKGROUND:

```
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run dev
```

Wait ~5s. Probe:

```
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```
Expected: `200`.

Stop: `pkill -f "next dev" || true`.

(Full UI smoke per spec §3.4 is the controller's responsibility — requires creating a real instant-mode room in a browser.)

- [ ] **Step 8: Commit**

```bash
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode rev-parse --abbrev-ref HEAD
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode add src/components/room/InstantOwnBreakdown.tsx src/components/room/RevealCtaPanel.tsx src/components/room/InstantAnnouncingView.tsx src/app/room/[id]/page.tsx src/locales/en.json
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode diff --cached --stat
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode commit -m "$(cat <<'EOF'
voting: instant-mode announce view + admin reveal CTAs (Phase 5c.1)

InstantAnnouncingView renders the own-results breakdown (sorted by
points awarded desc) + Ready button + (admin) RevealCtaPanel with the
three CTAs driven by nextRevealCtaState. The room page branches on
announcementMode and fetches the per-user results payload to project
ownBreakdown when announcing+instant.

handleMarkReady → postRoomReady; handleReveal → patchRoomStatus(done).
Both rely on existing realtime broadcasts to drive UI updates.

14 new locale keys under instantAnnounce.{ownResults,ready,admin};
non-en deferred to Phase L L3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Final verification

**Files:** none modified.

- [ ] **Step 1: Type-check**

Run:
```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run type-check 2>&1
```
Expected: clean exit (0).

- [ ] **Step 2: Lint**

Run:
```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run lint 2>&1
```
Expected: clean. Pre-existing warning in `useRoomRealtime.ts` is acceptable; flag NEW warnings.

- [ ] **Step 3: Full test suite**

Run:
```bash
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm test 2>&1 | tail -5
```
Expected: every suite passes; final count ≥ 818 (798 baseline + 10 reducer tests + 8 orchestrator tests + 2 route tests).

- [ ] **Step 4: HTTP probe**

Start dev server in background:
```
cd /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode && npm run dev
```

Wait ~5s. Probe `/`, `/create`, `/join`:
```
curl -s -o /dev/null -w "/  %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "/create  %{http_code}\n" http://localhost:3000/create
curl -s -o /dev/null -w "/join  %{http_code}\n" http://localhost:3000/join
```
All expected: `200`.

Stop: `pkill -f "next dev" || true`.

- [ ] **Step 5: Clean git state**

```
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode status -s
```
Expected: empty.

- [ ] **Step 6: Commit log**

```
git -C /Users/valeriiakulynych/Projects/eurovisionmaxxing/.claude/worktrees/phase-5c1-instant-mode log --oneline main..HEAD
```
Expected (newest first):
- Task 6: `voting: instant-mode announce view + admin reveal CTAs (Phase 5c.1)`
- Task 5: `realtime + api: surface member_ready, add postRoomReady (Phase 5c.1)`
- Task 4: `api: POST /rooms/[id]/ready + markReady orchestrator (Phase 5c.1)`
- Task 3: `voting: nextRevealCtaState pure reducer for instant-mode CTAs`
- Task 2: `types: surface readyAt on memberships + add member_ready RoomEvent`
- Task 1: `schema: add room_memberships.ready_at (Phase 5c.1)`
- Plan: `plan: Phase 5c.1 instant-mode reveal flow implementation plan`
- Spec: `spec: 2026-04-27 Phase 5c.1 instant-mode reveal flow design`

8 commits ahead of `main`.

- [ ] **Step 7: Stop here**

Controller handles push + PR + manual UI smoke. Do NOT push or open the PR.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-04-27-phase-5c1-instant-mode-design.md`):

- §3.1.A schema migration → Task 1 ✅
- §3.1.B `POST /api/rooms/[id]/ready` → Task 4 ✅ (orchestrator + route + new error code)
- §3.1.C admin reveal via existing `PATCH /status` → Task 6 (handler `handleReveal` calls `patchRoomStatus(roomId, 'done')`) ✅
- §3.1.D `<InstantAnnouncingView>` → Task 6 Step 4 ✅
- §3.1.E `<RevealCtaPanel>` + `nextRevealCtaState` → Task 3 (reducer) + Task 6 Step 3 (component) ✅
- §3.1.F `member_ready` realtime event → Task 2 (RoomEvent union) + Task 4 (broadcast in markReady) + Task 5 (consumer wiring) ✅
- §3.1.G room-page integration → Task 6 Step 5 ✅
- §3.1.H `<DoneCard>` handoff → no changes needed; existing component handles `done` rooms ✅
- §3.1.I locale keys → Task 6 Step 1 ✅
- §3.2 own-results breakdown shape (sorted desc by points, hot takes inline, points pill) → Task 6 Step 2 (`InstantOwnBreakdown`) ✅
- §3.3 ready-count chip + countdown UX → Task 6 Steps 3, 4 ✅
- §6 tests → Tasks 3, 4, 4 (reducer × 10, orchestrator × 8, route × 2) ✅. JSX manually smoke-tested.
- §7 acceptance verification → Task 7 ✅
- §9 slicing → 6 implementation tasks + 1 verification, matching the spec's "6 logical commits" intent ✅ (the tasks here yield 6 implementation commits + the spec/plan commits already in place).

No gaps.

**Placeholder scan:** no "TBD", no "implement later", no "fill in details", no empty steps. Each step has either complete code, an exact command, or a precise editing instruction. Two steps (Task 4 Step 8, Task 5 Step 3) explicitly delegate to "match the existing route pattern" — those instructions reference the canonical files (`announce/handoff/route.ts`, `postRoomScore`) and tell the implementer to inspect them and copy the pattern. This is the right call when an existing convention is the source of truth; the alternative (guessing the pattern in advance) risks plan drift.

**Type consistency:**
- `MarkReadyInput`, `MarkReadyDeps`, `MarkReadyResult` (success/failure variants) defined in Task 4 Step 5 used identically in Task 4 Step 3 (test) and Task 4 Step 7 (route handler).
- `RevealCtaState`, `RevealCtaAnywayLabel`, `NextRevealCtaStateInput` defined in Task 3 Step 3 used identically in Task 3 Step 1 (test) and Task 6 Step 3 (component).
- `OwnBreakdownEntry` defined in Task 6 Step 2 (`InstantOwnBreakdown`) used identically in Task 6 Steps 4 and 5.
- `InstantAnnouncingViewProps` (component contract) defined in Task 6 Step 4 used identically in Task 6 Step 5 (room page consumption).
- `member_ready` event shape (`type`, `userId`, `readyAt`, `readyCount`, `totalCount`) defined in Task 2 Step 4 (`RoomEvent` union) used identically in Task 4 Step 5 (broadcast call) and Task 4 Step 3 (test assertion).
- Locale keys: `instantAnnounce.admin.revealAnywayCountdown` uses `{minutes}` and `{seconds}` ICU params; consumer in Task 6 Step 3 (`<RevealCtaPanel>`) passes both. `revealAnywayHalf` uses `{ready}` and `{total}`; consumer matches. `readyCount` uses `{ready}` and `{total}`; consumer matches.
