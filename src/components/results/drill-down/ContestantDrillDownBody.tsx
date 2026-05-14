import Avatar from "@/components/ui/Avatar";
import { buildContestantDrillDown } from "@/components/results/drill-down/buildContestantDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ContestantDrillDownBodyLabels {
  titleId: string;
  title: (country: string, points: number) => string;
  meanLabel: string;
  medianLabel: string;
  highestLabel: string;
  lowestLabel: string;
  weightedScoreLabel: (value: string) => string;
  missedLabel: string;
  editedLabel: string;
  emptyCopy: string;
}

export interface ContestantDrillDownBodyProps {
  contestantId: string;
  data: DonePayload;
  labels: ContestantDrillDownBodyLabels;
}

export default function ContestantDrillDownBody({
  contestantId,
  data,
  labels,
}: ContestantDrillDownBodyProps) {
  const contestant = data.contestants.find((c) => c.id === contestantId);
  const totalPoints =
    data.leaderboard.find((e) => e.contestantId === contestantId)
      ?.totalPoints ?? 0;
  const { rows, aggregates } = buildContestantDrillDown(contestantId, {
    categories: data.categories,
    members: data.members,
    voteDetails: data.voteDetails,
  });

  const country = contestant?.country ?? contestantId;

  return (
    <>
      <header className="space-y-1">
        <h2
          id={labels.titleId}
          className="text-lg font-bold tracking-tight flex items-center gap-2"
        >
          <span aria-hidden>{contestant?.flagEmoji ?? "🏳️"}</span>
          <span>{labels.title(country, totalPoints)}</span>
        </h2>
        {contestant ? (
          <p className="text-sm text-muted-foreground">
            {contestant.song} · {contestant.artist}
          </p>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.emptyCopy}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
            <Stat
              label={labels.meanLabel}
              value={aggregates.mean?.toFixed(1) ?? "—"}
            />
            <Stat
              label={labels.medianLabel}
              value={aggregates.median?.toFixed(1) ?? "—"}
            />
            {aggregates.highest ? (
              <StatActor
                label={labels.highestLabel}
                actor={aggregates.highest}
              />
            ) : null}
            {aggregates.lowest ? (
              <StatActor
                label={labels.lowestLabel}
                actor={aggregates.lowest}
              />
            ) : null}
          </dl>

          <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
            {rows.map((r) => (
              <li
                key={r.userId}
                data-testid="contestant-drill-row"
                className="px-4 py-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Avatar seed={r.avatarSeed} size={32} />
                    <span className="font-medium">{r.displayName}</span>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="tabular-nums font-semibold">{value}</dd>
    </div>
  );
}

function StatActor({
  label,
  actor,
}: {
  label: string;
  actor: { displayName: string; avatarSeed: string; weightedScore: number };
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="flex items-center gap-2">
        <Avatar seed={actor.avatarSeed} size={20} />
        <span className="text-sm font-medium">{actor.displayName}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {actor.weightedScore.toFixed(1)}
        </span>
      </dd>
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
