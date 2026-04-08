"use client";

import { useState, useRef } from "react";
import { PIN_CHARSET } from "@/types";

interface PinInputProps {
  onComplete: (pin: string) => void;
  length?: number;
}

/**
 * Single large PIN input field, auto-uppercase, 6-char limit.
 * Only allows characters from the PIN_CHARSET.
 */
export default function PinInput({ onComplete, length = 6 }: PinInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const filtered = e.target.value
      .toUpperCase()
      .split("")
      .filter((c) => PIN_CHARSET.includes(c))
      .join("")
      .slice(0, length);

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
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      className="
        w-full text-center text-3xl font-mono font-bold tracking-[0.5em]
        bg-card border-2 border-border rounded-xl
        px-4 py-4
        focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30
        placeholder:text-muted-foreground/40
        uppercase
      "
    />
  );
}
