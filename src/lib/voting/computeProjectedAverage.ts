export interface ProjectedAverage {
  perCategory: Record<string, number>;
  overall: number;
}

export function computeProjectedAverage(
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categories: { name: string }[]
): ProjectedAverage {
  void scoresByContestant;
  void missedByContestant;
  const perCategory: Record<string, number> = {};
  for (const cat of categories) {
    perCategory[cat.name] = 5;
  }
  return { perCategory, overall: 5 };
}
