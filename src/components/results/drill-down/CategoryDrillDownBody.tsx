import { buildCategoryDrillDown } from "@/components/results/drill-down/buildCategoryDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface CategoryDrillDownBodyLabels {
  titleId: string;
  title: (categoryName: string) => string;
  meanLabel: (value: string) => string;
  voterCountLabel: (voted: number, total: number) => string;
  sparklineAria: (min: number, median: number, max: number) => string;
  highestSingleLabel: (value: number, name: string) => string;
  lowestSingleLabel: (value: number, name: string) => string;
  meanOfMeansLabel: (value: string) => string;
  emptyCopy: string;
}

export interface CategoryDrillDownBodyProps {
  categoryKey: string;
  data: DonePayload;
  labels: CategoryDrillDownBodyLabels;
}

export default function CategoryDrillDownBody({
  categoryKey,
  data,
  labels,
}: CategoryDrillDownBodyProps) {
  const category = data.categories.find(
    (c) => (c.key ?? c.name) === categoryKey,
  );
  const { rows, aggregates } = buildCategoryDrillDown(categoryKey, {
    categories: data.categories,
    members: data.members,
    contestants: data.contestants,
    voteDetails: data.voteDetails,
  });
  const categoryName = category?.name ?? categoryKey;

  return (
    <>
      <header>
        <h2
          id={labels.titleId}
          className="text-lg font-bold tracking-tight"
        >
          {labels.title(categoryName)}
        </h2>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.emptyCopy}</p>
      ) : (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
            {aggregates.highest ? (
              <StatLabel
                label={labels.highestSingleLabel(
                  aggregates.highest.value,
                  aggregates.highest.displayName,
                )}
              />
            ) : null}
            {aggregates.lowest ? (
              <StatLabel
                label={labels.lowestSingleLabel(
                  aggregates.lowest.value,
                  aggregates.lowest.displayName,
                )}
              />
            ) : null}
            {aggregates.meanOfMeans !== null ? (
              <StatLabel
                label={labels.meanOfMeansLabel(
                  aggregates.meanOfMeans.toFixed(1),
                )}
              />
            ) : null}
          </dl>

          <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
            {rows.map((r) => (
              <li
                key={r.contestantId}
                data-testid="category-drill-row"
                className="px-4 py-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden>{r.flagEmoji}</span>
                    <span className="font-medium">{r.country}</span>
                  </div>
                  <span className="tabular-nums font-semibold">
                    {labels.meanLabel(r.mean.toFixed(1))}
                  </span>
                </div>
                <Sparkline
                  spread={r.spread}
                  ariaLabel={labels.sparklineAria(
                    r.spread.min,
                    r.spread.median,
                    r.spread.max,
                  )}
                />
                <span className="inline-block text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                  {labels.voterCountLabel(r.voted, r.total)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function StatLabel({ label }: { label: string }) {
  return (
    <div>
      <dd className="text-sm font-medium">{label}</dd>
    </div>
  );
}

function Sparkline({
  spread,
  ariaLabel,
}: {
  spread: { min: number; median: number; max: number };
  ariaLabel: string;
}) {
  const pos = (v: number) => `${((v - 1) / 9) * 100}%`;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative h-2 bg-muted rounded-full"
    >
      <span
        className="absolute top-1/2 -translate-y-1/2 h-2 w-0.5 bg-muted-foreground"
        style={{ left: pos(spread.min) }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 h-3 w-1 bg-primary -mt-1.5"
        style={{ left: pos(spread.median) }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 h-2 w-0.5 bg-muted-foreground"
        style={{ left: pos(spread.max) }}
      />
    </div>
  );
}
