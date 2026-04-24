# Voting Autosave — PR 1 of 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `VotingView` score changes to `POST /api/rooms/{id}/votes` with 500 ms debounce + coalesce, and render a persistent 2-state (or fallback-error) save chip in the voting card header.

**Architecture:** `postVote` client → injected into pure `Autosaver` class (owns timers + per-contestant coalesce) → wrapped by `useVoteAutosave` hook → page owns the hook → passes `onScoreChange` + `saveStatus` to `VotingView`. DI of the `post` function throughout so PR 2 (offline queue) and PR 3 (conflict detection) can slot in by swapping deps.

**Tech Stack:** Next.js 14 App Router, React 18 (client hooks), TypeScript strict, Vitest (node env — fake timers for Autosaver; mocked `fetch` for postVote).

Design: [docs/superpowers/specs/2026-04-24-voting-autosave-design.md](../specs/2026-04-24-voting-autosave-design.md) — read it first.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/room/api.ts` | modify | Export `ApiOk`, `ApiFail`, `Deps`, `runRequest` so `postVote` can reuse them (currently file-local) |
| `src/lib/voting/postVote.ts` | **new** | Typed client for `POST /api/rooms/{id}/votes`, identical shape to `patchRoomStatus` |
| `src/lib/voting/postVote.test.ts` | **new** | Fetch-mocked unit tests (5 cases) |
| `src/lib/voting/Autosaver.ts` | **new** | Pure class: per-contestant debounce + coalesce + status derivation |
| `src/lib/voting/Autosaver.test.ts` | **new** | Fake-timer unit tests (10 cases) |
| `src/components/voting/SaveChip.tsx` | **new** | Leaf component rendering `idle`/`saving`/`saved`/`error` |
| `src/components/voting/useVoteAutosave.ts` | **new** | Thin React hook wrapping `Autosaver` + exposing `{ onScoreChange, status }` |
| `src/components/voting/VotingView.tsx` | modify | Add two optional props, call `onScoreChange` in `updateScore`, render `SaveChip` in header |
| `src/app/room/[id]/page.tsx` | modify | Hoist `useVoteAutosave` call above conditional branches; thread props into `VotingView` |

**Not touched:** `ScoreRow.tsx`, `nextScore.ts`, `scoredCount.ts`, `globals.css`, any API routes (server-side unchanged).

---

## Task 1: Export shared API helpers from `src/lib/room/api.ts`

**Files:**
- Modify: `src/lib/room/api.ts`

`ApiOk`, `ApiFail`, `Deps`, `runRequest`, `unwrap` are currently file-local. `postVote` needs to reuse them so both clients stay consistent. Minor visibility change; no behaviour change.

- [ ] **Step 1.1: Export the shared types + `runRequest`**

Open `src/lib/room/api.ts`. Replace the top of the file (lines 1–58) so the four items below are exported. Keep `unwrap` private — it's an implementation detail.

Find:
```ts
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

interface ApiOk<T> {
  ok: true;
  data?: T;
}

interface ApiFail {
  ok: false;
  code: string;
  field?: string;
  message: string;
}

interface Deps {
  fetch: typeof globalThis.fetch;
}
```

Replace with:
```ts
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export interface ApiOk<T> {
  ok: true;
  data?: T;
}

export interface ApiFail {
  ok: false;
  code: string;
  field?: string;
  message: string;
}

export interface Deps {
  fetch: typeof globalThis.fetch;
}
```

Then find:
```ts
async function runRequest<T>(
```

Replace with:
```ts
export async function runRequest<T>(
```

- [ ] **Step 1.2: Verify type-check + tests**

Run: `npm run type-check`
Expected: zero errors. The three interfaces and `runRequest` remain structurally identical — only visibility changed.

Run: `npm test -- --run`
Expected: all tests still green.

- [ ] **Step 1.3: Commit**

```bash
git add src/lib/room/api.ts
git commit -m "$(cat <<'EOF'
api: export ApiOk/ApiFail/Deps/runRequest from room/api.ts

Shared shapes for subsequent client files (postVote next). Visibility-
only change; no behaviour difference. unwrap stays private as an
internal helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `postVote` client + tests (TDD)

**Files:**
- Create: `src/lib/voting/postVote.ts`
- Create: `src/lib/voting/postVote.test.ts`

- [ ] **Step 2.1: Create the stub**

Create `src/lib/voting/postVote.ts`:

```ts
import { runRequest, type ApiOk, type ApiFail, type Deps } from "@/lib/room/api";

export interface PostVoteInput {
  roomId: string;
  userId: string;
  contestantId: string;
  scores?: Record<string, number | null>;
  missed?: boolean;
  hotTake?: string | null;
}

export interface PostVoteResponseData {
  vote: unknown;
  scoredCount: number;
}

export type PostVoteResult = ApiOk<PostVoteResponseData> | ApiFail;

/**
 * POST /api/rooms/{roomId}/votes — upsert the caller's vote for one
 * contestant. Accepts partial `scores`, `missed`, `hotTake`. Server merges
 * with the existing row. See SPEC §8 + PR #15.
 */
export async function postVote(
  input: PostVoteInput,
  _deps: Deps
): Promise<PostVoteResult> {
  throw new Error("not implemented");
}
```

- [ ] **Step 2.2: Write failing tests**

Create `src/lib/voting/postVote.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { postVote } from "@/lib/voting/postVote";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CONTESTANT_ID = "2026-ua";

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("postVote", () => {
  it("POSTs to /api/rooms/{roomId}/votes with the right body shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        vote: { id: "v1", roomId: ROOM_ID, contestantId: CONTESTANT_ID },
        scoredCount: 1,
      })
    );

    await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
        scores: { Vocals: 7 },
      },
      { fetch: fetchMock }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/rooms/${ROOM_ID}/votes`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      userId: USER_ID,
      contestantId: CONTESTANT_ID,
      scores: { Vocals: 7 },
    });
  });

  it("returns ok: true with { vote, scoredCount } on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        vote: { id: "v1" },
        scoredCount: 2,
      })
    );

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
        scores: { Vocals: 7, Staging: 9 },
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.scoredCount).toBe(2);
    expect(result.data?.vote).toEqual({ id: "v1" });
  });

  it("returns ok: false with code + message on 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(400, {
        error: {
          code: "INVALID_BODY",
          message: "scores must be an object",
          field: "scores",
        },
      })
    );

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_BODY");
    expect(result.field).toBe("scores");
    expect(result.message).toBe("scores must be an object");
  });

  it("returns ok: false with ROOM_NOT_VOTING on 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(409, {
        error: {
          code: "ROOM_NOT_VOTING",
          message: "Room is not accepting votes",
        },
      })
    );

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ROOM_NOT_VOTING");
  });

  it("returns ok: false with code 'NETWORK' when fetch throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NETWORK");
  });

  it("omits scores/missed/hotTake from the body when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({ vote: {}, scoredCount: 0 })
    );

    await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    const body = JSON.parse(
      fetchMock.mock.calls[0][1]?.body as string
    );
    expect(body).toEqual({
      userId: USER_ID,
      contestantId: CONTESTANT_ID,
    });
    expect("scores" in body).toBe(false);
    expect("missed" in body).toBe(false);
    expect("hotTake" in body).toBe(false);
  });
});
```

- [ ] **Step 2.3: Run tests — confirm RED**

Run: `npx vitest run src/lib/voting/postVote.test.ts`
Expected: FAIL — all 6 throw `"not implemented"`.

- [ ] **Step 2.4: Implement `postVote`**

Replace the body of `src/lib/voting/postVote.ts`:

```ts
import { runRequest, type ApiOk, type ApiFail, type Deps } from "@/lib/room/api";

export interface PostVoteInput {
  roomId: string;
  userId: string;
  contestantId: string;
  scores?: Record<string, number | null>;
  missed?: boolean;
  hotTake?: string | null;
}

export interface PostVoteResponseData {
  vote: unknown;
  scoredCount: number;
}

export type PostVoteResult = ApiOk<PostVoteResponseData> | ApiFail;

/**
 * POST /api/rooms/{roomId}/votes — upsert the caller's vote for one
 * contestant. Accepts partial `scores`, `missed`, `hotTake`. Server merges
 * with the existing row. See SPEC §8 + PR #15.
 */
export async function postVote(
  input: PostVoteInput,
  deps: Deps
): Promise<PostVoteResult> {
  const body: Record<string, unknown> = {
    userId: input.userId,
    contestantId: input.contestantId,
  };
  if (input.scores !== undefined) body.scores = input.scores;
  if (input.missed !== undefined) body.missed = input.missed;
  if (input.hotTake !== undefined) body.hotTake = input.hotTake;

  return runRequest<PostVoteResponseData>(
    () =>
      deps.fetch(`/api/rooms/${input.roomId}/votes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    (raw) => raw as PostVoteResponseData
  );
}
```

- [ ] **Step 2.5: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/voting/postVote.test.ts`
Expected: PASS — 6/6.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/voting/postVote.ts src/lib/voting/postVote.test.ts
git commit -m "$(cat <<'EOF'
voting: postVote client + tests

Typed wrapper around POST /api/rooms/{id}/votes following the same
shape as patchRoomStatus. Reuses ApiOk/ApiFail/Deps/runRequest exported
from src/lib/room/api.ts. Omits undefined fields from the request body
so the server's partial-merge semantics behave as expected (not sending
scores: undefined as scores: null).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `Autosaver` class + tests (TDD)

**Files:**
- Create: `src/lib/voting/Autosaver.ts`
- Create: `src/lib/voting/Autosaver.test.ts`

Pure class; no React; no DOM. All external dependencies (timers, post fn, status callback) injected. Tested with `vi.useFakeTimers()`.

- [ ] **Step 3.1: Create the stub**

Create `src/lib/voting/Autosaver.ts`:

```ts
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaverDeps {
  /** Fires each time the derived status changes. */
  onStatusChange: (status: SaveStatus) => void;
  /** The network write. Fire-and-forget from the saver's perspective. */
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
  /** Milliseconds to wait after the last schedule before firing. Default 500. */
  debounceMs?: number;
  /** Overridable for tests. Default globalThis.setTimeout. */
  setTimeout?: typeof globalThis.setTimeout;
  /** Overridable for tests. Default globalThis.clearTimeout. */
  clearTimeout?: typeof globalThis.clearTimeout;
}

/**
 * Per-contestant debounced autosave coordinator.
 *
 * - Coalesces category deltas for the same contestant within the debounce
 *   window into one POST carrying { scores: { cat1: v1, cat2: v2 } }.
 * - Fire-and-forget inflight: if a new schedule beats a still-pending POST,
 *   they run in parallel. Same-key reorder is prevented by the client-side
 *   debounce window.
 * - Status derivation:
 *     !hasWritten                       → "idle"
 *     pending.size > 0 || inflight > 0  → "saving"
 *     lastOutcome === "error"           → "error"
 *     otherwise                         → "saved"
 *
 * See docs/superpowers/specs/2026-04-24-voting-autosave-design.md §4.
 */
export class Autosaver {
  constructor(
    _roomId: string,
    _userId: string,
    _deps: AutosaverDeps
  ) {
    throw new Error("not implemented");
  }

  schedule(
    _contestantId: string,
    _categoryName: string,
    _value: number | null
  ): void {
    throw new Error("not implemented");
  }

  dispose(): void {
    throw new Error("not implemented");
  }
}
```

- [ ] **Step 3.2: Write failing tests**

Create `src/lib/voting/Autosaver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function makeSuccess(): PostVoteResult {
  return { ok: true, data: { vote: {}, scoredCount: 1 } };
}

function makeFailure(): PostVoteResult {
  return {
    ok: false,
    code: "NETWORK",
    message: "Something went wrong. Please try again.",
  };
}

function makeSaver(
  postImpl: (payload: PostVoteInput) => Promise<PostVoteResult>
): { saver: Autosaver; statuses: SaveStatus[]; post: ReturnType<typeof vi.fn> } {
  const statuses: SaveStatus[] = [];
  const post = vi.fn(postImpl);
  const saver = new Autosaver(ROOM_ID, USER_ID, {
    post,
    onStatusChange: (s) => statuses.push(s),
  });
  return { saver, statuses, post };
}

describe("Autosaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not post before the debounce window elapses", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(499);
    expect(post).not.toHaveBeenCalled();
  });

  it("posts exactly once after 500ms with a single schedule", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      scores: { Vocals: 7 },
    });
  });

  it("coalesces multiple category schedules for the same contestant into one post", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.schedule("c1", "Vocals", 7);
    saver.schedule("c1", "Staging", 9);
    saver.schedule("c1", "Outfit", 4);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      scores: { Vocals: 7, Staging: 9, Outfit: 4 },
    });
  });

  it("last-write-wins when the same category is scheduled twice in the window", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.schedule("c1", "Vocals", 3);
    saver.schedule("c1", "Vocals", 5);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ scores: { Vocals: 5 } })
    );
  });

  it("schedules for different contestants produce independent posts", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.schedule("c1", "Vocals", 7);
    saver.schedule("c2", "Vocals", 4);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(2);
    const calls = post.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(
      expect.objectContaining({ contestantId: "c1", scores: { Vocals: 7 } })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ contestantId: "c2", scores: { Vocals: 4 } })
    );
  });

  it("transitions status saving → saved on success", async () => {
    const { saver, statuses } = makeSaver(async () => makeSuccess());
    saver.schedule("c1", "Vocals", 7);
    expect(statuses).toContain("saving");
    await vi.advanceTimersByTimeAsync(500);
    // Post promise resolves on the same microtask queue after fake-timer flush.
    await vi.runAllTimersAsync();
    expect(statuses[statuses.length - 1]).toBe("saved");
  });

  it("transitions status saving → error when post returns ok:false", async () => {
    const { saver, statuses } = makeSaver(async () => makeFailure());
    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(statuses[statuses.length - 1]).toBe("error");
  });

  it("transitions status saving → error when post throws", async () => {
    const { saver, statuses } = makeSaver(async () => {
      throw new Error("boom");
    });
    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(statuses[statuses.length - 1]).toBe("error");
  });

  it("returns to saved on the next successful write after an error", async () => {
    let calls = 0;
    const { saver, statuses } = makeSaver(async () => {
      calls += 1;
      return calls === 1 ? makeFailure() : makeSuccess();
    });
    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(statuses[statuses.length - 1]).toBe("error");

    saver.schedule("c1", "Vocals", 8);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(statuses[statuses.length - 1]).toBe("saved");
  });

  it("dispose cancels pending timers and suppresses status updates from later resolutions", async () => {
    let resolvePost: ((r: PostVoteResult) => void) | null = null;
    const pending = new Promise<PostVoteResult>((r) => {
      resolvePost = r;
    });
    const { saver, statuses } = makeSaver(async () => pending);

    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(500);
    // Post is in-flight.
    const countBeforeDispose = statuses.length;
    saver.dispose();
    // Resolve the inflight after dispose.
    resolvePost!(makeSuccess());
    await vi.runAllTimersAsync();
    expect(statuses.length).toBe(countBeforeDispose);

    // A further schedule after dispose must be a no-op (no new status emissions
    // or posts).
    saver.schedule("c1", "Vocals", 9);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(statuses.length).toBe(countBeforeDispose);
  });
});
```

- [ ] **Step 3.3: Run tests — confirm RED**

Run: `npx vitest run src/lib/voting/Autosaver.test.ts`
Expected: FAIL — all 10 throw `"not implemented"` in the constructor.

- [ ] **Step 3.4: Implement `Autosaver`**

Replace the contents of `src/lib/voting/Autosaver.ts`:

```ts
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaverDeps {
  onStatusChange: (status: SaveStatus) => void;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
  debounceMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

interface PendingEntry {
  timerId: ReturnType<typeof globalThis.setTimeout>;
  scores: Record<string, number | null>;
}

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Per-contestant debounced autosave coordinator.
 * See docs/superpowers/specs/2026-04-24-voting-autosave-design.md §4.
 */
export class Autosaver {
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;
  private readonly debounceMs: number;
  private readonly pending: Map<string, PendingEntry> = new Map();
  private inflight = 0;
  private hasWritten = false;
  private lastOutcome: "success" | "error" | null = null;
  private disposed = false;
  private lastStatusEmitted: SaveStatus = "idle";

  constructor(
    private readonly roomId: string,
    private readonly userId: string,
    private readonly deps: AutosaverDeps
  ) {
    this.setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout;
    this.clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout;
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  schedule(contestantId: string, categoryName: string, value: number | null): void {
    if (this.disposed) return;
    this.hasWritten = true;
    const existing = this.pending.get(contestantId);
    const nextScores = { ...(existing?.scores ?? {}), [categoryName]: value };
    if (existing) this.clearTimeoutFn(existing.timerId);
    const timerId = this.setTimeoutFn(
      () => this.flushContestant(contestantId),
      this.debounceMs
    );
    this.pending.set(contestantId, { timerId, scores: nextScores });
    this.emitStatus();
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) {
      this.clearTimeoutFn(entry.timerId);
    }
    this.pending.clear();
  }

  private async flushContestant(contestantId: string): Promise<void> {
    if (this.disposed) return;
    const entry = this.pending.get(contestantId);
    if (!entry) return;
    this.pending.delete(contestantId);
    this.inflight += 1;
    this.emitStatus();
    try {
      const result = await this.deps.post({
        roomId: this.roomId,
        userId: this.userId,
        contestantId,
        scores: entry.scores,
      });
      this.inflight -= 1;
      if (this.disposed) return;
      this.lastOutcome = result.ok ? "success" : "error";
    } catch {
      this.inflight -= 1;
      if (this.disposed) return;
      this.lastOutcome = "error";
    }
    this.emitStatus();
  }

  private deriveStatus(): SaveStatus {
    if (!this.hasWritten) return "idle";
    if (this.pending.size > 0 || this.inflight > 0) return "saving";
    if (this.lastOutcome === "error") return "error";
    return "saved";
  }

  private emitStatus(): void {
    if (this.disposed) return;
    const next = this.deriveStatus();
    if (next === this.lastStatusEmitted) return;
    this.lastStatusEmitted = next;
    this.deps.onStatusChange(next);
  }
}
```

- [ ] **Step 3.5: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/voting/Autosaver.test.ts`
Expected: PASS — 10/10.

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/voting/Autosaver.ts src/lib/voting/Autosaver.test.ts
git commit -m "$(cat <<'EOF'
voting: Autosaver class + tests

Pure per-contestant debounced save coordinator. Coalesces category
deltas for the same contestant into one POST; fires independently per
contestant; derives status from hasWritten/pending/inflight/lastOutcome;
de-dupes status emissions. All external deps (timers, post fn, status
callback) injected so the class is testable with vi.useFakeTimers and
mocked post.

10 unit tests cover: debounce window, single schedule, coalesce,
last-write-wins, per-contestant independence, success→saved,
ok:false→error, throw→error, recovery, dispose cancels + suppresses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `useVoteAutosave` hook + `SaveChip` component

**Files:**
- Create: `src/components/voting/useVoteAutosave.ts`
- Create: `src/components/voting/SaveChip.tsx`

No new tests — both files are React glue with zero branching logic beyond the conditional JSX in `SaveChip` (which would be over-engineered to extract). Logic coverage comes from `Autosaver.test.ts`.

- [ ] **Step 4.1: Create the hook**

Create `src/components/voting/useVoteAutosave.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";

export interface UseVoteAutosaveParams {
  roomId: string;
  userId: string | null;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
}

export interface UseVoteAutosaveResult {
  onScoreChange: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  status: SaveStatus;
}

/**
 * Hook that owns an Autosaver instance keyed by (roomId, userId).
 * See docs/superpowers/specs/2026-04-24-voting-autosave-design.md §5.
 */
export function useVoteAutosave(
  params: UseVoteAutosaveParams
): UseVoteAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!params.userId) {
      saverRef.current = null;
      setStatus("idle");
      return;
    }
    const saver = new Autosaver(params.roomId, params.userId, {
      post: params.post,
      onStatusChange: setStatus,
    });
    saverRef.current = saver;
    return () => {
      saver.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [params.roomId, params.userId, params.post]);

  const onScoreChange = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      saverRef.current?.schedule(contestantId, categoryName, next);
    },
    []
  );

  return { onScoreChange, status };
}
```

- [ ] **Step 4.2: Create the chip**

Create `src/components/voting/SaveChip.tsx`:

```tsx
import type { SaveStatus } from "@/lib/voting/Autosaver";

export interface SaveChipProps {
  status: SaveStatus;
}

/**
 * Persistent save indicator per SPEC §8.5. Renders nothing in `idle`.
 * The `error` state is a PR-1 placeholder that becomes `offline` once
 * PR 2 lands (offline queue + localStorage).
 */
export default function SaveChip({ status }: SaveChipProps) {
  if (status === "idle") return null;
  const base = "text-xs font-medium";
  if (status === "saving") {
    return (
      <span className={`${base} text-muted-foreground`} aria-live="polite">
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className={`${base} text-primary`} aria-live="polite">
        ✓ Saved
      </span>
    );
  }
  return (
    <span
      className={`${base} text-destructive`}
      aria-live="polite"
      role="alert"
    >
      Save failed
    </span>
  );
}
```

- [ ] **Step 4.3: Verify type-check**

Run: `npm run type-check`
Expected: zero errors.

- [ ] **Step 4.4: Verify tests still green**

Run: `npm test -- --run`
Expected: all tests pass (no new tests; just guarding against regressions).

- [ ] **Step 4.5: Commit**

```bash
git add src/components/voting/useVoteAutosave.ts src/components/voting/SaveChip.tsx
git commit -m "$(cat <<'EOF'
voting: useVoteAutosave hook + SaveChip component

Hook is a thin ref wrapper around Autosaver; creates one instance per
(roomId, userId) tuple; disposes on unmount or when userId becomes
null. No-ops cleanly when userId is null.

SaveChip renders nothing in idle; Saving… / ✓ Saved / Save failed
otherwise. aria-live="polite" on every visible state; role="alert"
escalates the error. The error state is a PR-1 placeholder; PR 2
swaps it for the SPEC §8.5 "Offline — changes queued" text and adds
a separate banner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire into `VotingView`

**Files:**
- Modify: `src/components/voting/VotingView.tsx`

- [ ] **Step 5.1: Add the import + new props**

Open `src/components/voting/VotingView.tsx`. Find:

```tsx
import Button from "@/components/ui/Button";
import ScoreRow from "@/components/voting/ScoreRow";
import { scoredCount } from "@/components/voting/scoredCount";
```

Replace with:

```tsx
import Button from "@/components/ui/Button";
import ScoreRow from "@/components/voting/ScoreRow";
import { scoredCount } from "@/components/voting/scoredCount";
import SaveChip from "@/components/voting/SaveChip";
import type { SaveStatus } from "@/lib/voting/Autosaver";
```

Find the props interface:

```tsx
export interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
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
}
```

Find the component signature + destructure:

```tsx
export default function VotingView({
  contestants,
  categories,
}: VotingViewProps) {
```

Replace with:

```tsx
export default function VotingView({
  contestants,
  categories,
  onScoreChange,
  saveStatus,
}: VotingViewProps) {
```

- [ ] **Step 5.2: Invoke the callback inside `updateScore`**

Find:

```tsx
  const updateScore = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      setScoresByContestant((prev) => ({
        ...prev,
        [contestantId]: {
          ...(prev[contestantId] ?? {}),
          [categoryName]: next,
        },
      }));
    },
    []
  );
```

Replace with:

```tsx
  const updateScore = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      setScoresByContestant((prev) => ({
        ...prev,
        [contestantId]: {
          ...(prev[contestantId] ?? {}),
          [categoryName]: next,
        },
      }));
      onScoreChange?.(contestantId, categoryName, next);
    },
    [onScoreChange]
  );
```

- [ ] **Step 5.3: Render `SaveChip` in the header**

Find the right-hand side of the header:

```tsx
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-sm font-mono text-muted-foreground tabular-nums">
              {contestant.runningOrder}/{totalContestants}
            </span>
```

Replace with:

```tsx
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {saveStatus !== undefined && <SaveChip status={saveStatus} />}
            <span className="text-sm font-mono text-muted-foreground tabular-nums">
              {contestant.runningOrder}/{totalContestants}
            </span>
```

- [ ] **Step 5.4: Verify type-check + tests**

Run: `npm run type-check`
Expected: zero errors.

Run: `npm test -- --run`
Expected: all tests still green (no new tests; the two optional props don't affect existing behaviour).

- [ ] **Step 5.5: Commit**

```bash
git add src/components/voting/VotingView.tsx
git commit -m "$(cat <<'EOF'
VotingView: optional onScoreChange + saveStatus props

Two additive props, zero behaviour change when omitted. When provided,
updateScore fires onScoreChange after the local state update; SaveChip
renders at the top of the running-order cluster. Existing tests and
the component's standalone-render usage remain compatible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire into `src/app/room/[id]/page.tsx`

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

The hook must be hoisted above all conditional branches to satisfy rules-of-hooks.

- [ ] **Step 6.1: Add imports**

Open `src/app/room/[id]/page.tsx`. Find:

```tsx
import VotingView from "@/components/voting/VotingView";
import type { Contestant } from "@/types";
```

Replace with:

```tsx
import VotingView from "@/components/voting/VotingView";
import type { Contestant } from "@/types";
import { useVoteAutosave } from "@/components/voting/useVoteAutosave";
import { postVote } from "@/lib/voting/postVote";
```

- [ ] **Step 6.2: Hoist the autosave hook above conditional returns**

Find the block that currently starts the render flow (after `handleCopyLink`, before the `phase.kind === "loading"` guard). Specifically, find:

```tsx
  if (phase.kind === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p className="text-muted-foreground animate-shimmer">Loading room…</p>
      </main>
    );
  }
```

Insert the hook call **immediately before** this block:

```tsx
  const autosave = useVoteAutosave({
    roomId,
    userId: getSession()?.userId ?? null,
    post: useCallback(
      (payload) => postVote(payload, { fetch: window.fetch.bind(window) }),
      []
    ),
  });

  if (phase.kind === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p className="text-muted-foreground animate-shimmer">Loading room…</p>
      </main>
    );
  }
```

**Rules-of-hooks note:** `getSession()` is a plain function call — reading localStorage — so its return value may change across renders but that's fine; `useVoteAutosave`'s internal `useEffect` is keyed on `userId` and will rebuild the `Autosaver` if the session id changes.

**Memoization note:** the `post` closure is wrapped in `useCallback` so the hook's internal `useEffect([params.post])` doesn't re-create the `Autosaver` on every render. Without this wrap, a fresh closure on each render would thrash the effect.

- [ ] **Step 6.3: Thread props into `VotingView`**

Find the voting branch:

```tsx
  if (phase.room.status === "voting") {
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
      />
    );
  }
```

Replace with:

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

- [ ] **Step 6.4: Verify type-check, tests, lint**

Run: `npm run type-check`
Expected: zero errors.

Run: `npm test -- --run`
Expected: all tests green (baseline from main = 516 + 4 todo; this PR adds 16 = **532 passing + 4 todo**).

Run: `npm run lint`
Expected: only the pre-existing `src/hooks/useRoomRealtime.ts:30` warning.

- [ ] **Step 6.5: Commit**

```bash
git add "src/app/room/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
room/[id]: wire useVoteAutosave + pass props to VotingView

Hook is hoisted above conditional returns to satisfy rules-of-hooks.
post closure is memoized with useCallback so Autosaver isn't rebuilt
on every render. userId drawn from getSession() so the hook rebuilds
if the session changes.

Scores entered in the voting screen now round-trip to the server via
the existing POST /api/rooms/{id}/votes endpoint, 500ms debounced and
coalesced per contestant. Chip in the voting header shows Saving… /
✓ Saved / Save failed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification

**Files:** None modified.

- [ ] **Step 7.1: Full suite**

Run: `npm test -- --run`
Expected: 532 passing + 4 todo (baseline 516 + 6 postVote + 10 Autosaver).

Run: `npm run type-check`
Expected: zero errors.

Run: `npm run lint`
Expected: only the pre-existing `useRoomRealtime.ts:30` warning.

- [ ] **Step 7.2: Manual smoke**

1. `npm run dev`
2. Create a room; join from a second browser tab with a different session
3. As admin, click "Start voting" — both tabs swap to VotingView; chip is **hidden** (status=idle)
4. Tap one score in the second tab — chip flashes `Saving…` for ~500 ms, then settles on `✓ Saved`
5. Tap multiple categories quickly — DevTools → Network: one POST fires with the coalesced `scores` payload
6. Kill the backend (Ctrl-C the Supabase dev server or toggle DevTools "Offline") — tap score — chip flips to `Save failed`
7. Re-enable — tap another score — chip returns to `✓ Saved`
8. Reload the tab — voting view comes up empty (rehydration is a follow-up noted in the design). Score the contestant again; POST succeeds; partial-merge on the server means prior scores are retained in the DB row

- [ ] **Step 7.3: Verify branch state**

Run: `git log --oneline main..HEAD`
Expected: eight entries:

```
<sha> room/[id]: wire useVoteAutosave + pass props to VotingView
<sha> VotingView: optional onScoreChange + saveStatus props
<sha> voting: useVoteAutosave hook + SaveChip component
<sha> voting: Autosaver class + tests
<sha> voting: postVote client + tests
<sha> api: export ApiOk/ApiFail/Deps/runRequest from room/api.ts
<sha> docs: plan for voting autosave (PR 1 of 3)
<sha> docs: design for voting autosave (PR 1 of 3)
```

- [ ] **Step 7.4: Push + open PR**

```bash
git push -u origin feat/voting-autosave
gh pr create --title "Phase 3: voting autosave — debounce + POST + 2-state chip (1 of 3)" --body "<body>"
```

---

## Self-review

**Spec coverage (design doc §1–§12):**
- §3 state ownership → Task 5 (optional callback prop, VotingView stays pure-render).
- §4 Autosaver internals → Task 3 (class implements exactly the pseudo-code from the design).
- §5 hook → Task 4 (ref wrapper + keyed effect + useCallback).
- §6 SaveChip → Task 4 (four visual states, aria-live/role).
- §7 VotingView changes → Task 5 (two props added, callback called in updateScore, SaveChip rendered in header).
- §8 page wiring → Task 6 (hoisted hook call, memoized post, props threaded).
- §9 postVote client → Task 2 (reuses ApiOk/ApiFail/Deps/runRequest exported in Task 1).
- §10 testing → Tasks 2 (6 postVote cases) + 3 (10 Autosaver cases); skipped suites documented inline.
- §11 non-obvious decisions → embedded in the relevant tasks (per-contestant coalesce in Task 3, fire-and-forget inflight in Task 3, VotingView stays local in Task 5, error-as-placeholder noted in Task 4 commit message, hook hoisting in Task 6).
- §12 follow-ups → out of scope, not implemented.

**Placeholder scan:** no TBDs / hand-wavy steps; every code block is complete and self-contained.

**Type consistency across tasks:**
- `SaveStatus = "idle" | "saving" | "saved" | "error"` used identically in Tasks 3, 4, 5, 6.
- `PostVoteInput` shape (roomId/userId/contestantId/scores/missed/hotTake) consistent between Tasks 2 and 3.
- `AutosaverDeps.post` signature matches `postVote`'s signature from Task 2.
- `VotingViewProps.onScoreChange` signature matches `UseVoteAutosaveResult.onScoreChange` signature (Tasks 4 and 5).
- Hook parameter type `UseVoteAutosaveParams.userId: string | null` matches Task 6's `getSession()?.userId ?? null`.
