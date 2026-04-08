"use client";

import { useState } from "react";
import { SCORE_ANCHORS } from "@/types";

interface SliderProps {
  label: string;
  hint?: string;
  value: number | null; // null = unset
  onChange: (value: number) => void;
}

/**
 * Category voting slider — 1–10 integer scale.
 * Starts unset; snaps to 5 on first touch, then tracks normally.
 * Min 44px touch target height per spec.
 */
export default function Slider({ label, hint, value, onChange }: SliderProps) {
  const [touched, setTouched] = useState(value !== null);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (!touched) setTouched(true);
    onChange(parseInt(e.target.value));
  }

  function handleTouchStart() {
    if (!touched) {
      setTouched(true);
      onChange(5);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground" title={hint}>
          {label}
          {hint && (
            <span className="ml-1 text-muted-foreground text-xs">(?)</span>
          )}
        </label>
        <span
          className={`text-2xl font-bold tabular-nums ${
            touched ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {touched ? value ?? 5 : "–"}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={touched ? (value ?? 5) : 5}
          onChange={handleInput}
          onTouchStart={handleTouchStart}
          onMouseDown={handleTouchStart}
          className={`w-full h-11 ${!touched ? "opacity-40" : ""}`}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-0.5 px-1">
          <span>1</span>
          <span>10</span>
        </div>
      </div>
    </div>
  );
}
