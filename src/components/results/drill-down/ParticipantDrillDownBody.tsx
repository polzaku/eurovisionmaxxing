import Avatar from "@/components/ui/Avatar";
import { buildParticipantDrillDown } from "@/components/results/drill-down/buildParticipantDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ParticipantDrillDownBodyLabels {
  titleId: string;
  title: (displayName: string) => string;
  totalAwardedLabel: (points: number) => string;
  hotTakeCountLabel: (count: number) => string;
  meanLabel: string;
  harshnessLabel: (value: string) => string;
  alignmentLabel: (value: string) => string;
  weightedScoreLabel: (value: string) => string;
  missedLabel: string;
  editedLabel: string;
  emptyCopy: string;
}

export interface ParticipantDrillDownBodyProps {
  userId: string;
  data: DonePayload;
  labels: ParticipantDrillDownBodyLabels;
}

export default function ParticipantDrillDownBody({
  userId,
  data,
  labels,
}: ParticipantDrillDownBodyProps) {
  const { header, rows, aggregates } = buildParticipantDrillDown(userId, {
    categories: data.categories,
    members: data.members,
    contestants: data.contestants,
    leaderboard: data.leaderboard,
    voteDetails: data.voteDetails,
  });

  return (
    <>
      <header className="flex items-center gap-3">
        <Avatar seed={header.avatarSeed} size={48} />
        <div className="space-y-0.5">
          <h2
            id={labels.titleId}
            className="text-lg font-bold tracking-tight"
          >
            {labels.title(header.displayName)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {labels.totalAwardedLabel(header.totalPointsAwarded)} ·{" "}
            {labels.hotTakeCountLabel(header.hotTakeCount)}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.emptyCopy}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
            <StatPair
              label={labels.meanLabel}
              value={aggregates.mean?.toFixed(1) ?? "—"}
            />
            <StatLabel
              label={labels.harshnessLabel(
                aggregates.harshness === null
                  ? "—"
                  : signed(aggregates.harshness),
              )}
            />
            <StatLabel
              label={labels.alignmentLabel(
                aggregates.alignment === null
                  ? "—"
                  : aggregates.alignment.toFixed(1),
              )}
            />
          </dl>

          <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
            {rows.map((r) => (
              <li
                key={r.contestantId}
                data-testid="participant-drill-row"
                className="px-4 py-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden>{r.flagEmoji}</span>
                    <span className="font-medium">{r.country}</span>
                    <span className="text-xs text-muted-foreground">
                      · {r.song}
                    </span>
                  </div>
                  <PointsPill points={r.pointsAwarded} />
                </div>
                {r.missed ? (
                  <span className="inline-block text-xs italic text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                    {labels.missedLabel}
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {data.categories.map((c) => {
                      const key = c.key ?? c.name;
                      const v = r.scores[c.name] ?? r.scores[key];
                      if (typeof v !== "number") return null;
                      return (
                        <span
                          key={key}
                          className="rounded-full border border-border px-2 py-0.5 tabular-nums"
                        >
                          {c.name} {v}
                        </span>
                      );
                    })}
                    <span className="ml-auto tabular-nums font-medium">
                      {labels.weightedScoreLabel(r.weightedScore.toFixed(1))}
                    </span>
                  </div>
                )}
                {r.hotTake ? (
                  <p className="text-sm italic text-muted-foreground">
                    “{r.hotTake}”
                    {r.hotTakeEditedAt ? (
                      <span className="ml-1 text-xs not-italic">
                        {labels.editedLabel}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function signed(value: number): string {
  if (value > 0) return `+${value.toFixed(1)}`;
  if (value < 0) return value.toFixed(1);
  return "0.0";
}

function StatPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="tabular-nums font-semibold">{value}</dd>
    </div>
  );
}

function StatLabel({ label }: { label: string }) {
  return (
    <div>
      <dd className="text-sm font-medium">{label}</dd>
    </div>
  );
}

function PointsPill({ points }: { points: number }) {
  const twelve = points === 12;
  return (
    <span
      className={
        twelve
          ? "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-accent text-accent-foreground px-2 text-sm font-bold tabular-nums"
          : "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-foreground text-background px-2 text-sm font-semibold tabular-nums"
      }
    >
      {points}
    </span>
  );
}
