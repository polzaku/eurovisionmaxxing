import type { ResultsData } from "@/lib/results/loadResults";
import type { Contestant } from "@/types";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface CategoryDrillDownRow {
  contestantId: string;
  country: string;
  flagEmoji: string;
  song: string;
  mean: number;
  spread: { min: number; median: number; max: number };
  voted: number;
  total: number;
}

export interface CategoryDrillDownExtremum {
  value: number;
  userId: string;
  displayName: string;
  avatarSeed: string;
}

export interface CategoryDrillDownAggregates {
  highest: CategoryDrillDownExtremum | null;
  lowest: CategoryDrillDownExtremum | null;
  meanOfMeans: number | null;
}

export interface CategoryDrillDownResult {
  rows: CategoryDrillDownRow[];
  aggregates: CategoryDrillDownAggregates;
}

export interface CategoryDrillDownInput {
  categories: DonePayload["categories"];
  members: DonePayload["members"];
  contestants: Contestant[];
  voteDetails: DonePayload["voteDetails"];
}

/**
 * SPEC §12.6.3 — per-contestant mean + spread sparkline + voter count
 * for a single category. Sorted by mean desc. Contestants with no
 * non-missed votes in this category are dropped from rows.
 */
export function buildCategoryDrillDown(
  categoryKey: string,
  { categories, members, contestants, voteDetails }: CategoryDrillDownInput,
): CategoryDrillDownResult {
  const category = categories.find(
    (c) => (c.key ?? c.name) === categoryKey,
  );
  if (!category) {
    return {
      rows: [],
      aggregates: { highest: null, lowest: null, meanOfMeans: null },
    };
  }
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const total = members.length;

  const byContestant = new Map<
    string,
    Array<{ userId: string; value: number }>
  >();
  for (const v of voteDetails) {
    if (v.missed) continue;
    const value = v.scores[categoryKey];
    if (typeof value !== "number") continue;
    const list = byContestant.get(v.contestantId) ?? [];
    list.push({ userId: v.userId, value });
    byContestant.set(v.contestantId, list);
  }

  const rows: CategoryDrillDownRow[] = [];
  for (const c of contestants) {
    const list = byContestant.get(c.id) ?? [];
    if (list.length === 0) continue;
    const values = list.map((x) => x.value);
    const mean = values.reduce((s, x) => s + x, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median =
      sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    rows.push({
      contestantId: c.id,
      country: c.country,
      flagEmoji: c.flagEmoji,
      song: c.song,
      mean,
      spread: { min, median, max },
      voted: list.length,
      total,
    });
  }
  rows.sort((a, b) => b.mean - a.mean);

  const allVotes: Array<{ userId: string; value: number }> = [];
  for (const list of byContestant.values()) allVotes.push(...list);
  const aggregates: CategoryDrillDownAggregates =
    allVotes.length === 0
      ? { highest: null, lowest: null, meanOfMeans: null }
      : {
          highest: extremum(allVotes, memberById, (a, b) => b - a),
          lowest: extremum(allVotes, memberById, (a, b) => a - b),
          meanOfMeans:
            rows.length === 0
              ? null
              : rows.reduce((s, r) => s + r.mean, 0) / rows.length,
        };

  return { rows, aggregates };
}

function extremum(
  votes: Array<{ userId: string; value: number }>,
  memberById: Map<string, { displayName: string; avatarSeed: string }>,
  cmp: (a: number, b: number) => number,
): CategoryDrillDownExtremum {
  const top = [...votes].sort((a, b) => cmp(a.value, b.value))[0];
  const member = memberById.get(top.userId);
  return {
    value: top.value,
    userId: top.userId,
    displayName: member?.displayName ?? top.userId,
    avatarSeed: member?.avatarSeed ?? top.userId,
  };
}
