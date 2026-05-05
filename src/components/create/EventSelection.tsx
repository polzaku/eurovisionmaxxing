"use client";

import Button from "@/components/ui/Button";

type Event = "semi1" | "semi2" | "final";

interface ContestantsState {
  kind: "idle" | "loading" | "slow" | "ready" | "error" | "timeout";
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
  /**
   * Extra year options shown above the standard real-year list. Used in dev
   * to expose the small test-fixture year (9999) for fast smoke testing.
   * Empty in production.
   */
  extraYears?: number[];
  onChange: (patch: { year?: number; event?: Event }) => void;
  onNext: () => void;
  /**
   * Optional escape hatch when both EurovisionAPI + hardcoded fallback fail
   * (SPEC §5.1 step 4 → §6.1 Step 1 → A13). Only rendered alongside the
   * error state so users who can't proceed have an unambiguous way out
   * besides changing the year/event dropdowns.
   */
  onBack?: () => void;
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
  extraYears,
  onChange,
  onNext,
  onBack,
}: EventSelectionProps) {
  const years: number[] = [];
  for (const ey of extraYears ?? []) years.push(ey);
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
              {y === 9999 ? "9999 (test fixture)" : y}
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
          <p
            data-testid="contestants-loading"
            className="text-sm text-muted-foreground animate-shimmer"
          >
            Loading contestants&hellip;
          </p>
        )}
        {contestants.kind === "slow" && (
          <p
            data-testid="contestants-slow"
            className="text-sm text-muted-foreground animate-shimmer"
          >
            Loading is taking longer than usual&hellip;
          </p>
        )}
        {contestants.kind === "ready" && (
          <p className="text-sm">
            <span className="font-semibold">{contestants.count}</span>{" "}
            {contestants.count === 1 ? "country" : "countries"} loaded
          </p>
        )}
        {contestants.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {contestants.errorMessage ??
              "We couldn't load contestant data for this event."}
          </p>
        )}
        {contestants.kind === "timeout" && (
          <p
            data-testid="contestants-timeout"
            role="alert"
            className="text-sm text-destructive"
          >
            {contestants.errorMessage ??
              "Loading is taking too long. Try again, or pick a different year/event."}
          </p>
        )}
      </div>

      <div className="flex justify-between gap-3">
        {(contestants.kind === "error" || contestants.kind === "timeout") &&
        onBack ? (
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span aria-hidden />
        )}
        <Button onClick={onNext} disabled={!canProceed}>
          Next
        </Button>
      </div>
    </div>
  );
}
