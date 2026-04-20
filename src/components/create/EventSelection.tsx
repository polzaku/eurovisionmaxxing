"use client";

import Button from "@/components/ui/Button";

type Event = "semi1" | "semi2" | "final";

interface ContestantsState {
  kind: "idle" | "loading" | "ready" | "error";
  count?: number;
  preview?: Array<{ flag: string; country: string }>;
  errorMessage?: string;
}

interface EventSelectionProps {
  year: number;
  event: Event;
  contestants: ContestantsState;
  minYear: number;
  maxYear: number;
  onChange: (patch: { year?: number; event?: Event }) => void;
  onNext: () => void;
}

const EVENT_LABELS: Record<Event, string> = {
  semi1: "Semi-Final 1",
  semi2: "Semi-Final 2",
  final: "Grand Final",
};

export default function EventSelection({
  year,
  event,
  contestants,
  minYear,
  maxYear,
  onChange,
  onNext,
}: EventSelectionProps) {
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  const canProceed = contestants.kind === "ready";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">Pick an event</h2>
        <p className="text-sm text-muted-foreground">
          Which Eurovision event are you watching?
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="year" className="text-sm font-medium">
          Year
        </label>
        <select
          id="year"
          value={year}
          onChange={(e) => onChange({ year: parseInt(e.target.value, 10) })}
          className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-base focus:outline-none focus:border-primary"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Event</p>
        <div className="grid grid-cols-1 gap-2">
          {(Object.keys(EVENT_LABELS) as Event[]).map((ev) => {
            const selected = ev === event;
            return (
              <button
                key={ev}
                type="button"
                onClick={() => onChange({ event: ev })}
                className={`text-left rounded-lg border-2 px-4 py-3 transition-all ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-accent"
                }`}
              >
                <span className="font-semibold">{EVENT_LABELS[ev]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-[2.5rem]">
        {contestants.kind === "loading" && (
          <p className="text-sm text-muted-foreground animate-shimmer">
            Loading contestants&hellip;
          </p>
        )}
        {contestants.kind === "ready" && (
          <p className="text-sm">
            <span className="font-semibold">{contestants.count}</span> countries
            loaded
            {contestants.preview && contestants.preview.length > 0 && (
              <>
                {" "}
                &middot;{" "}
                <span className="text-muted-foreground">
                  {contestants.preview
                    .map((c) => `${c.flag} ${c.country}`)
                    .join(" · ")}
                  {contestants.count && contestants.count > 3 ? ", …" : ""}
                </span>
              </>
            )}
          </p>
        )}
        {contestants.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {contestants.errorMessage ??
              "We couldn't load contestant data for this event."}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed}>
          Next
        </Button>
      </div>
    </div>
  );
}
