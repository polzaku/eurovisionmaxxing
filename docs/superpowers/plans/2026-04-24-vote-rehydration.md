# Vote Rehydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/room/[id]` load, seed `VotingView`'s `scoresByContestant` from the server so scores survive a page reload.

**Architecture:** `GET /api/rooms/{id}` gains an optional `?userId=<uuid>` query param. When present, the server returns the caller's vote rows alongside the existing `{room, memberships, contestants}`. A new pure client helper `seedScoresFromVotes` transforms the array payload into `VotingView`'s keyed shape; the page threads it as `initialScores` and `VotingView` uses it in its `useState` initializer.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Vitest (node env), Supabase service client (server only).

Design: [docs/superpowers/specs/2026-04-24-vote-rehydration-design.md](../specs/2026-04-24-vote-rehydration-design.md) — read it first.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/rooms/get.ts` | modify | Accept optional `input.userId`; validate as UUID; run votes query; return `votes: VoteView[]` (always present, may be empty) |
| `src/lib/rooms/get.test.ts` | modify | Extend `makeSupabaseMock` to handle the `votes` table; add 5 new test cases |
| `src/app/api/rooms/[id]/route.ts` | modify | Parse `userId` from `request.nextUrl.searchParams`; pass into `getRoom` |
| `src/lib/room/api.ts` | modify | Widen `fetchRoomData(roomId, userId, deps)`; add `votes: unknown[]` to `FetchRoomData` |
| `src/lib/voting/seedScoresFromVotes.ts` | **new** | Pure helper: array → sparse `Record<contestantId, Record<categoryName, number \| null>>` with defensive key filtering |
| `src/lib/voting/seedScoresFromVotes.test.ts` | **new** | 6 unit tests (pure, no DOM) |
| `src/components/voting/VotingView.tsx` | modify | Add optional `initialScores?` prop; pass to `useState` initializer |
| `src/app/room/[id]/page.tsx` | modify | Pass `userId` to `fetchRoomData`; thread `votes` through `Phase.ready`; compute + pass `initialScores` to `VotingView` |

**Not touched:** `postVote`, `Autosaver`, `useVoteAutosave`, `SaveChip`, `scoredCount`, `ScoreRow`, `nextScore`, DB schema.

---

## Task 1: Extend `getRoom` to return votes

**Files:**
- Modify: `src/lib/rooms/get.ts`
- Modify: `src/lib/rooms/get.test.ts`

Server-side lib change is the foundation — client tasks depend on the API shape.

- [ ] **Step 1.1: Add `VoteView` type + widen `GetRoomInput`/`GetRoomData`**

Open `src/lib/rooms/get.ts`. Find the `GetRoomInput` interface and the `GetRoomData` interface. Replace them with:

```ts
export interface GetRoomInput {
  roomId: unknown;
  userId?: unknown;
}

export interface VoteView {
  contestantId: string;
  scores: Record<string, number | null> | null;
  missed: boolean;
  hotTake: string | null;
}

export interface GetRoomData {
  room: Room;
  memberships: MembershipView[];
  contestants: Contestant[];
  votes: VoteView[];
}
```

(`MembershipView`, `Room`, `Contestant` keep their existing import + definitions.)

- [ ] **Step 1.2: Extend the test harness to mock the `votes` table**

Open `src/lib/rooms/get.test.ts`. Find the `makeSupabaseMock` function. Replace the `if (table === "room_memberships") {` block all the way through the `throw new Error(\`unexpected table: ${table}\`);` line — i.e. add handling for a third table below the existing two. The full replacement (keeping the rooms + memberships branches unchanged) ends with:

```ts
    if (table === "room_memberships") {
      return {
        select: vi.fn((select: string) => ({
          eq: vi.fn((col: string, val: unknown) => {
            membershipSelectCalls.push({ table, eq: { col, val }, select });
            return Promise.resolve(membershipsResult);
          }),
        })),
      };
    }
    if (table === "votes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col1: string, val1: unknown) => ({
            eq: vi.fn((col2: string, val2: unknown) => {
              votesSelectCalls.push({
                table,
                eq1: { col: col1, val: val1 },
                eq2: { col: col2, val: val2 },
              });
              return Promise.resolve(votesResult);
            }),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
```

Also extend `MockOptions` and the `makeSupabaseMock` signature/body. Find:

```ts
interface MockOptions {
  roomResult?: { data: unknown; error: { message: string } | null };
  membershipsResult?: { data: unknown; error: { message: string } | null };
}
```

Replace with:

```ts
interface MockOptions {
  roomResult?: { data: unknown; error: { message: string } | null };
  membershipsResult?: { data: unknown; error: { message: string } | null };
  votesResult?: { data: unknown; error: { message: string } | null };
}
```

Find the opening of `makeSupabaseMock`:

```ts
function makeSupabaseMock(opts: MockOptions = {}) {
  const roomResult = opts.roomResult ?? { data: roomRow, error: null };
  const membershipsResult =
    opts.membershipsResult ?? { data: membershipRows, error: null };

  const roomSelectCalls: Array<{ table: string; eq?: { col: string; val: unknown } }> = [];
  const membershipSelectCalls: Array<{ table: string; eq?: { col: string; val: unknown }; select: string }> = [];
```

Replace with:

```ts
function makeSupabaseMock(opts: MockOptions = {}) {
  const roomResult = opts.roomResult ?? { data: roomRow, error: null };
  const membershipsResult =
    opts.membershipsResult ?? { data: membershipRows, error: null };
  const votesResult = opts.votesResult ?? { data: [], error: null };

  const roomSelectCalls: Array<{ table: string; eq?: { col: string; val: unknown } }> = [];
  const membershipSelectCalls: Array<{ table: string; eq?: { col: string; val: unknown }; select: string }> = [];
  const votesSelectCalls: Array<{
    table: string;
    eq1: { col: string; val: unknown };
    eq2: { col: string; val: unknown };
  }> = [];
```

Find the `return { supabase: ..., roomSelectCalls, membershipSelectCalls };` at the end of `makeSupabaseMock`. Replace with:

```ts
  return {
    supabase: { from } as unknown as GetRoomDeps["supabase"],
    roomSelectCalls,
    membershipSelectCalls,
    votesSelectCalls,
  };
```

- [ ] **Step 1.3: Write failing tests**

At the bottom of `src/lib/rooms/get.test.ts` (after the last existing `describe` block but before the file ends), append:

```ts
// ─── votes rehydration ──────────────────────────────────────────────────────

const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("getRoom — votes rehydration", () => {
  it("omits the votes query and returns votes: [] when userId is not provided", async () => {
    const mock = makeSupabaseMock();
    const result = await getRoom({ roomId: VALID_ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.votes).toEqual([]);
    expect(mock.votesSelectCalls).toEqual([]);
  });

  it("queries votes by (room_id, user_id) when userId is provided", async () => {
    const mock = makeSupabaseMock();
    await getRoom(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(mock.votesSelectCalls).toHaveLength(1);
    expect(mock.votesSelectCalls[0]).toEqual({
      table: "votes",
      eq1: { col: "room_id", val: VALID_ROOM_ID },
      eq2: { col: "user_id", val: VALID_USER_ID },
    });
  });

  it("maps vote rows to VoteView and returns them when userId matches", async () => {
    const mock = makeSupabaseMock({
      votesResult: {
        data: [
          {
            contestant_id: "2026-ua",
            scores: { Vocals: 7, Staging: 9 },
            missed: false,
            hot_take: "iconic",
          },
          {
            contestant_id: "2026-se",
            scores: null,
            missed: true,
            hot_take: null,
          },
        ],
        error: null,
      },
    });
    const result = await getRoom(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.votes).toEqual([
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, Staging: 9 },
        missed: false,
        hotTake: "iconic",
      },
      {
        contestantId: "2026-se",
        scores: null,
        missed: true,
        hotTake: null,
      },
    ]);
  });

  it("rejects a non-UUID userId with INVALID_USER_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await getRoom(
      { roomId: VALID_ROOM_ID, userId: "not-a-uuid" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("falls back to votes: [] when the votes query errors (progressive enhancement)", async () => {
    const mock = makeSupabaseMock({
      votesResult: { data: null, error: { message: "db boom" } },
    });
    const result = await getRoom(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.votes).toEqual([]);
  });
});
```

- [ ] **Step 1.4: Run tests — confirm RED**

Run: `npx vitest run src/lib/rooms/get.test.ts`
Expected: the 5 new cases FAIL (existing cases should still pass — the harness change is additive). Failures manifest as `votes` being undefined on the result or the validation branch missing.

- [ ] **Step 1.5: Implement the votes logic**

Open `src/lib/rooms/get.ts`. Find the last block of the `getRoom` function:

```ts
  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(room.year, room.event);
  } catch (err) {
    if (err instanceof ContestDataError) {
      return fail(
        "INTERNAL_ERROR",
        "Could not load contestant data for this event.",
        500
      );
    }
    throw err;
  }

  return { ok: true, data: { room, memberships, contestants } };
}
```

Replace with:

```ts
  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(room.year, room.event);
  } catch (err) {
    if (err instanceof ContestDataError) {
      return fail(
        "INTERNAL_ERROR",
        "Could not load contestant data for this event.",
        500
      );
    }
    throw err;
  }

  let votes: VoteView[] = [];
  if (input.userId !== undefined) {
    if (typeof input.userId !== "string" || !UUID_REGEX.test(input.userId)) {
      return fail("INVALID_USER_ID", "userId must be a valid UUID.", 400, "userId");
    }
    const userId = input.userId;
    const votesQuery = await deps.supabase
      .from("votes")
      .select("contestant_id, scores, missed, hot_take")
      .eq("room_id", roomId)
      .eq("user_id", userId);

    if (!votesQuery.error && Array.isArray(votesQuery.data)) {
      votes = (votesQuery.data as Array<{
        contestant_id: string;
        scores: Record<string, number | null> | null;
        missed: boolean;
        hot_take: string | null;
      }>).map((row) => ({
        contestantId: row.contestant_id,
        scores: row.scores,
        missed: row.missed,
        hotTake: row.hot_take,
      }));
    }
    // Progressive enhancement: if the votes query errors, fall through with
    // votes: [] rather than failing the whole response. Design §2 + §8.6.
  }

  return { ok: true, data: { room, memberships, contestants, votes } };
}
```

- [ ] **Step 1.6: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/rooms/get.test.ts`
Expected: all cases pass (existing + 5 new).

- [ ] **Step 1.7: Verify type-check**

Run: `npm run type-check`
Expected: zero errors.

- [ ] **Step 1.8: Commit**

```bash
git add src/lib/rooms/get.ts src/lib/rooms/get.test.ts
git commit -m "$(cat <<'EOF'
getRoom: return caller's votes when userId is provided

Extends GetRoomInput with optional userId; when present and valid,
runs a votes query filtered by (room_id, user_id) and maps rows to
VoteView[]. Progressive-enhancement fallback — votes query errors
produce votes: [] rather than failing the whole response, so a flaky
votes table doesn't block users from entering a room.

5 new test cases cover: userId omitted → no query, userId present →
correct eq chain, happy-path mapping (including null scores for
missed-only rows), non-UUID rejection, and the progressive fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Parse `?userId=` in the route handler

**Files:**
- Modify: `src/app/api/rooms/[id]/route.ts`

Thin adapter change — no tests. Route has no existing test file; its behaviour is covered by `getRoom`'s unit tests plus manual verification.

- [ ] **Step 2.1: Parse the query param and pass it through**

Open `src/app/api/rooms/[id]/route.ts`. Find:

```ts
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await getRoom(
    { roomId: params.id },
    {
      supabase: createServiceClient(),
      fetchContestants,
    }
  );
```

Replace with:

```ts
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userIdParam = request.nextUrl.searchParams.get("userId");
  const result = await getRoom(
    {
      roomId: params.id,
      ...(userIdParam !== null ? { userId: userIdParam } : {}),
    },
    {
      supabase: createServiceClient(),
      fetchContestants,
    }
  );
```

Note: `_request` (leading underscore) becomes `request` so ESLint doesn't complain about an unused parameter.

- [ ] **Step 2.2: Verify type-check + tests**

Run: `npm run type-check`
Expected: zero errors.

Run: `npm test -- --run`
Expected: all tests pass.

- [ ] **Step 2.3: Commit**

```bash
git add "src/app/api/rooms/[id]/route.ts"
git commit -m "$(cat <<'EOF'
GET /api/rooms/[id]: parse optional ?userId= and pass to getRoom

Thin adapter change — URL search param flows into GetRoomInput.userId.
Missing/empty param falls through as undefined (not empty-string) so
getRoom's validation only fires on an explicit userId value.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `seedScoresFromVotes` helper + tests (TDD)

**Files:**
- Create: `src/lib/voting/seedScoresFromVotes.ts`
- Create: `src/lib/voting/seedScoresFromVotes.test.ts`

Pure helper; the transformation logic is the only branching in the whole client rehydration path.

- [ ] **Step 3.1: Create the stub**

Create `src/lib/voting/seedScoresFromVotes.ts`:

```ts
import type { VoteView } from "@/lib/rooms/get";

/**
 * Transform the server's VoteView[] into VotingView's sparse
 * Record<contestantId, Record<categoryName, number | null>> shape.
 *
 * Filters out stale contestant ids and category names defensively.
 * Skips rows with `scores: null` (missed-only rows have no scores to seed).
 *
 * See docs/superpowers/specs/2026-04-24-vote-rehydration-design.md §5.2.
 */
export function seedScoresFromVotes(
  _votes: readonly VoteView[],
  _categoryNames: readonly string[],
  _contestantIds: readonly string[]
): Record<string, Record<string, number | null>> {
  throw new Error("not implemented");
}
```

- [ ] **Step 3.2: Write failing tests**

Create `src/lib/voting/seedScoresFromVotes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { seedScoresFromVotes } from "@/lib/voting/seedScoresFromVotes";
import type { VoteView } from "@/lib/rooms/get";

const CATEGORY_NAMES = ["Vocals", "Staging", "Outfit"] as const;
const CONTESTANT_IDS = ["2026-ua", "2026-se", "2026-gb"] as const;

describe("seedScoresFromVotes", () => {
  it("returns {} for an empty votes array", () => {
    expect(seedScoresFromVotes([], CATEGORY_NAMES, CONTESTANT_IDS)).toEqual({});
  });

  it("happy path: maps one vote's scores into the keyed shape", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, Staging: 9 },
        missed: false,
        hotTake: null,
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: 7, Staging: 9 },
    });
  });

  it("drops keys that are not in the provided category list", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, BogusStale: 3, Staging: 9 },
        missed: false,
        hotTake: null,
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: 7, Staging: 9 },
    });
  });

  it("drops votes whose contestantId is not in the provided list", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-xx",
        scores: { Vocals: 7 },
        missed: false,
        hotTake: null,
      },
      {
        contestantId: "2026-ua",
        scores: { Vocals: 5 },
        missed: false,
        hotTake: null,
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: 5 },
    });
  });

  it("skips votes with scores: null (missed-only rows)", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: null,
        missed: true,
        hotTake: null,
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({});
  });

  it("omits contestants whose scores were entirely filtered out", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { OnlyStaleKey: 7 },
        missed: false,
        hotTake: null,
      },
    ];
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({});
  });

  it("preserves null score values when the category name is valid", () => {
    const votes: VoteView[] = [
      {
        contestantId: "2026-ua",
        scores: { Vocals: null, Staging: 6 },
        missed: false,
        hotTake: null,
      },
    ];
    // null is a valid cleared score; keep it so the UI renders "unset".
    expect(
      seedScoresFromVotes(votes, CATEGORY_NAMES, CONTESTANT_IDS)
    ).toEqual({
      "2026-ua": { Vocals: null, Staging: 6 },
    });
  });
});
```

- [ ] **Step 3.3: Run tests — confirm RED**

Run: `npx vitest run src/lib/voting/seedScoresFromVotes.test.ts`
Expected: FAIL — all 7 throw `"not implemented"`.

- [ ] **Step 3.4: Implement**

Replace the body of `src/lib/voting/seedScoresFromVotes.ts`:

```ts
import type { VoteView } from "@/lib/rooms/get";

/**
 * Transform the server's VoteView[] into VotingView's sparse
 * Record<contestantId, Record<categoryName, number | null>> shape.
 *
 * Filters out stale contestant ids and category names defensively.
 * Skips rows with `scores: null` (missed-only rows have no scores to seed).
 *
 * See docs/superpowers/specs/2026-04-24-vote-rehydration-design.md §5.2.
 */
export function seedScoresFromVotes(
  votes: readonly VoteView[],
  categoryNames: readonly string[],
  contestantIds: readonly string[]
): Record<string, Record<string, number | null>> {
  const validCats = new Set(categoryNames);
  const validContestants = new Set(contestantIds);
  const out: Record<string, Record<string, number | null>> = {};
  for (const v of votes) {
    if (!validContestants.has(v.contestantId)) continue;
    if (!v.scores) continue;
    const filtered: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(v.scores)) {
      if (validCats.has(key)) {
        filtered[key] = value;
      }
    }
    if (Object.keys(filtered).length > 0) {
      out[v.contestantId] = filtered;
    }
  }
  return out;
}
```

- [ ] **Step 3.5: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/voting/seedScoresFromVotes.test.ts`
Expected: PASS — 7/7.

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/voting/seedScoresFromVotes.ts src/lib/voting/seedScoresFromVotes.test.ts
git commit -m "$(cat <<'EOF'
voting: seedScoresFromVotes helper + tests

Pure transformer from server-side VoteView[] into VotingView's sparse
Record<contestantId, Record<categoryName, number | null>> shape.
Defensive filters drop stale contestant ids and category names, skip
missed-only rows, and omit contestants whose scores were entirely
filtered out.

7 unit tests cover: empty array, happy path, stale category drop,
stale contestant drop, null-scores skip, all-filtered omission, null
value preservation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Widen `fetchRoomData` signature

**Files:**
- Modify: `src/lib/room/api.ts`

- [ ] **Step 4.1: Update the type + function**

Open `src/lib/room/api.ts`. Find:

```ts
export type FetchRoomData = {
  room: unknown;
  memberships: unknown[];
  contestants: unknown[];
};

export async function fetchRoomData(
  roomId: string,
  deps: Deps
): Promise<ApiOk<FetchRoomData> | ApiFail> {
  return runRequest<FetchRoomData>(
    () => deps.fetch(`/api/rooms/${roomId}`),
    (body) => body as FetchRoomData
  );
}
```

Replace with:

```ts
export type FetchRoomData = {
  room: unknown;
  memberships: unknown[];
  contestants: unknown[];
  votes: unknown[];
};

export async function fetchRoomData(
  roomId: string,
  userId: string | null,
  deps: Deps
): Promise<ApiOk<FetchRoomData> | ApiFail> {
  const url = userId
    ? `/api/rooms/${roomId}?userId=${encodeURIComponent(userId)}`
    : `/api/rooms/${roomId}`;
  return runRequest<FetchRoomData>(
    () => deps.fetch(url),
    (body) => body as FetchRoomData
  );
}
```

- [ ] **Step 4.2: Verify type-check**

Run: `npm run type-check`
Expected: errors at the two existing `fetchRoomData` call sites in `src/app/room/[id]/page.tsx` (missing second arg). Those are fixed in Task 6. This step confirms the signature change propagated; do NOT fix the call sites yet.

- [ ] **Step 4.3: Commit (intentionally broken tree — followed by Task 5 + 6)**

This commit leaves the build broken for downstream call sites. That's acceptable within a feature branch where the next commit closes the loop. Alternative approach — batch Tasks 4+5+6 into one commit — is rejected because the three changes are logically distinct and each earns its own commit.

**Skip this step.** Instead, leave Task 4's file change uncommitted and proceed to Task 5 + Task 6. They'll all commit together at the end of Task 6 when the build is green. Return here and confirm by running `git status` before Task 5 — `src/lib/room/api.ts` should show as modified but not staged.

- [ ] **Step 4.4: Verify uncommitted state**

Run: `git status --short`
Expected: `src/lib/room/api.ts` shown with ` M` (modified, unstaged).

---

## Task 5: Add `initialScores` prop to `VotingView`

**Files:**
- Modify: `src/components/voting/VotingView.tsx`

- [ ] **Step 5.1: Add the prop**

Open `src/components/voting/VotingView.tsx`. Find:

```tsx
export interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
  onScoreChange?: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  saveStatus?: SaveStatus;
}
```

Replace with:

```tsx
export interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
  onScoreChange?: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  saveStatus?: SaveStatus;
  initialScores?: Record<string, Record<string, number | null>>;
}
```

Find the component signature + destructure:

```tsx
export default function VotingView({
  contestants,
  categories,
  onScoreChange,
  saveStatus,
}: VotingViewProps) {
```

Replace with:

```tsx
export default function VotingView({
  contestants,
  categories,
  onScoreChange,
  saveStatus,
  initialScores,
}: VotingViewProps) {
```

Find the `useState` for `scoresByContestant`:

```tsx
  const [scoresByContestant, setScoresByContestant] = useState<
    Record<string, Record<string, number | null>>
  >({});
```

Replace with:

```tsx
  const [scoresByContestant, setScoresByContestant] = useState<
    Record<string, Record<string, number | null>>
  >(() => initialScores ?? {});
```

The lazy initializer form (`() => ...`) avoids recomputing the default object on every render.

- [ ] **Step 5.2: Verify type-check**

Run: `npm run type-check`
Expected: still errors at the `fetchRoomData` call sites in `page.tsx` from Task 4 (unchanged). No new errors from this task.

---

## Task 6: Wire into `page.tsx` + unified commit of Tasks 4 + 5 + 6

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

- [ ] **Step 6.1: Add imports + widen `Phase.ready`**

Open `src/app/room/[id]/page.tsx`. Find:

```ts
import VotingView from "@/components/voting/VotingView";
import type { Contestant } from "@/types";
import { useVoteAutosave } from "@/components/voting/useVoteAutosave";
import { postVote } from "@/lib/voting/postVote";
```

Replace with:

```ts
import VotingView from "@/components/voting/VotingView";
import type { Contestant } from "@/types";
import { useVoteAutosave } from "@/components/voting/useVoteAutosave";
import { postVote } from "@/lib/voting/postVote";
import type { VoteView } from "@/lib/rooms/get";
import { seedScoresFromVotes } from "@/lib/voting/seedScoresFromVotes";
```

Find `Phase`:

```ts
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      room: RoomShape;
      memberships: MembershipShape[];
      contestants: Contestant[];
    };
```

Replace with:

```ts
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      room: RoomShape;
      memberships: MembershipShape[];
      contestants: Contestant[];
      votes: VoteView[];
    };
```

- [ ] **Step 6.2: Thread `userId` into `fetchRoomData` calls and pass `votes` into both `setPhase` sites**

Find the first `fetchRoomData` call:

```ts
    const fetchResult = await fetchRoomData(roomId, {
      fetch: window.fetch.bind(window),
    });
```

Replace with:

```ts
    const fetchResult = await fetchRoomData(roomId, session.userId, {
      fetch: window.fetch.bind(window),
    });
```

Find the second `fetchRoomData` call (inside the post-join branch):

```ts
      const refetch = await fetchRoomData(roomId, {
        fetch: window.fetch.bind(window),
      });
```

Replace with:

```ts
      const refetch = await fetchRoomData(roomId, session.userId, {
        fetch: window.fetch.bind(window),
      });
```

Find the first `setPhase` ready call:

```ts
    setPhase({
      kind: "ready",
      room,
      memberships: ensureSelfInMemberships(memberships, session),
      contestants: (data.contestants ?? []) as Contestant[],
    });
```

Replace with:

```ts
    setPhase({
      kind: "ready",
      room,
      memberships: ensureSelfInMemberships(memberships, session),
      contestants: (data.contestants ?? []) as Contestant[],
      votes: (data.votes ?? []) as VoteView[],
    });
```

Find the second `setPhase` ready call (in the post-join branch):

```ts
      setPhase({
        kind: "ready",
        room: refetched.room as RoomShape,
        memberships: ensureSelfInMemberships(memberships, session),
        contestants: (refetched.contestants ?? []) as Contestant[],
      });
```

Replace with:

```ts
      setPhase({
        kind: "ready",
        room: refetched.room as RoomShape,
        memberships: ensureSelfInMemberships(memberships, session),
        contestants: (refetched.contestants ?? []) as Contestant[],
        votes: (refetched.votes ?? []) as VoteView[],
      });
```

- [ ] **Step 6.3: Compute + pass `initialScores` in the voting branch**

Find the voting branch:

```tsx
  if (phase.room.status === "voting") {
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        onScoreChange={autosave.onScoreChange}
        saveStatus={autosave.status}
      />
    );
  }
```

Replace with:

```tsx
  if (phase.room.status === "voting") {
    const initialScores = seedScoresFromVotes(
      phase.votes,
      (phase.room.categories ?? []).map((c) => c.name),
      phase.contestants.map((c) => c.id)
    );
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        onScoreChange={autosave.onScoreChange}
        saveStatus={autosave.status}
        initialScores={initialScores}
      />
    );
  }
```

- [ ] **Step 6.4: Verify type-check + full test suite + lint**

Run: `npm run type-check`
Expected: zero errors. All call sites now line up with the new `fetchRoomData` signature and the widened `Phase.ready`.

Run: `npm test -- --run`
Expected: all tests pass. Baseline prior to this PR = 543 passing + 4 todo (that number will differ slightly depending on baseline; what matters is no regressions). After this PR: **555 passing + 4 todo** (+12: 5 `get.test.ts` + 7 `seedScoresFromVotes.test.ts`).

Run: `npm run lint`
Expected: only the pre-existing `src/hooks/useRoomRealtime.ts:30` warning.

- [ ] **Step 6.5: Commit Tasks 4 + 5 + 6 together**

Everything that was broken by Task 4 is fixed by Tasks 5 + 6. Commit them as one unit so the tree is never broken on the branch.

```bash
git add src/lib/room/api.ts src/components/voting/VotingView.tsx "src/app/room/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
vote rehydration: wire fetchRoomData + VotingView.initialScores + page

Three-file wire-up committed together so the tree is never broken
mid-chain:
- fetchRoomData gains userId parameter; appends ?userId= when given
- VotingView accepts optional initialScores, threaded through useState
  lazy initializer (one-shot seed — local edits remain authoritative)
- page.tsx threads session.userId into both fetchRoomData call sites,
  widens Phase.ready with votes: VoteView[], and computes initialScores
  from the new helper before rendering VotingView

Scores now survive a page reload. Missed + hot-take rehydration are
tracked for future slices once those UIs exist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification + push + PR

- [ ] **Step 7.1: Full suite + type-check + lint**

Run: `npm test -- --run`
Expected: all tests green. Count = baseline + 12.

Run: `npm run type-check`
Expected: zero errors.

Run: `npm run lint`
Expected: only the pre-existing `useRoomRealtime.ts:30` warning.

- [ ] **Step 7.2: Manual verification**

1. `npm run dev`
2. Create a room + join on a second browser tab
3. As admin: Start voting
4. Score a few categories across 2+ contestants — `✓ Saved` chip appears
5. Reload the tab — scores are restored (fill-bar segments gold as before the reload)
6. Navigate to a different contestant that had scores — those also restored
7. Score something new post-reload — autosave still works; chip goes `Saving…` → `✓ Saved`
8. Open DevTools → Network → refresh: confirm `/api/rooms/{id}?userId=<uuid>` is the request URL (query param, not header)

- [ ] **Step 7.3: Branch state check**

Run: `git log --oneline main..HEAD`
Expected: 5 entries:

```
<sha> vote rehydration: wire fetchRoomData + VotingView.initialScores + page
<sha> voting: seedScoresFromVotes helper + tests
<sha> GET /api/rooms/[id]: parse optional ?userId= and pass to getRoom
<sha> getRoom: return caller's votes when userId is provided
<sha> docs: design for vote rehydration
```

- [ ] **Step 7.4: Push + open PR**

```bash
git push -u origin feat/vote-rehydration
gh pr create --title "Phase 3: vote rehydration (scores survive reload)" --body "<body>"
```

Body highlights (fill in during the PR creation):
- Extends `GET /api/rooms/{id}` with optional `?userId=`
- Server returns array of `{ contestantId, scores, missed, hotTake }` per row
- Client `seedScoresFromVotes` transforms to `VotingView`'s keyed shape with defensive filtering
- Scores now survive reloads; missed + hot-take returned server-side but ignored client-side until those UIs land
- Manual smoke checklist

---

## Self-review

**Spec coverage (design doc §1–§9):**
- §3 API surface → Task 1 (getRoom signature + behaviour) + Task 2 (route query-param parse).
- §4 server-side lib → Task 1 (all code blocks in §4.1 and §4.2 of the design).
- §5.1 fetchRoomData → Task 4.
- §5.2 seedScoresFromVotes → Task 3.
- §5.3 VotingView.initialScores → Task 5.
- §5.4 page wire-up → Task 6.
- §6 test coverage → Task 1 (5 get.test.ts cases) + Task 3 (7 seedScoresFromVotes cases).
- §7 files touched → matches the file-structure table at the top.
- §8 non-obvious decisions — embedded in code + commit messages.
- §9 follow-ups — tracked, not implemented.

**Placeholder scan:** no TBDs / hand-wavy steps; every code block is complete.

**Type consistency across tasks:**
- `VoteView` shape `{ contestantId, scores, missed, hotTake }` consistent in Tasks 1, 3, 6.
- `GetRoomInput.userId?: unknown` → validated-then-narrowed-to-string in Task 1; `fetchRoomData`'s `userId: string | null` in Task 4 matches the page's `session.userId` (non-null after the existing session guard) in Task 6.
- `FetchRoomData.votes: unknown[]` (Task 4) cast to `VoteView[]` at the page boundary (Task 6).
- `initialScores?: Record<string, Record<string, number | null>>` shape identical in Tasks 5 and 6 (component prop and `seedScoresFromVotes` return type).
- `Phase.ready.votes: VoteView[]` (Task 6) matches the two `setPhase` call sites.
