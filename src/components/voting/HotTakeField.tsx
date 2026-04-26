"use client";

import { useState, useRef, useEffect, type ChangeEvent } from "react";
import { countHotTakeChars } from "@/lib/voting/countHotTakeChars";

export interface HotTakeFieldProps {
  value: string;
  onChange: (next: string) => void;
  maxChars?: number;
}

export default function HotTakeField({
  value,
  onChange,
  maxChars = 140,
}: HotTakeFieldProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isExpanded && value === "" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded, value]);

  const showInput = isExpanded || value !== "";

  if (!showInput) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        aria-label="Add a hot take"
        className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring rounded"
      >
        + Add a hot take
      </button>
    );
  }

  const count = countHotTakeChars(value);
  const nearLimit = count >= maxChars - 10;

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    if (countHotTakeChars(next) > maxChars) return;
    onChange(next);
  }

  function handleBlur() {
    if (value === "") setIsExpanded(false);
  }

  return (
    <div className="space-y-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Your one-liner"
        rows={2}
        aria-label="Hot take"
        data-no-swipe
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring resize-none"
      />
      <div className="flex justify-end">
        <span
          aria-live="polite"
          className={`text-xs tabular-nums ${nearLimit ? "text-accent" : "text-muted-foreground"}`}
        >
          {count} / {maxChars}
        </span>
      </div>
    </div>
  );
}
