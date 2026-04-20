"use client";

import { useState, useRef, useEffect } from "react";
import { PIN_CHARSET } from "@/types";

interface PinInputProps {
  onComplete: (pin: string) => void;
  length?: number;
  disabled?: boolean;
  initialValue?: string;
}

function normalizePin(raw: string, length: number): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((c) => PIN_CHARSET.includes(c))
    .join("")
    .slice(0, length);
}

/**
 * Single large PIN input field, auto-uppercase, filtered against PIN_CHARSET.
 * Fires onComplete when exactly `length` valid characters are present.
 */
export default function PinInput({
  onComplete,
  length = 6,
  disabled = false,
  initialValue,
}: PinInputProps) {
  const [value, setValue] = useState<string>(() =>
    initialValue ? normalizePin(initialValue, length) : ""
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // If initialValue is a complete PIN, fire onComplete once after mount
  // so the caller can auto-submit the resumed value.
  useEffect(() => {
    if (value.length === length) {
      onComplete(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return;
    const filtered = normalizePin(e.target.value, length);
    setValue(filtered);
    if (filtered.length === length) {
      onComplete(filtered);
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={handleChange}
      placeholder={"·".repeat(length)}
      maxLength={length}
      autoComplete="one-time-code"
      autoCorrect="off"
      spellCheck={false}
      readOnly={disabled}
      aria-disabled={disabled}
      className={`
        w-full text-center text-3xl font-mono font-bold tracking-[0.5em]
        bg-card border-2 border-border rounded-xl
        px-4 py-4
        focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30
        placeholder:text-muted-foreground/40
        uppercase
        ${disabled ? "opacity-60 cursor-not-allowed" : ""}
      `}
    />
  );
}
