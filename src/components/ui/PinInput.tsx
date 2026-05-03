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
 * SPEC §6.4 / L17 / R10 — six-slot SMS-code-style PIN input. Visual
 * slot boxes provide the SMS-code aesthetic; under the hood it's a
 * single `<input>` so paste, password managers, and iOS SMS autofill
 * (`autocomplete="one-time-code"`) all work without per-slot wiring.
 *
 * The input is fully transparent and stretched over the slot boxes so
 * focus/click anywhere on the row works. The boxes display the
 * normalized characters; the active-slot ring marks where the next
 * keystroke will land.
 */
export default function PinInput({
  onComplete,
  length = 6,
  disabled = false,
  initialValue,
}: PinInputProps) {
  const [value, setValue] = useState<string>(() =>
    initialValue ? normalizePin(initialValue, length) : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // If initialValue is a complete PIN, fire onComplete once after mount.
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
    <div
      className={`relative w-full ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      onClick={() => inputRef.current?.focus()}
      data-testid="pin-input"
    >
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length }, (_, i) => {
          const filled = i < value.length;
          const isActive = i === value.length && !disabled;
          return (
            <div
              key={i}
              data-testid={`pin-slot-${i}`}
              data-filled={filled || undefined}
              data-active={isActive || undefined}
              className={`flex-1 h-14 rounded-lg border-2 flex items-center justify-center text-2xl font-mono font-bold tabular-nums transition-all ${
                filled
                  ? "border-primary text-foreground bg-card"
                  : "border-border text-muted-foreground/40 bg-card"
              } ${
                isActive ? "ring-2 ring-primary/30 border-primary/70" : ""
              }`}
            >
              {filled ? value[i] : "·"}
            </div>
          );
        })}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        maxLength={length}
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        readOnly={disabled}
        aria-disabled={disabled}
        aria-label="Room PIN"
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        style={{
          // Hide the caret too — the active-slot ring is the visual cue.
          caretColor: "transparent",
        }}
      />
    </div>
  );
}
