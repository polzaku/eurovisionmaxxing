# Design: vote rehydration

**Date:** 2026-04-24
**Phase:** 3 / follow-up to voting autosave (PR #22)
**Depends on:** `POST /api/rooms/{id}/votes` (PR #15), `VotingView` (PR #18), voting autosave (PR #22) — all merged
**SPEC refs:** §8 (voting), §8.5 (autosave implicitly creates the data we're reading back)

---

## 1. Goal

On `/room/[id]` load, seed `VotingView`'s local `scoresByContestant` from the server so scores survive a page reload. Closes the UX gap opened by the autosave trio: autosave persists correctly, but the voting screen came up empty on every reload.

## 2. Scope

### In scope
- Extend `GET /api/rooms/{id}` to accept an optional `?userId=<uuid>` query param and include the caller's vote rows in the response.
- Widen `getRoom` (lib) to query + return `votes: VoteView[]` when `userId` is provided.
- Widen `fetchRoomData` (client) to pass `userId` and parse `votes` out of the response.
- New pure helper `seedScoresFromVotes(votes, categoryNames, contestantIds)` that returns the sparse `Record<contestantId, Record<categoryName, number | null>>` shape `VotingView` already uses, filtering out stale keys defensively.
- Add `initialScores?` prop to `VotingView` — one-shot seed via `useState` initializer.
- Thread `votes` + the seeded `initialScores` through the page.

### Out of scope (tracked)
- **Missed toggle UI rehydration** — no missed UI exists yet. Server response returns `missed` for future slices; client ignores it for now.
- **Hot-take rehydration** — same reasoning.
- **Rejoin-token auth on the GET endpoint** — the existing codebase pattern is `userId`-in-body/query without rejoin-token verification; the defence-in-depth hardening is tracked as a cross-cutting follow-up for every write *and* read endpoint.
- **Realtime refetch → reseed of votes during voting** — user's own local edits stay authoritative (see §5.3). Refetches triggered by status changes cause remounts, which re-seed naturally.
- **Offline rehydration fallback** — if the initial fetch fails, the page shows its existing error state. Reading from `localStorage.emx_offline_queue` (pending in PR 2 of the autosave trio) would be merging two concerns; keep rehydration pure-server for this slice.

## 3. API surface

```
GET /api/rooms/{roomId}
GET /api/rooms/{roomId}?userId=<uuid>
```

**Response (unchanged for callers not passing `userId`):**

```jsonc
{
  "room":         { ... },
  "memberships":  [ ... ],
  "contestants":  [ ... ],
  "votes":        []         // empty array when userId omitted
}
```

**Response when `userId` matches a member of the room with votes:**

```jsonc
{
  "room":         { ... },
  "memberships":  [ ... ],
  "contestants":  [ ... ],
  "votes": [
    {
      "contestantId": "2026-ua",
      "scores":       { "Vocals": 7, "Staging": 9 },
      "missed":       false,
      "hotTake":      null
    },
    ...
  ]
}
```

**Notes:**
- `votes` is always present in the response shape (empty array when no `userId` or no rows) — callers can rely on it being defined.
- `scores` can be `null` if the row has `missed=true` with no fill values (matches DB reality).
- `missed` and `hotTake` are returned for forward compatibility; the client ignores them this PR.

### Auth

- `userId` query param is validated as a UUID. Malformed → `400 INVALID_USER_ID`.
- `userId` is **not** cross-checked against the room's memberships. If the caller claims a `userId` that isn't a member, the query simply returns no matching votes (empty array). This matches the existing-code trust model — we don't leak data (membership enforcement is handled by the fact that no votes exist for a non-member), and no write endpoints verify rejoin tokens either.
- Rejoin-token verification as defence-in-depth is the known cross-cutting follow-up. Not in this slice.

## 4. Server-side lib changes

### `src/lib/rooms/get.ts`

```ts
export interface GetRoomInput {
  roomId: unknown;
  userId?: unknown;   // NEW — optional UUID
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
  votes: VoteView[];   // NEW — always present, may be empty
}
```

### Logic

1. Existing validation for `roomId` unchanged.
2. If `input.userId` is provided:
   - Validate it's a UUID. Malformed → `fail("INVALID_USER_ID", ..., 400, "userId")`.
   - After the existing room + membership + contestants queries succeed, run one more query:
     ```ts
     const votesQuery = await deps.supabase
       .from("votes")
       .select("contestant_id, scores, missed, hot_take")
       .eq("room_id", roomId)
       .eq("user_id", userId);
     ```
   - Map rows to `VoteView`: `{ contestantId: row.contestant_id, scores: row.scores, missed: row.missed, hotTake: row.hot_take }`.
   - On `votesQuery.error`: fall back to `votes: []` rather than failing the whole response. Rationale: rehydration is a progressive enhancement; if the votes table is unavailable but the room+memberships+contestants succeeded, render the room and let the user re-score rather than blocking them out.
3. If `input.userId` is absent: `votes: []`.

## 5. Client-side changes

### 5.1 `fetchRoomData` — `src/lib/room/api.ts`

```ts
export async function fetchRoomData(
  roomId: string,
  userId: string | null,   // NEW — second positional arg
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

export type FetchRoomData = {
  room: unknown;
  memberships: unknown[];
  contestants: unknown[];
  votes: unknown[];   // NEW — always present
};
```

Signature widen is a breaking change for the one caller (`page.tsx`); tests on `fetchRoomData` don't exist currently (grep confirms), so no test fallout beyond the modified call site.

### 5.2 `seedScoresFromVotes` — new pure helper

```ts
// src/lib/voting/seedScoresFromVotes.ts

import type { VoteView } from "@/lib/rooms/get";

export function seedScoresFromVotes(
  votes: readonly VoteView[],
  categoryNames: readonly string[],
  contestantIds: readonly string[]
): Record<string, Record<string, number | null>> {
  const validCats = new Set(categoryNames);
  const validContestants = new Set(contestantIds);
  const out: Record<string, Record<string, number | null>> = {};
  for (const v of votes) {
    if (!validContestants.has(v.contestantId)) continue;   // stale contestant
    if (!v.scores) continue;                                // missed-only row
    const filtered: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(v.scores)) {
      if (validCats.has(key)) filtered[key] = value;        // drop stale category name
    }
    if (Object.keys(filtered).length > 0) {
      out[v.contestantId] = filtered;
    }
  }
  return out;
}
```

Defensive filters per §2's out-of-scope note on category/contestant drift: SPEC says they don't change mid-voting, but a 2-line filter is cheap insurance against future regressions.

### 5.3 `VotingView` — `initialScores` prop

```ts
interface VotingViewProps {
  ...existing
  initialScores?: Record<string, Record<string, number | null>>;
}

const [scoresByContestant, setScoresByContestant] = useState(
  () => initialScores ?? {}
);
```

`useState`'s lazy initializer runs **once** at mount. Why not `useEffect` to re-sync on prop changes?

- If the page refetches the room (e.g. status change triggers `loadRoom`), the user might be mid-scoring. An effect-driven reseed would clobber in-flight local edits with a stale-at-read-time server response.
- The user's local edits are already in transit via autosave. Server is downstream of the client during the session.
- Remounts (e.g. when leaving and re-entering voting) naturally re-seed because the `useState` initializer re-runs.

One-shot seeding is the correct behaviour.

### 5.4 `page.tsx` — wire-up

```ts
const session = getSession();
const userId = session?.userId ?? null;

const fetchResult = await fetchRoomData(roomId, userId, {
  fetch: window.fetch.bind(window),
});
// ...
const data = fetchResult.data as FetchRoomData;
setPhase({
  kind: "ready",
  room,
  memberships,
  contestants,
  votes: (data.votes ?? []) as VoteView[],
});
```

In the voting branch:

```tsx
<VotingView
  ...
  initialScores={seedScoresFromVotes(
    phase.votes,
    phase.room.categories.map((c) => c.name),
    phase.contestants.map((c) => c.id)
  )}
/>
```

`Phase.ready` gains `votes: VoteView[]`. Both `setPhase` call sites (initial load + post-join refetch) thread it through.

## 6. Tests

### 6.1 `seedScoresFromVotes.test.ts` — 6 cases (new file)

1. Empty votes array → `{}`
2. Happy path: one vote with all scores in valid categories → sparse record populated
3. Stale category name in a vote's scores → dropped; other keys kept
4. Stale contestantId (not in the provided list) → entire vote skipped
5. `scores: null` (missed-only row) → skipped
6. All keys filtered out → contestant entry not added

### 6.2 `get.test.ts` — 3 new cases

1. `userId` omitted → `votes: []` returned; no votes query run
2. `userId` present + no rows → `votes: []`
3. `userId` present + 2 rows → `votes.length === 2`, rows shaped as `VoteView`
4. `userId` malformed (non-UUID) → 400 `INVALID_USER_ID` with `field: "userId"`
5. Votes query errors → `votes: []` (progressive enhancement fallback) — room+memberships+contestants still return ok

### 6.3 `route.test.ts` (`GET /api/rooms/[id]`)

Check if the route has a test file; if yes, add one test for the `?userId=` query parse. If no, skip — route is a thin adapter covered by `getRoom` tests.

### 6.4 Skipped

- `VotingView` — `initialScores ?? {}` in a `useState` initializer; no branching beyond the nullish coalesce. Manual verification confirms.
- `fetchRoomData` — no existing tests; new signature is covered implicitly via `page.tsx`'s sole call site.
- `Autosaver.test.ts` / `postVote.test.ts` — unaffected.

## 7. Files touched

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/rooms/get.ts` | modify | Accept `input.userId`; run votes query when present; add `votes: VoteView[]` to return data |
| `src/lib/rooms/get.test.ts` | modify | Add 5 new cases (3 happy + 2 edge) |
| `src/app/api/rooms/[id]/route.ts` | modify | Parse `userId` from `request.nextUrl.searchParams`; pass into `getRoom` |
| `src/lib/room/api.ts` | modify | `fetchRoomData(roomId, userId, deps)` signature widen; `FetchRoomData.votes: unknown[]` |
| `src/lib/voting/seedScoresFromVotes.ts` | **new** | Pure helper |
| `src/lib/voting/seedScoresFromVotes.test.ts` | **new** | 6 cases |
| `src/components/voting/VotingView.tsx` | modify | Optional `initialScores?` prop; pass through `useState` initializer |
| `src/app/room/[id]/page.tsx` | modify | Thread `userId` into fetchRoomData; thread `votes` through Phase.ready; compute + pass `initialScores` |

## 8. Non-obvious decisions (flagged)

1. **Query param, not header.** `?userId=` matches the body-pattern used for existing writes. Avoids middleware/auth-context plumbing this PR doesn't need.
2. **`userId` not verified against memberships on the server.** Returning empty votes for non-members is safe (no data leak) and matches the existing trust model. Rejoin-token hardening is the separate cross-cutting ticket.
3. **`useState` initializer, not `useEffect` reseeding.** User's live edits trump stale server reads during a session. Remounts re-seed naturally.
4. **Array payload, not keyed.** REST-idiomatic; client transforms to the keyed shape via `seedScoresFromVotes`. Keeps client-shape concerns off the API.
5. **Response includes `missed` + `hotTake` even though client ignores them this PR.** Forward-compatible — future slices pick them up without an API change.
6. **Progressive-enhancement fallback on votes-query error.** If votes table is flaky, let the user score fresh rather than blocking access to the room. Logged server-side for observability (a future concern; `console.error` for now).
7. **Defensive filtering of stale category/contestant names.** Spec says they don't drift, but the filter is one line and catches any future bug.

## 9. Follow-ups spawned

- Rejoin-token auth on GET `/api/rooms/{id}` (cross-cutting).
- Include `votes: [...]` refetch logic when realtime `vote_updated` event is broadcast from *other* clients (not this PR — no such event exists yet, and per §5.3 a local-state-wins policy makes one less urgent).
- Missed / hot-take UI slices can now assume rehydration works for those fields because the API returns them.
