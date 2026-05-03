import type { Contestant } from "@/types";

export interface ContestantDiff {
  /** Country codes present in `next` but not in `prev`. Sorted asc. */
  added: string[];
  /** Country codes present in `prev` but not in `next`. Sorted asc. */
  removed: string[];
  /**
   * Country codes present in both with a different `runningOrder`.
   * Sorted asc. Excludes added/removed.
   */
  reordered: string[];
}

/**
 * Pure helper for SPEC §5.1d admin contestant refresh: computes which
 * country codes were added, removed, or had their running order change
 * between two contestant snapshots. Result arrays are sorted alphabetically
 * for stability across rerenders + broadcast diffs.
 */
export function contestantDiff(
  prev: Contestant[],
  next: Contestant[],
): ContestantDiff {
  const prevByCode = new Map(prev.map((c) => [c.countryCode, c]));
  const nextByCode = new Map(next.map((c) => [c.countryCode, c]));

  const added: string[] = [];
  const removed: string[] = [];
  const reordered: string[] = [];

  for (const [code, c] of nextByCode) {
    const before = prevByCode.get(code);
    if (!before) {
      added.push(code);
    } else if (before.runningOrder !== c.runningOrder) {
      reordered.push(code);
    }
  }

  for (const code of prevByCode.keys()) {
    if (!nextByCode.has(code)) removed.push(code);
  }

  added.sort();
  removed.sort();
  reordered.sort();

  return { added, removed, reordered };
}
