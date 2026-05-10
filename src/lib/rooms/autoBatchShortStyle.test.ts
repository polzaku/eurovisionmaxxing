import { describe, it, expect } from "vitest";
import {
  selectShortBatchRows,
  twelvePointIdx,
} from "./autoBatchShortStyle";

const fullQueue = [
  { contestant_id: "c10", points_awarded: 1, rank: 10, announced: false },
  { contestant_id: "c9",  points_awarded: 2, rank: 9,  announced: false },
  { contestant_id: "c8",  points_awarded: 3, rank: 8,  announced: false },
  { contestant_id: "c7",  points_awarded: 4, rank: 7,  announced: false },
  { contestant_id: "c6",  points_awarded: 5, rank: 6,  announced: false },
  { contestant_id: "c5",  points_awarded: 6, rank: 5,  announced: false },
  { contestant_id: "c4",  points_awarded: 7, rank: 4,  announced: false },
  { contestant_id: "c3",  points_awarded: 8, rank: 3,  announced: false },
  { contestant_id: "c2",  points_awarded: 10, rank: 2, announced: false },
  { contestant_id: "c1",  points_awarded: 12, rank: 1, announced: false },
];

describe("selectShortBatchRows", () => {
  it("returns the 9 non-rank-1 rows from a full 10-row queue", () => {
    const batch = selectShortBatchRows(fullQueue);
    expect(batch).toHaveLength(9);
    expect(batch.every((r) => r.rank !== 1)).toBe(true);
    // The 12-point row (rank 1) is excluded.
    expect(batch.find((r) => r.points_awarded === 12)).toBeUndefined();
  });

  it("returns all rows when no rank-1 exists (degenerate)", () => {
    const noTwelve = fullQueue.filter((r) => r.rank !== 1);
    expect(selectShortBatchRows(noTwelve)).toEqual(noTwelve);
  });

  it("returns empty array for empty input", () => {
    expect(selectShortBatchRows([])).toEqual([]);
  });

  it("handles short queues (< 10 rows) — batches everything except rank 1", () => {
    const short = fullQueue.slice(-5); // top 5 = ranks 1–5
    const batch = selectShortBatchRows(short);
    expect(batch).toHaveLength(4);
    expect(batch.every((r) => r.rank !== 1)).toBe(true);
  });
});

describe("twelvePointIdx", () => {
  it("returns the index of the rank-1 row", () => {
    expect(twelvePointIdx(fullQueue)).toBe(9);
  });

  it("returns null when no rank-1 row exists", () => {
    const noTwelve = fullQueue.filter((r) => r.rank !== 1);
    expect(twelvePointIdx(noTwelve)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(twelvePointIdx([])).toBeNull();
  });
});
