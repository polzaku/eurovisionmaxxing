import { describe, it, expect } from "vitest";
import {
  partitionByConflict,
  makeServerStateKey,
} from "@/lib/voting/conflictCheck";
import type { QueueEntry } from "@/lib/voting/offlineQueue";

const ROOM_A = "11111111-2222-4333-8444-555555555555";
const ROOM_B = "11111111-2222-4333-8444-666666666666";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function entry(
  contestantId: string,
  timestamp: number,
  roomId = ROOM_A
): QueueEntry {
  return {
    id: `${roomId}-${contestantId}-${timestamp}`,
    timestamp,
    payload: {
      roomId,
      userId: USER,
      contestantId,
      scores: { Vocals: 7 },
    },
  };
}

describe("partitionByConflict", () => {
  it("returns empty result for empty entries", () => {
    expect(partitionByConflict([], new Map())).toEqual({
      drainable: [],
      skipped: [],
    });
  });

  it("treats every entry as drainable when server state is empty", () => {
    const e1 = entry("2026-ua", 1000);
    const e2 = entry("2026-se", 2000);
    const result = partitionByConflict([e1, e2], new Map());
    expect(result.drainable).toEqual([e1, e2]);
    expect(result.skipped).toEqual([]);
  });

  it("skips an entry whose timestamp is older than the server's updatedAt", () => {
    const e = entry("2026-ua", 1000);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
    ]);
    const result = partitionByConflict([e], server);
    expect(result.drainable).toEqual([]);
    expect(result.skipped).toEqual([{ entry: e, reason: "server-newer" }]);
  });

  it("keeps an entry whose timestamp is newer than the server's updatedAt", () => {
    const e = entry("2026-ua", 9_999_999_999_999);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:00.000Z"],
    ]);
    const result = partitionByConflict([e], server);
    expect(result.drainable).toEqual([e]);
    expect(result.skipped).toEqual([]);
  });

  it("partitions a mixed batch correctly", () => {
    const stale = entry("2026-ua", 1000);
    const fresh = entry("2026-se", 9_999_999_999_999);
    const noServer = entry("2026-fr", 5000);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
      [makeServerStateKey(ROOM_A, "2026-se"), "2026-04-25T12:00:00.000Z"],
    ]);
    const result = partitionByConflict([stale, fresh, noServer], server);
    expect(result.drainable).toEqual([fresh, noServer]);
    expect(result.skipped).toEqual([{ entry: stale, reason: "server-newer" }]);
  });

  it("treats no server entry for a (room, contestant) as no-conflict", () => {
    const e = entry("2026-fr", 1000);
    const result = partitionByConflict([e], new Map());
    expect(result.drainable).toEqual([e]);
  });

  it("treats malformed server timestamps as no-conflict (defensive)", () => {
    const e = entry("2026-ua", 1000);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "not-a-date"],
    ]);
    const result = partitionByConflict([e], server);
    expect(result.drainable).toEqual([e]);
    expect(result.skipped).toEqual([]);
  });

  it("compares each entry independently when the same (room, contestant) appears twice", () => {
    const stale = entry("2026-ua", 1000);
    const fresh = entry("2026-ua", 9_999_999_999_999);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
    ]);
    const result = partitionByConflict([stale, fresh], server);
    expect(result.skipped).toEqual([{ entry: stale, reason: "server-newer" }]);
    expect(result.drainable).toEqual([fresh]);
  });

  it("scopes server state per-room (different roomIds with the same contestantId don't cross-pollute)", () => {
    const eA = entry("2026-ua", 1000, ROOM_A);
    const eB = entry("2026-ua", 1000, ROOM_B);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
    ]);
    const result = partitionByConflict([eA, eB], server);
    expect(result.skipped).toEqual([{ entry: eA, reason: "server-newer" }]);
    expect(result.drainable).toEqual([eB]);
  });
});
