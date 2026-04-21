"use client";

import { useEffect, useId, useState } from "react";
import { nextScore } from "./nextScore";

export interface ScoreRowProps {
  categoryName: string;
  hint?: string;
  value: number | null;
  weightMultiplier?: number;
  onChange: (next: number | null) => void;
  disabled?: boolean;
}

const BUTTONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const ANIMATION_MS = 320;

export default function ScoreRow({
  categoryName,
  hint,
  value,
  weightMultiplier,
  onChange,
  disabled = false,
}: ScoreRowProps) {
  const [lastPressed, setLastPressed] = useState<number | null>(null);
  const hintId = useId();

  useEffect(() => {
    if (lastPressed === null) return;
    const t = setTimeout(() => setLastPressed(null), ANIMATION_MS);
    return () => clearTimeout(t);
  }, [lastPressed]);

  const showWeightBadge =
    typeof weightMultiplier === "number" && weightMultiplier >= 2;
  const scored = value !== null;

  function handleClick(n: number) {
    if (disabled) return;
    onChange(nextScore(value, n));
    setLastPressed(n);
  }

  return (
    <div
      className={`space-y-2 ${disabled ? "opacity-50" : ""}`}
      data-testid="score-row"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-medium text-foreground truncate">
            {categoryName}
          </span>
          {showWeightBadge && (
            <span className="inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
              counts {weightMultiplier}×
            </span>
          )}
        </div>
        <span
          className={`text-sm flex-shrink-0 ${
            scored ? "text-primary font-medium" : "text-muted-foreground"
          }`}
        >
          {scored ? `✓ scored ${value}` : "Not scored"}
        </span>
      </div>

      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      <div
        className="grid grid-cols-5 sm:grid-cols-10 gap-2"
        role="group"
        aria-label={`${categoryName} — score from 1 to 10`}
      >
        {BUTTONS.map((n) => {
          const selected = value === n;
          const pop = lastPressed === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => handleClick(n)}
              disabled={disabled}
              aria-label={`${categoryName}: score ${n}`}
              aria-pressed={selected}
              aria-describedby={hint ? hintId : undefined}
              className={`
                min-w-[44px] min-h-[44px] aspect-square rounded-lg font-semibold
                transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                disabled:cursor-not-allowed
                ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
                }
                ${pop ? "animate-score-pop" : ""}
              `.trim()}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
