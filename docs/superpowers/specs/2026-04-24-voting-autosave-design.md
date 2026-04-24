# Design: voting autosave — PR 1 of 3 (debounce + POST + 2-state chip)

**Date:** 2026-04-24
**Phase:** 3 / follow-on to PR #18 (voting screen skeleton)
**Depends on:** `POST /api/rooms/{id}/votes` (PR #15, merged), `VotingView` (PR #18, merged), `ScoreRow` fill-bar (PR #21, merged)
**SPEC refs:** §8.5 (autosave + 3-state chip), §8.5.1 (conflict reconciliation — PR 3), §8.5.2 (offline vs status transitions — PR 2), §8.5.3 (200-entry cap — PR 2)

---

## 1. Goal

Stop scores from being ephemeral. Wire `VotingView`'s score updates through a debounced POST to `/api/rooms/{id}/votes` and render a persistent save chip (`Saving…` / `Saved`) inside the voting card header.

First user-visible step toward a working voting flow — after this lands, a reload no longer loses local state.

## 2. Scope

### In scope (PR 1)
- `src/lib/voting/postVote.ts` — typed wrapper around `/api/rooms/{id}/votes` (matches the existing `patchRoomStatus` / `joinRoomApi` shapes in `src/lib/room/api.ts`).
- `src/lib/voting/postVote.test.ts` — fetch-mocked unit tests.
- `src/lib/voting/Autosaver.ts` — pure class with the debounce/coalesce/status logic.
- `src/lib/voting/Autosaver.test.ts` — fake-timer tests of the class in isolation.
- `src/components/voting/useVoteAutosave.ts` — thin React hook that wraps an `Autosaver` instance + exposes `{ onScoreChange, status }`.
- `src/components/voting/SaveChip.tsx` — leaf component that renders one of {hidden, `Saving…`, `✓ Saved`, `Save failed`}.
- `src/components/voting/VotingView.tsx` — modify: add two optional props (`onScoreChange`, `saveStatus`) and render `SaveChip` in the header.
- `src/app/room/[id]/page.tsx` — modify: instantiate `useVoteAutosave`, thread props into `VotingView`.

### Out of scope (tracked for PR 2 / PR 3)
- `localStorage.emx_offline_queue` — PR 2.
- "Offline — changes queued" chip state + banner — PR 2.
- Conflict reconciliation (server-wins) + consolidated toast — PR 3 (§8.5.1).
- 200-entry queue cap — PR 2 (§8.5.3).
- Status-transition abort path (`voting_ending` or other terminal states while user is offline) — PR 2 (§8.5.2).
- Missed-flag / hot-take autosave — separate slice (they write to the same endpoint but the UI for them lives elsewhere).
- Explicit retry button — PR 2 (offline queue handles this implicitly).

## 3. State ownership

`VotingView` keeps its `scoresByContestant` local state (unchanged from PR #18). The only addition is an **optional** side-effect callback:

```ts
onScoreChange?: (
  contestantId: string,
  categoryName: string,
  next: number | null
) => void;
```

VotingView calls `onScoreChange` *after* its local state update — same call site as `updateScore`. If the prop isn't provided, the callback is a no-op (matches today's ephemeral behaviour, useful for isolation tests).

This keeps `VotingView` pure-render: it doesn't know about fetch, auth, or the save chip's lifecycle. The hook owns the side effect; the component owns the pixels.

### Why not lift state to the page?

Considered and rejected. The page would need to manage contestant-scoped score maps purely so the hook can read them — but the hook doesn't need historic scores, only the deltas. Lifting state adds complexity with no consumer benefit. If PR 2 needs full state (e.g. for restoring scores from `localStorage` on reload), we lift then — not now.

## 4. `Autosaver` — the pure class

A class, not a reducer, because it owns timers (external resources) and needs a `dispose()` method for clean unmount. Dependencies injected for testability.

```ts
export interface AutosaverDeps {
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
  now?: () => number;              // default: Date.now
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  debounceMs?: number;              // default 500
  onStatusChange: (status: SaveStatus) => void;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface PostVoteInput {
  roomId: string;
  userId: string;
  contestantId: string;
  scores?: Record<string, number | null>;
  missed?: boolean;
  hotTake?: string | null;
}
```

### Internal state

```ts
interface PendingEntry {
  timerId: ReturnType<typeof setTimeout>;
  scores: Record<string, number | null>;  // coalesced deltas
}

// Keyed by contestantId
const pending: Map<string, PendingEntry> = new Map();

// Count of in-flight POSTs (started fire-and-forget on timer fire)
let inflight = 0;

// True once `schedule()` has been called at least once
let hasWritten = false;

// The most recent completion outcome. Drives the `error` vs `saved` choice.
let lastOutcome: "success" | "error" | null = null;
```

### Public API

```ts
class Autosaver {
  constructor(private roomId: string, private userId: string, private deps: AutosaverDeps);

  schedule(contestantId: string, categoryName: string, value: number | null): void {
    this.hasWritten = true;
    const entry = this.pending.get(contestantId);
    const nextScores = { ...(entry?.scores ?? {}), [categoryName]: value };
    if (entry) this.deps.clearTimeout!(entry.timerId);
    const timerId = this.deps.setTimeout!(() => this.flushContestant(contestantId), this.deps.debounceMs ?? 500);
    this.pending.set(contestantId, { timerId, scores: nextScores });
    this.recomputeStatus();
  }

  dispose(): void {
    for (const entry of this.pending.values()) this.deps.clearTimeout!(entry.timerId);
    this.pending.clear();
    // In-flight requests are allowed to complete; their responses no-op if the
    // instance is disposed (guarded by an `isDisposed` flag).
    this.isDisposed = true;
  }

  private async flushContestant(contestantId: string): Promise<void> {
    const entry = this.pending.get(contestantId);
    if (!entry) return;
    this.pending.delete(contestantId);
    this.inflight += 1;
    this.recomputeStatus();
    try {
      const result = await this.deps.post({
        roomId: this.roomId,
        userId: this.userId,
        contestantId,
        scores: entry.scores,
      });
      this.inflight -= 1;
      if (this.isDisposed) return;
      this.lastOutcome = result.ok ? "success" : "error";
      this.recomputeStatus();
    } catch {
      this.inflight -= 1;
      if (this.isDisposed) return;
      this.lastOutcome = "error";
      this.recomputeStatus();
    }
  }

  private recomputeStatus(): void {
    const status = this.deriveStatus();
    this.deps.onStatusChange(status);
  }

  private deriveStatus(): SaveStatus {
    if (!this.hasWritten) return "idle";
    if (this.pending.size > 0 || this.inflight > 0) return "saving";
    if (this.lastOutcome === "error") return "error";
    return "saved";
  }
}
```

### Coalesce semantics

- **Key = contestantId.** All category changes for the same contestant within 500 ms coalesce into one POST with `scores: { cat1: v1, cat2: v2, ... }`.
- **Independent timers per contestant.** Switching contestants doesn't cancel the old timer; it fires on its own schedule.
- **Last-write-wins on same category.** `schedule("c1", "Vocals", 3)` then `schedule("c1", "Vocals", 5)` within 500 ms produces one POST with `{ Vocals: 5 }`.
- **Fire-and-forget inflight.** If a new change schedules before the previous POST resolves, both POSTs run in parallel. The endpoint is partial-merge (server-side), so disjoint keys resolve fine; same-key races are prevented by the 500 ms coalesce window (if you tap fast enough to beat a 500 ms window plus network round-trip, that's a real same-key race — PR 3's conflict detection covers it).

### Status derivation

```
!hasWritten                                   → idle
pending.size > 0 || inflight > 0              → saving
lastOutcome === "error"                       → error
otherwise                                     → saved
```

One `onStatusChange` call per state transition; hook de-dupes via identity if the derived value hasn't changed.

## 5. `useVoteAutosave` hook

```ts
export function useVoteAutosave(params: {
  roomId: string;
  userId: string | null;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
}): {
  onScoreChange: (contestantId: string, categoryName: string, next: number | null) => void;
  status: SaveStatus;
};
```

Implementation shape:

```ts
const [status, setStatus] = useState<SaveStatus>("idle");
const saverRef = useRef<Autosaver | null>(null);

useEffect(() => {
  if (!params.userId) return;
  const saver = new Autosaver(params.roomId, params.userId, {
    post: params.post,
    onStatusChange: setStatus,
  });
  saverRef.current = saver;
  return () => {
    saver.dispose();
    saverRef.current = null;
  };
}, [params.roomId, params.userId, params.post]);

const onScoreChange = useCallback(
  (contestantId: string, categoryName: string, next: number | null) => {
    saverRef.current?.schedule(contestantId, categoryName, next);
  },
  []
);

return { onScoreChange, status };
```

If `userId` is null (shouldn't happen in practice — page already guards), the hook returns a no-op `onScoreChange` and permanent `idle` status. Defensive but cheap.

## 6. `SaveChip` component

Leaf. Renders one of four visual states:

```tsx
interface SaveChipProps {
  status: SaveStatus;
}

export default function SaveChip({ status }: SaveChipProps) {
  if (status === "idle") return null;
  const className = "text-xs font-medium";
  if (status === "saving") return <span className={`${className} text-muted-foreground`} aria-live="polite">Saving…</span>;
  if (status === "saved") return <span className={`${className} text-primary`} aria-live="polite">✓ Saved</span>;
  return <span className={`${className} text-destructive`} aria-live="polite" role="alert">Save failed</span>;
}
```

`aria-live="polite"` on all three visible states so assistive tech announces transitions without interrupting the current thought. `role="alert"` on the error state escalates it.

## 7. `VotingView` changes

Two optional props, one render addition. No behaviour change if the props are omitted.

```ts
interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
  onScoreChange?: (contestantId: string, categoryName: string, next: number | null) => void;  // NEW
  saveStatus?: SaveStatus;                                                                     // NEW
}
```

In `updateScore`, after the state update, call the optional callback:

```ts
const updateScore = useCallback(
  (contestantId: string, categoryName: string, next: number | null) => {
    setScoresByContestant((prev) => ({
      ...prev,
      [contestantId]: {
        ...(prev[contestantId] ?? {}),
        [categoryName]: next,
      },
    }));
    onScoreChange?.(contestantId, categoryName, next);  // NEW
  },
  [onScoreChange]
);
```

SaveChip renders in the header, left of the running-order cluster (SPEC §8.5 "Save indicator in the header corner"):

```tsx
<div className="flex flex-col items-end gap-1 flex-shrink-0">
  {saveStatus !== undefined && <SaveChip status={saveStatus} />}
  <span className="text-sm font-mono text-muted-foreground tabular-nums">
    {contestant.runningOrder}/{totalContestants}
  </span>
  ...
</div>
```

Placement note: above the running-order label puts it in the user's peripheral attention while they're scoring; doesn't compete with the song title on the other side.

## 8. Page wiring

`src/app/room/[id]/page.tsx` — the voting branch gains the hook call:

```tsx
if (phase.room.status === "voting") {
  const session = getSession();
  const userId = session?.userId ?? null;
  const autosave = useVoteAutosave({
    roomId: phase.room.id,
    userId,
    post: (payload) => postVote(payload, { fetch: window.fetch.bind(window) }),
  });
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

**Rule-of-hooks note:** the existing page structure is `phase.kind === "loading" → return early ... → phase.kind === "ready"` branching. Calling `useVoteAutosave` inside the conditional "voting" branch would violate rules-of-hooks (hooks must be called in the same order on every render). Fix: hoist the hook call above the conditional branches. The hook returns no-op when `userId` is null *or* when there's no voting phase to save against, so calling it unconditionally is safe.

Concretely: move the hook call before the `if (phase.kind === "loading")` guard. Parameterize it with best-available `userId` and `roomId`; when scores aren't being edited (lobby, error state), `onScoreChange` is simply never called and `status` stays `idle`.

## 9. `postVote` client

```ts
// src/lib/voting/postVote.ts
import type { ApiOk, ApiFail, Deps } from "@/lib/room/api";  // reuse existing shapes

export interface PostVoteInput {
  roomId: string;
  userId: string;
  contestantId: string;
  scores?: Record<string, number | null>;
  missed?: boolean;
  hotTake?: string | null;
}

export type PostVoteResult = ApiOk<{ vote: unknown; scoredCount: number }> | ApiFail;

export async function postVote(
  input: PostVoteInput,
  deps: Deps
): Promise<PostVoteResult> { ... }
```

Follows the exact pattern of `patchRoomStatus` in `src/lib/room/api.ts`. `ApiOk` / `ApiFail` / `Deps` / `runRequest` / `unwrap` — all reused (export them from `src/lib/room/api.ts` if not already exported).

## 10. Testing

### `postVote.test.ts`
1. Happy path: mocked `fetch` returns 200 `{ vote, scoredCount }` → `ok: true`, data shape passes through.
2. Body shape: POST URL is `/api/rooms/{roomId}/votes`, method `POST`, JSON content-type, body JSON-stringifies the input minus `roomId`.
3. 400 `{ error: { code, message, field } }` → `ok: false`, code/field/message propagated.
4. 409 `ROOM_NOT_VOTING` → `ok: false`, code propagates.
5. Network failure (fetch throws) → `ok: false, code: "NETWORK"`.

### `Autosaver.test.ts`
`vi.useFakeTimers()` + inject `{ post: vi.fn(), onStatusChange: vi.fn() }`.

1. Fresh instance → initial status NOT emitted (status is derived lazily; first emission comes from first `schedule`).
2. `schedule("c1", "Vocals", 7)` → status `saving` emitted; no post yet; after `vi.advanceTimersByTime(500)`, post called with `{ roomId, userId, contestantId: "c1", scores: { Vocals: 7 } }`.
3. Two schedules within the debounce window for the same contestant coalesce: `schedule("c1", "Vocals", 7)`, `schedule("c1", "Staging", 9)` → after 500 ms, one post call with `scores: { Vocals: 7, Staging: 9 }`.
4. Two schedules for the same category within the window → last value wins (single post with the latest).
5. Two contestants in the same window → two independent posts after timers fire.
6. Successful post → status transitions `saving → saved`.
7. Failed post (post resolves with `{ ok: false, ... }`) → status transitions `saving → error`.
8. Post throws → status transitions `saving → error`.
9. New `schedule` while a previous post is inflight → status stays `saving`; after the inflight completes with success AND the new post completes with success → ends at `saved`.
10. `dispose()` cancels pending timers and discards post results from disposed instances (no `onStatusChange` calls after dispose).

### Skipped
- `useVoteAutosave` — trivial ref wrapper; tested implicitly by manual browser verification.
- `SaveChip` — four lines of conditional JSX; a pure helper for "status to string" would be over-engineering.
- `VotingView` — new props are optional; existing tests don't regress. Props contract is covered by TypeScript.
- `page.tsx` — no unit tests exist for page.tsx; type-check covers the wire-up.

### Manual verification
Full browser walkthrough in `npm run dev`:
1. Create room + join; admin starts voting.
2. Tap a score → chip shows `Saving…` for ~500 ms → flips to `✓ Saved`.
3. Tap multiple categories quickly → one POST fires after the debounce (network tab).
4. Reload the tab → scores persist (the endpoint stored them; on reload, the voting view is empty until fetch rehydrates — note: fetch rehydration of existing votes is not this PR; it's implicit via `GET /api/rooms/{id}` if it returns votes, or a follow-up).
5. Kill the dev-server backend / disconnect network → tap score → chip shows `Save failed`.
6. Re-enable network → tap another score → chip returns to `✓ Saved`.

**Rehydration caveat:** the voting screen currently starts with an empty local state even if the user has prior votes on the server. Score persistence works (server has the data), but it's not yet user-visible on a fresh page load. Fixing this is a small follow-up: extend `GET /api/rooms/{id}` (or add a dedicated endpoint) to return the caller's existing votes, and seed `scoresByContestant` on mount. **Out of scope for PR 1** — tracked as follow-up. The PR still achieves the headline value: scores stop being lost; they survive a backend restart; they're shareable in future results computations.

## 11. Non-obvious decisions (flagged)

1. **Per-contestant coalesce, not per-category.** Matches endpoint's partial-merge design; minimizes request count; makes same-contestant multi-category scoring one network round-trip.
2. **Fire-and-forget inflight.** Simpler than cancel-stale. Server handles disjoint-key merges; same-key races are rare enough to accept and will be caught by PR 3's conflict detection.
3. **VotingView state stays local.** Callback is a side-effect; component stays pure-render.
4. **`error` state is a PR 1 placeholder.** SPEC §8.5 names 3 states; the spec's 3rd state (`Offline — changes queued`) requires the offline queue machinery in PR 2. `error` is honest failure UX for PR 1 and morphs into `offline` when PR 2 lands.
5. **Rehydration deferred.** On page reload, the screen comes up empty; scores are in the DB but not shown. Tracked as a small follow-up. PR 1 delivers the "stop losing scores" half of the goal; rehydration delivers the "show me what I already scored" half.
6. **Hook hoisted above conditional branches.** Rules-of-hooks: hooks run in the same order every render. The hook accepts `userId: string | null` and is a no-op when null, which makes unconditional call safe.
7. **Autosaver is a class, not a reducer.** Owns external resources (timers, inflight promises). A reducer would need a side-effect driver anyway; class with injected deps is cleaner.

## 12. Follow-ups spawned

- **PR 2**: offline queue + `Offline — changes queued` chip state + banner. Replaces PR 1's `error` state.
- **PR 3**: conflict reconciliation + consolidated toast + 200-entry cap.
- **Vote rehydration**: on room load, seed VotingView's initial `scoresByContestant` from the server (via the existing `GET /api/rooms/{id}` or a new endpoint).
- **Missed-flag autosave**: extends the same `onScoreChange` pattern with `onMissedChange` when the "I missed this" UI lands.
- **Hot-take autosave**: same pattern plus 500 ms debounce + max length enforcement.
