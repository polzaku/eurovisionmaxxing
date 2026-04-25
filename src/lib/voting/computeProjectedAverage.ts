export interface ProjectedAverage {
  perCategory: Record<string, number>;
  overall: number;
}

export function computeProjectedAverage(
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categories: { name: string }[]
): ProjectedAverage {
  const perCategory: Record<string, number> = {};
  for (const cat of categories) {
    const values: number[] = [];
    for (const contestantId of Object.keys(scoresByContestant)) {
      if (missedByContestant[contestantId]) continue;
      const v = scoresByContestant[contestantId][cat.name];
      if (typeof v === "number") values.push(v);
    }
    if (values.length === 0) {
      perCategory[cat.name] = 5;
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    perCategory[cat.name] = clamp1to10(Math.round(mean));
  }
  const allCatMeans = Object.values(perCategory);
  const overallMean =
    allCatMeans.length === 0
      ? 5
      : allCatMeans.reduce((a, b) => a + b, 0) / allCatMeans.length;
  return {
    perCategory,
    overall: clamp1to10(Math.round(overallMean)),
  };
}

function clamp1to10(n: number): number {
  if (n < 1) return 1;
  if (n > 10) return 10;
  return n;
}
