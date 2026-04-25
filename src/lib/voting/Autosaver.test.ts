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

  it("binds default setTimeout to globalThis (regression: browsers throw 'Illegal invocation' without this)", () => {
    vi.useRealTimers();
    const originalSetTimeout = globalThis.setTimeout;
    // Simulate the browser's strict `this` check on window.setTimeout.
    const strictSetTimeout = function (
      this: unknown,
      ...args: Parameters<typeof setTimeout>
    ) {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError("Illegal invocation");
      }
      return (originalSetTimeout as (...a: unknown[]) => unknown).apply(
        globalThis,
        args
      );
    };
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout =
      strictSetTimeout as unknown as typeof setTimeout;
    try {
      const post = vi.fn(async (): Promise<PostVoteResult> => makeSuccess());
      const saver = new Autosaver(ROOM_ID, USER_ID, {
        post,
        onStatusChange: () => {},
      });
      expect(() => saver.schedule("c1", "Vocals", 7)).not.toThrow();
      saver.dispose();
    } finally {
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout =
        originalSetTimeout;
    }
  });

  it("coalesces schedule + scheduleMissed for the same contestant into one post", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.schedule("c1", "Vocals", 7);
    saver.scheduleMissed("c1", true);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      scores: { Vocals: 7 },
      missed: true,
    });
  });

  it("coalesces scheduleMissed then schedule into one post", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.scheduleMissed("c1", true);
    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      scores: { Vocals: 7 },
      missed: true,
    });
  });

  it("two scheduleMissed calls in the window — last value wins", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.scheduleMissed("c1", true);
    saver.scheduleMissed("c1", false);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      missed: false,
    });
  });

  it("scheduleMissed flushes a missed-only payload after the debounce window", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.scheduleMissed("c1", true);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      missed: true,
    });
  });

  it("scheduleHotTake flushes a hotTake-only payload after the debounce window", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.scheduleHotTake("c1", "this slaps");
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      hotTake: "this slaps",
    });
  });

  it("scheduleHotTake transmits null faithfully (cleared hot-take)", async () => {
    const { saver, post } = makeSaver(async () => makeSuccess());
    saver.scheduleHotTake("c1", null);
    await vi.advanceTimersByTimeAsync(500);
    expect(post).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      contestantId: "c1",
      hotTake: null,
    });
  });

  it("dispose cancels pending timers and suppresses status updates from later resolutions", async () => {
    let resolvePost: ((r: PostVoteResult) => void) | null = null;
    const pending = new Promise<PostVoteResult>((r) => {
      resolvePost = r;
    });
    const { saver, statuses } = makeSaver(async () => pending);

    saver.schedule("c1", "Vocals", 7);
    await vi.advanceTimersByTimeAsync(500);
    const countBeforeDispose = statuses.length;
    saver.dispose();
    resolvePost!(makeSuccess());
    await vi.runAllTimersAsync();
    expect(statuses.length).toBe(countBeforeDispose);

    saver.schedule("c1", "Vocals", 9);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(statuses.length).toBe(countBeforeDispose);
  });
});
