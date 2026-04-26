"use client";

import { useState } from "react";

export interface CopySummaryButtonProps {
  summary: string;
  labels: { idle: string; done: string };
}

/**
 * Writes the preformatted §12.2 summary to the clipboard and flashes
 * "Copied!" for 2 s. Falls back silently if clipboard is unavailable.
 */
export default function CopySummaryButton({
  summary,
  labels,
}: CopySummaryButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API blocked — no-op for MVP
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border-2 border-border px-5 py-3 text-base font-semibold text-foreground transition-all duration-200 hover:scale-[1.02] hover:border-accent hover:emx-glow-pink active:scale-[0.98]"
    >
      {copied ? labels.done : labels.idle}
    </button>
  );
}
