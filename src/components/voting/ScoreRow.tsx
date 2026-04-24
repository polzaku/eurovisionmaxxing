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
        className="relative grid grid-cols-10 w-full h-11 rounded-lg overflow-hidden border border-border bg-muted"
        role="group"
        aria-label={`${categoryName} — score from 1 to 10`}
      >
        {BUTTONS.map((n, i) => {
          const filled = value !== null && n <= value;
          const selected = value === n;
          const pop = lastPressed === n;
          const isLast = i === BUTTONS.length - 1;
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
                h-11 font-semibold text-sm transition-colors
                focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring
                disabled:cursor-not-allowed
                ${!isLast ? "border-r border-border/30" : ""}
                ${filled ? "bg-primary text-primary-foreground" : "text-muted-foreground"}
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
